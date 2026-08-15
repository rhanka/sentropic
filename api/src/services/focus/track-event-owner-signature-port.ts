import { createHash } from 'node:crypto';
import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type FocusOwnerSignatureContractVersion,
  type OwnerSignatureDurableUniquenessKey,
  type PersistedOwnerSignature,
  type TrackOwnerSignaturePort,
  type TrackOwnerSignatureWrite,
  type TrackOwnerSignatureWriteResult,
} from '@sentropic/focus';
import { EventStore } from '@sentropic/track';
import { ingest, type IngestContext, type WorkEvent } from '@sentropic/track/ingest';
import { TrackReader, type DossierArtifact } from '@sentropic/track/read';

export interface TrackEventOwnerSignaturePortOptions {
  eventsPath?: string;
}

interface StoredSignatureMetadata {
  recordId: string;
  idempotencyKey: string;
  ownerPrincipalId: string;
  ownerIssuer: string;
  relayerTransport: 'cli' | 'mcp-stdio' | 'import' | 'internal' | 'http';
  relayerId: string;
  relayerIssuer: string;
  relayerSubject: string;
}

/**
 * Track event log-backed owner signature port for Local E1 Fusion.
 * Appends the author-signature as a `decision.add-artifact` DossierArtifact
 * with ComprehensionEvidence into the shared Track event log.
 *
 * Uniqueness: deterministic clientToken derived from `(ownerSubject, workspace, decisionId)`.
 */
export class TrackEventOwnerSignaturePort implements TrackOwnerSignaturePort {
  readonly contractVersion: FocusOwnerSignatureContractVersion = FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;
  private readonly eventsPath: string;

  constructor(options: TrackEventOwnerSignaturePortOptions = {}) {
    this.eventsPath = options.eventsPath ?? process.env.TRACK_EVENTS_PATH ?? '.track/events.jsonl';
  }

  async appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult> {
    const { target, attestation, relayer, idempotencyKey } = input;
    const ownerSubject = attestation.attester.canonicalIdentity.subject;

    // Deterministic clientToken for atomicity & deduplication
    const clientToken = createHash('sha256')
      .update(`owner-sig:${ownerSubject}:${target.workspace}:${target.decisionId}`)
      .digest('hex');

    const dossierHash = createHash('sha256')
      .update(`dossier:${target.decisionId}`)
      .digest('hex');

    const metadata: StoredSignatureMetadata = {
      recordId: clientToken,
      idempotencyKey,
      ownerPrincipalId: attestation.attester.principalId,
      ownerIssuer: attestation.attester.canonicalIdentity.issuer,
      relayerTransport: relayer.transport,
      relayerId: relayer.relayerId,
      relayerIssuer: relayer.canonicalIdentity.issuer,
      relayerSubject: relayer.canonicalIdentity.subject,
    };

    const workEvent: WorkEvent = {
      v: 1,
      kind: 'decision.add-artifact',
      payload: {
        decisionId: target.decisionId,
        artifact: {
          kind: 'h2a-decision-dossier',
          negotiationRef: target.decisionId,
          dossierHash,
          comprehension: [
            {
              subject: ownerSubject,
              dossierHash,
              at: attestation.attester.authenticatedAt,
              sig: {
                alg: 'sentropic-owner-attestation-v1',
                value: JSON.stringify(metadata),
                by: ownerSubject,
              },
            },
          ],
        },
      },
      clientToken,
    };

    const ctx: IngestContext = {
      by: ownerSubject,
      workspace: target.workspace,
      prov: {
        transport: relayer.transport,
        proposed: false,
        auth: 'local-user',
      },
    };

    const store = new EventStore(this.eventsPath);
    ingest([workEvent], ctx, store);

    const persisted = await this.readOwnerSignature({
      ownerCanonicalIdentity: attestation.attester.canonicalIdentity,
      target,
    });

    if (!persisted) {
      throw new Error('Owner signature write failed to read back from Track store');
    }

    // `ingest` doesn't report append-vs-dedup for its own call (its dedup hook returns the
    // SAME durable event to every caller sharing this clientToken). An unlocked pre/post
    // `readAll().length` bracket is racy cross-process (PR #536 review F1b): a concurrent
    // writer can land between the two reads and make both callers see a length delta. The
    // persisted record's `idempotencyKey` — stamped by whichever write actually landed — is
    // the authoritative signal for which caller's attempt was durably recorded.
    const status = persisted.idempotencyKey === idempotencyKey ? 'written' : 'duplicate';
    return {
      status,
      recordId: persisted.recordId,
    };
  }

  async readOwnerSignature(
    input: OwnerSignatureDurableUniquenessKey,
  ): Promise<PersistedOwnerSignature | undefined> {
    try {
      const reader = new TrackReader(this.eventsPath);
      const snapshot = reader.reportSnapshot({ decisions: true });
      const events = snapshot.events;

      for (const event of events) {
        if (
          event.type === 'decision.artifact-added' &&
          event.aggregateId === input.target.decisionId
        ) {
          const payload = event.payload as { artifact?: DossierArtifact };
          const artifact = payload.artifact;
          if (artifact?.kind === 'h2a-decision-dossier' && artifact.comprehension) {
            for (const comp of artifact.comprehension) {
              if (comp.subject === input.ownerCanonicalIdentity.subject && comp.sig?.value) {
                try {
                  const meta = JSON.parse(comp.sig.value) as StoredSignatureMetadata;
                  return Object.freeze({
                    contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
                    target: Object.freeze({
                      workspace: input.target.workspace,
                      decisionId: input.target.decisionId,
                    }),
                    attestation: Object.freeze({
                      attester: Object.freeze({
                        principalId: meta.ownerPrincipalId,
                        canonicalIdentity: Object.freeze({
                          issuer: meta.ownerIssuer,
                          subject: input.ownerCanonicalIdentity.subject,
                        }),
                        authenticatedAt: comp.at ?? new Date().toISOString(),
                      }),
                    }),
                    relayer: Object.freeze({
                      transport: meta.relayerTransport,
                      relayerId: meta.relayerId,
                      canonicalIdentity: Object.freeze({
                        issuer: meta.relayerIssuer,
                        subject: meta.relayerSubject,
                      }),
                    }),
                    idempotencyKey: meta.idempotencyKey,
                    recordId: meta.recordId,
                  });
                } catch {
                  // Ignore malformed metadata signature values
                }
              }
            }
          }
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}
