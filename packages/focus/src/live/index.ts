import type {
  AuthenticatedOwnPrincipal,
  FocusLiveSession,
  OwnerSignatureRequest,
  OwnerSignatureResult,
  PersistedOwnerSignature,
  TrackNativeDecisionTarget,
  TrackOwnerSignatureWrite,
  TrackOwnerSignatureWriteResult,
} from "../model.js";

/** The trusted integration boundary for own-principal authentication. */
export interface OwnPrincipalAuthenticator {
  authenticate(input: OwnerSignatureRequest): Promise<AuthenticatedOwnPrincipal | undefined>;
}

/** The trusted integration boundary for decision and workspace authorization. */
export interface OwnerSignatureAuthorizer {
  authorize(input: {
    readonly owner: AuthenticatedOwnPrincipal;
    readonly target: TrackNativeDecisionTarget;
  }): Promise<boolean>;
}

/**
 * The co-specified Track ingest/read-back contract required for a real owner signature.
 * Current `@sentropic/track/ingest@1.2.0` does not implement this shape, so production wiring
 * must supply a future pinned adapter instead of weakening attester/relayer provenance.
 */
export interface TrackOwnerSignaturePort {
  readonly contractVersion: string;
  appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult>;
  readOwnerSignature(input: {
    readonly target: TrackNativeDecisionTarget;
    readonly idempotencyKey: string;
  }): Promise<PersistedOwnerSignature | undefined>;
}

/** Dependencies owned by the host that knows its own-principal and tenancy policy. */
export interface FocusLiveSessionDependencies {
  readonly ownPrincipal: OwnPrincipalAuthenticator;
  readonly authorizer: OwnerSignatureAuthorizer;
  readonly track: TrackOwnerSignaturePort;
  /** Exact Track signature-ingest contract version accepted by this host. */
  readonly expectedTrackContractVersion: string;
}

const hasText = (value: string): boolean => value.trim().length > 0;

const isRequestWellFormed = (request: OwnerSignatureRequest): boolean =>
  hasText(request.target.workspace) &&
  hasText(request.target.decisionId) &&
  hasText(request.idempotencyKey) &&
  hasText(request.relayer.relayerId);

const confirms = (
  persisted: PersistedOwnerSignature,
  write: TrackOwnerSignatureWrite,
  recordId: string,
): boolean =>
  persisted.recordId === recordId &&
  persisted.contractVersion === write.contractVersion &&
  persisted.target.workspace === write.target.workspace &&
  persisted.target.decisionId === write.target.decisionId &&
  persisted.idempotencyKey === write.idempotencyKey &&
  persisted.attestation.attester.principalId === write.attestation.attester.principalId &&
  persisted.attestation.attester.authenticatedAt === write.attestation.attester.authenticatedAt &&
  persisted.relayer.transport === write.relayer.transport &&
  persisted.relayer.relayerId === write.relayer.relayerId;

/**
 * Fail-closed live driver for owner acceptance of an existing Track-native decision.
 * A write receipt alone never means signed: only matching persisted read-back returns `signed`.
 */
export class FocusLiveSessionDriver implements FocusLiveSession {
  constructor(private readonly dependencies: FocusLiveSessionDependencies) {}

  async sign(request: OwnerSignatureRequest): Promise<OwnerSignatureResult> {
    if (!isRequestWellFormed(request)) {
      return { status: "not-done", reason: "invalid-signature-request" };
    }

    let owner: AuthenticatedOwnPrincipal | undefined;
    try {
      owner = await this.dependencies.ownPrincipal.authenticate(request);
    } catch {
      return { status: "not-done", reason: "owner-authentication-invalid" };
    }
    if (owner === undefined) {
      return { status: "not-done", reason: "owner-authentication-required" };
    }
    if (!hasText(owner.principalId) || !hasText(owner.authenticatedAt)) {
      return { status: "not-done", reason: "owner-authentication-invalid" };
    }
    if (owner.principalId === request.relayer.relayerId) {
      return { status: "not-done", reason: "attester-relayer-conflict" };
    }

    try {
      const authorized = await this.dependencies.authorizer.authorize({ owner, target: request.target });
      if (!authorized) return { status: "not-done", reason: "authorization-denied" };
    } catch {
      return { status: "not-done", reason: "authorization-denied" };
    }

    if (this.dependencies.track.contractVersion !== this.dependencies.expectedTrackContractVersion) {
      return { status: "not-done", reason: "track-contract-mismatch" };
    }

    const write: TrackOwnerSignatureWrite = {
      contractVersion: this.dependencies.expectedTrackContractVersion,
      target: request.target,
      attestation: { attester: owner },
      relayer: request.relayer,
      idempotencyKey: request.idempotencyKey,
    };

    let receipt: TrackOwnerSignatureWriteResult;
    try {
      receipt = await this.dependencies.track.appendOwnerSignature(write);
    } catch {
      return { status: "not-done", reason: "track-write-failed" };
    }

    try {
      const persisted = await this.dependencies.track.readOwnerSignature({
        target: request.target,
        idempotencyKey: request.idempotencyKey,
      });
      if (persisted === undefined || !confirms(persisted, write, receipt.recordId)) {
        return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
      }
      return { status: "signed", duplicate: receipt.status === "duplicate", persisted };
    } catch {
      return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
    }
  }
}
