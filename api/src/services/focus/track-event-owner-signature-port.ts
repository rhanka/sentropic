import { createHash, randomUUID } from 'node:crypto';
import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type FocusOwnerSignatureContractVersion,
  type OwnerSignatureDurableUniquenessKey,
  type PersistedOwnerSignature,
  type RelayerProvenance,
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
  relayerTransport: RelayerProvenance['transport'];
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

    // Caller-supplied newId: `emitBatch` always mints a fresh id for the event it emits, BEFORE
    // the under-lock dedupe hook decides whether to persist it or discard it in favor of the
    // pre-existing event. So `attemptEventId` lands as the persisted event's `id` iff THIS call's
    // write actually won the (workspace, clientToken) slot under the lock — the same
    // did-my-own-write-win signal the Postgres sibling port reads off its `onConflictDoNothing`
    // `.returning()` (PR #536 review F1b-residual). `idempotencyKey` is client-supplied and
    // legitimately repeats across retries, so it cannot serve as this signal.
    const attemptEventId = randomUUID();

    const ctx: IngestContext = {
      by: ownerSubject,
      workspace: target.workspace,
      prov: {
        transport: relayer.transport,
        proposed: false,
        auth: 'local-user',
      },
      newId: () => attemptEventId,
    };

    const store = new EventStore(this.eventsPath);
    ingest([workEvent], ctx, store);

    const record = this.findPersistedRecord({
      ownerCanonicalIdentity: attestation.attester.canonicalIdentity,
      target,
    });

    if (!record) {
      throw new Error('Owner signature write failed to read back from Track store');
    }

    const status = record.eventId === attemptEventId ? 'written' : 'duplicate';
    return {
      status,
      recordId: record.meta.recordId,
    };
  }

  async readOwnerSignature(
    input: OwnerSignatureDurableUniquenessKey,
  ): Promise<PersistedOwnerSignature | undefined> {
    const record = this.findPersistedRecord(input);
    if (!record) return undefined;

    const { meta, at } = record;
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
          authenticatedAt: at,
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
  }

  /**
   * Shared scan for the durable `(owner, workspace, decision)` record: the raw event's own `id`
   * (for the append-vs-dedup arbiter) plus its stored metadata (for the public read shape).
   */
  private findPersistedRecord(
    input: OwnerSignatureDurableUniquenessKey,
  ): { eventId: string; at: string; meta: StoredSignatureMetadata } | undefined {
    try {
      const reader = new TrackReader(this.eventsPath);
      // baselineCommit only feeds item-level acceptance/bucket status (unused here — this
      // port reads raw decision.artifact-added events only).
      const snapshot = reader.reportSnapshot({ decisions: true, baselineCommit: '' });
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
                  return { eventId: event.id, at: comp.at ?? new Date().toISOString(), meta };
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
