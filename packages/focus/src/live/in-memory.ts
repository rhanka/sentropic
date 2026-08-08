import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type OwnerSignatureIdentity,
  type PersistedOwnerSignature,
  type TrackOwnerSignatureWrite,
  type TrackOwnerSignatureWriteResult,
} from "../model.js";
import type { TrackOwnerSignaturePort } from "./index.js";

const identityKey = (identity: OwnerSignatureIdentity): string =>
  `${identity.ownerPrincipalId}\u0000${identity.target.workspace}\u0000${identity.target.decisionId}`;

const copyPersisted = (write: TrackOwnerSignatureWrite, recordId: string): PersistedOwnerSignature =>
  Object.freeze({
    contractVersion: write.contractVersion,
    target: Object.freeze({ workspace: write.target.workspace, decisionId: write.target.decisionId }),
    attestation: Object.freeze({
      attester: Object.freeze({
        principalId: write.attestation.attester.principalId,
        authenticatedAt: write.attestation.attester.authenticatedAt,
      }),
    }),
    relayer: Object.freeze({ transport: write.relayer.transport, relayerId: write.relayer.relayerId }),
    idempotencyKey: write.idempotencyKey,
    recordId,
  });

/**
 * Reference Track adapter for tests and local hosts. Its synchronous map check-and-set is one
 * JavaScript critical section: concurrent callers cannot observe an empty identity between the
 * check and insert. Durable adapters must provide the same guarantee with an upsert/constraint.
 */
export class InMemoryTrackOwnerSignaturePort implements TrackOwnerSignaturePort {
  readonly contractVersion = FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;

  private readonly records = new Map<string, PersistedOwnerSignature>();
  private nextRecord = 1;
  appendAttempts = 0;

  get recordCount(): number {
    return this.records.size;
  }

  appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult> {
    this.appendAttempts += 1;
    const key = identityKey({
      ownerPrincipalId: input.attestation.attester.principalId,
      target: input.target,
    });
    const existing = this.records.get(key);
    if (existing !== undefined) return Promise.resolve({ status: "duplicate", recordId: existing.recordId });

    const persisted = copyPersisted(input, `owner-signature-${this.nextRecord}`);
    this.nextRecord += 1;
    this.records.set(key, persisted);
    return Promise.resolve({ status: "written", recordId: persisted.recordId });
  }

  readOwnerSignature(
    input: OwnerSignatureIdentity & { readonly idempotencyKey: string },
  ): Promise<PersistedOwnerSignature | undefined> {
    return Promise.resolve(this.records.get(identityKey(input)));
  }
}
