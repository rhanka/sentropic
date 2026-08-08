import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type OwnerSignatureIdentity,
  type PersistedOwnerSignature,
  type TrackOwnerSignatureWrite,
  type TrackOwnerSignatureWriteResult,
} from "../model.js";
import type { TrackOwnerSignaturePort } from "./index.js";

const identityKey = (identity: OwnerSignatureIdentity): string =>
  `${identity.ownerCanonicalIdentity.issuer}\u0000${identity.ownerCanonicalIdentity.subject}\u0000${identity.target.workspace}\u0000${identity.target.decisionId}`;

const copyPersisted = (write: TrackOwnerSignatureWrite, recordId: string): PersistedOwnerSignature =>
  Object.freeze({
    contractVersion: write.contractVersion,
    target: Object.freeze({ workspace: write.target.workspace, decisionId: write.target.decisionId }),
    attestation: Object.freeze({
      attester: Object.freeze({
        principalId: write.attestation.attester.principalId,
        canonicalIdentity: Object.freeze({
          issuer: write.attestation.attester.canonicalIdentity.issuer,
          subject: write.attestation.attester.canonicalIdentity.subject,
        }),
        authenticatedAt: write.attestation.attester.authenticatedAt,
      }),
    }),
    relayer: Object.freeze({
      transport: write.relayer.transport,
      relayerId: write.relayer.relayerId,
      canonicalIdentity: Object.freeze({
        issuer: write.relayer.canonicalIdentity.issuer,
        subject: write.relayer.canonicalIdentity.subject,
      }),
    }),
    idempotencyKey: write.idempotencyKey,
    recordId,
  });

/**
 * TEST-ONLY, non-durable reference adapter. This process-local Map is not a Track persistence
 * implementation and must never be wired into a live host. It only gives unit tests deterministic
 * duplicate behavior; it cannot prove durable exactly-once atomicity. Only the co-specified
 * production Track adapter's durable unique constraint/upsert proves that property before live use.
 */
export class TestOnlyInMemoryTrackOwnerSignaturePort implements TrackOwnerSignaturePort {
  readonly contractVersion = FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;

  private readonly records = new Map<string, PersistedOwnerSignature>();
  private nextRecord = 1;
  appendAttempts = 0;
  readAttempts = 0;

  get recordCount(): number {
    return this.records.size;
  }

  appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult> {
    this.appendAttempts += 1;
    const key = identityKey({
      ownerCanonicalIdentity: input.attestation.attester.canonicalIdentity,
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
    input: OwnerSignatureIdentity,
  ): Promise<PersistedOwnerSignature | undefined> {
    this.readAttempts += 1;
    return Promise.resolve(this.records.get(identityKey(input)));
  }
}
