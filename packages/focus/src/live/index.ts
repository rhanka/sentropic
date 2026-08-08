import type {
  AuthenticatedOwnPrincipal,
  FocusOwnerSignatureContractVersion,
  FocusLiveSession,
  OwnerSignatureIdentity,
  OwnerSignatureRequest,
  OwnerSignatureResult,
  PersistedOwnerSignature,
  TrackNativeDecisionTarget,
  TrackOwnerSignatureWrite,
  TrackOwnerSignatureWriteResult,
} from "../model.js";
import { FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION } from "../model.js";

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
  readonly contractVersion: FocusOwnerSignatureContractVersion;
  /**
   * Atomically create or return the record unique on `{ ownerPrincipalId, workspace, decisionId }`.
   * Implementations MUST enforce that uniqueness in their durable store (for example with an
   * upsert or unique constraint); a process-local read-then-insert is not a valid implementation.
   */
  appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult>;
  readOwnerSignature(
    input: OwnerSignatureIdentity & { readonly idempotencyKey: string },
  ): Promise<PersistedOwnerSignature | undefined>;
}

/** Dependencies owned by the host that knows its own-principal and tenancy policy. */
export interface FocusLiveSessionDependencies {
  readonly ownPrincipal: OwnPrincipalAuthenticator;
  readonly authorizer: OwnerSignatureAuthorizer;
  readonly track: TrackOwnerSignaturePort;
}

const hasText = (value: string): boolean => value.trim().length > 0;

const copyText = (value: string): string => `${value}`;

const isRequestWellFormed = (request: OwnerSignatureRequest): boolean =>
  hasText(request.target.workspace) &&
  hasText(request.target.decisionId) &&
  hasText(request.idempotencyKey) &&
  hasText(request.relayer.relayerId);

interface RequestSignatureScalars {
  readonly workspace: string;
  readonly decisionId: string;
  readonly relayerTransport: "cli" | "http" | "mcp-stdio" | "internal";
  readonly relayerId: string;
  readonly idempotencyKey: string;
  readonly contractVersion: FocusOwnerSignatureContractVersion;
}

interface ConfirmedSignatureScalars extends RequestSignatureScalars {
  readonly ownerPrincipalId: string;
  readonly authenticatedAt: string;
  readonly recordId: string;
}

const freezeTarget = (snapshot: Pick<RequestSignatureScalars, "workspace" | "decisionId">): TrackNativeDecisionTarget =>
  Object.freeze({ workspace: snapshot.workspace, decisionId: snapshot.decisionId });

const freezeAttester = (
  snapshot: Pick<ConfirmedSignatureScalars, "ownerPrincipalId" | "authenticatedAt">,
): AuthenticatedOwnPrincipal =>
  Object.freeze({ principalId: snapshot.ownerPrincipalId, authenticatedAt: snapshot.authenticatedAt });

const freezeRelayer = (
  snapshot: Pick<RequestSignatureScalars, "relayerTransport" | "relayerId">,
) => Object.freeze({ transport: snapshot.relayerTransport, relayerId: snapshot.relayerId });

const freezePortWrite = (
  snapshot: RequestSignatureScalars & Pick<ConfirmedSignatureScalars, "ownerPrincipalId" | "authenticatedAt">,
): TrackOwnerSignatureWrite =>
  Object.freeze({
    contractVersion: snapshot.contractVersion,
    target: freezeTarget(snapshot),
    attestation: Object.freeze({ attester: freezeAttester(snapshot) }),
    relayer: freezeRelayer(snapshot),
    idempotencyKey: snapshot.idempotencyKey,
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Runtime validation is required because an injected port can violate its TypeScript declaration. */
const isWrittenReceipt = (value: unknown): value is TrackOwnerSignatureWriteResult =>
  isObject(value) &&
  (value.status === "written" || value.status === "duplicate") &&
  typeof value.recordId === "string" &&
  hasText(value.recordId);

const confirms = (
  persisted: unknown,
  snapshot: ConfirmedSignatureScalars,
): boolean =>
  isObject(persisted) &&
  isObject(persisted.target) &&
  isObject(persisted.attestation) &&
  isObject(persisted.attestation.attester) &&
  isObject(persisted.relayer) &&
  persisted.recordId === snapshot.recordId &&
  persisted.contractVersion === snapshot.contractVersion &&
  persisted.target.workspace === snapshot.workspace &&
  persisted.target.decisionId === snapshot.decisionId &&
  persisted.idempotencyKey === snapshot.idempotencyKey &&
  persisted.attestation.attester.principalId === snapshot.ownerPrincipalId &&
  persisted.attestation.attester.authenticatedAt === snapshot.authenticatedAt &&
  persisted.relayer.transport === snapshot.relayerTransport &&
  persisted.relayer.relayerId === snapshot.relayerId;

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

    // Copy all caller-controlled primitives before authentication can yield to another actor.
    const requestSnapshot: RequestSignatureScalars = Object.freeze({
      workspace: copyText(request.target.workspace),
      decisionId: copyText(request.target.decisionId),
      relayerTransport: request.relayer.transport,
      relayerId: copyText(request.relayer.relayerId),
      idempotencyKey: copyText(request.idempotencyKey),
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
    });
    const authenticationRequest: OwnerSignatureRequest = Object.freeze({
      target: freezeTarget(requestSnapshot),
      authentication: request.authentication,
      relayer: freezeRelayer(requestSnapshot),
      idempotencyKey: requestSnapshot.idempotencyKey,
    });

    let owner: AuthenticatedOwnPrincipal | undefined;
    try {
      owner = await this.dependencies.ownPrincipal.authenticate(authenticationRequest);
    } catch {
      return { status: "not-done", reason: "owner-authentication-invalid" };
    }
    if (owner === undefined) {
      return { status: "not-done", reason: "owner-authentication-required" };
    }
    if (!hasText(owner.principalId) || !hasText(owner.authenticatedAt)) {
      return { status: "not-done", reason: "owner-authentication-invalid" };
    }
    const ownerSnapshot = Object.freeze({
      ownerPrincipalId: copyText(owner.principalId),
      authenticatedAt: copyText(owner.authenticatedAt),
    });
    if (ownerSnapshot.ownerPrincipalId === requestSnapshot.relayerId) {
      return { status: "not-done", reason: "attester-relayer-conflict" };
    }

    const authorizationOwner = freezeAttester(ownerSnapshot);
    const authorizationTarget = freezeTarget(requestSnapshot);

    try {
      const authorized = await this.dependencies.authorizer.authorize(
        Object.freeze({ owner: authorizationOwner, target: authorizationTarget }),
      );
      if (!authorized) return { status: "not-done", reason: "authorization-denied" };
    } catch {
      return { status: "not-done", reason: "authorization-denied" };
    }

    if (this.dependencies.track.contractVersion !== FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION) {
      return { status: "not-done", reason: "track-contract-mismatch" };
    }

    const write = freezePortWrite(Object.freeze({ ...requestSnapshot, ...ownerSnapshot }));

    let receipt: unknown;
    try {
      receipt = await this.dependencies.track.appendOwnerSignature(write);
    } catch {
      return { status: "not-done", reason: "track-write-failed" };
    }
    if (!isWrittenReceipt(receipt)) return { status: "not-done", reason: "track-write-failed" };

    const confirmationSnapshot: ConfirmedSignatureScalars = Object.freeze({
      ...requestSnapshot,
      ...ownerSnapshot,
      recordId: copyText(receipt.recordId),
    });

    try {
      const persisted = await this.dependencies.track.readOwnerSignature(
        Object.freeze({
          ownerPrincipalId: confirmationSnapshot.ownerPrincipalId,
          target: freezeTarget(confirmationSnapshot),
          idempotencyKey: confirmationSnapshot.idempotencyKey,
        }),
      );
      if (persisted === undefined || !confirms(persisted, confirmationSnapshot)) {
        return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
      }
      return { status: "signed", duplicate: receipt.status === "duplicate", persisted };
    } catch {
      return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
    }
  }
}
