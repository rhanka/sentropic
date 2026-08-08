import type {
  AuthenticatedOwnPrincipal,
  CanonicalPrincipalIdentity,
  FocusOwnerSignatureContractVersion,
  FocusLiveSession,
  OwnerSignatureDurableUniquenessKey,
  OwnerSignatureIdentity,
  OwnerSignatureRequest,
  OwnerSignatureResult,
  PersistedOwnerSignature,
  RelayerProvenance,
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
 * Trusted host-owned transport provenance. It is deliberately separate from the caller request:
 * callers must never assert the identity recorded as the relayer.
 */
export interface TrustedRelayerProvenancePort {
  getRelayerProvenance(): Promise<RelayerProvenance>;
}

/**
 * The co-specified Track ingest/read-back contract required for a real owner signature.
 * Current `@sentropic/track/ingest@1.2.0` does not implement this shape, so production wiring
 * must supply a future pinned adapter instead of weakening attester/relayer provenance.
 */
export interface TrackOwnerSignaturePort {
  readonly contractVersion: FocusOwnerSignatureContractVersion;
  /**
   * Atomically create or return the record unique on the
   * `OwnerSignatureDurableUniquenessKey` `{ canonical owner issuer+subject, workspace,
   * decisionId }`. `idempotencyKey` is intentionally excluded: it only identifies an identical
   * retry and never authorizes a second durable owner signature. Production implementations MUST
   * enforce this uniqueness with a durable database constraint/upsert and transactionally read
   * the persisted attestation back. Process-local locking or a check-then-insert sequence is not
   * a valid implementation: the driver deliberately relies on this port-level contract.
   */
  appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult>;
  /** Read the canonical durable record by the same uniqueness key, never by idempotency key. */
  readOwnerSignature(input: OwnerSignatureDurableUniquenessKey): Promise<PersistedOwnerSignature | undefined>;
}

/** Dependencies owned by the host that knows its own-principal, transport, and tenancy policy. */
export interface FocusLiveSessionDependencies {
  readonly ownPrincipal: OwnPrincipalAuthenticator;
  readonly relayerProvenance: TrustedRelayerProvenancePort;
  readonly authorizer: OwnerSignatureAuthorizer;
  readonly track: TrackOwnerSignaturePort;
}

type RelayerTransport = RelayerProvenance["transport"];
type ReceiptStatus = TrackOwnerSignatureWriteResult["status"];

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRelayerTransport = (value: unknown): value is RelayerTransport =>
  value === "cli" || value === "http" || value === "mcp-stdio" || value === "internal";

const isReceiptStatus = (value: unknown): value is ReceiptStatus => value === "written" || value === "duplicate";

const copyText = (value: string): string => `${value}`;

const normalizeIdentityPart = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const captureBoundary = <T>(capture: () => T | undefined): T | undefined => {
  try {
    return capture();
  } catch {
    return undefined;
  }
};

type ImmutableProofPrimitive = undefined | null | boolean | number | string | bigint | symbol;
interface ImmutableProofArray extends ReadonlyArray<ImmutableProof> {}
interface ImmutableProofObject {
  readonly [key: string]: ImmutableProof;
}
type ImmutableProof = ImmutableProofPrimitive | ImmutableProofArray | ImmutableProofObject;

interface ImmutableProofCapture {
  readonly value: ImmutableProof;
}

/**
 * Reduce opaque proof input to a frozen, JSON-shaped value tree (plus immutable primitives).
 * Unsupported, cyclic, accessor-throwing, or proxy-throwing values are rejected before auth.
 */
const copyImmutableProof = (
  value: unknown,
  ancestors: ReadonlySet<object>,
): ImmutableProofCapture | undefined => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return { value };
  }
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return undefined;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    const length = value.length;
    if (Reflect.ownKeys(value).length !== length + 1) return undefined;

    const copy: ImmutableProof[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) return undefined;
      const item = copyImmutableProof(value[index], nextAncestors);
      if (item === undefined) return undefined;
      copy.push(item.value);
    }
    return { value: Object.freeze(copy) };
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) return undefined;

  const copy: Record<string, ImmutableProof> = Object.create(null) as Record<string, ImmutableProof>;
  for (const key of keys) {
    const item = copyImmutableProof((value as Record<string, unknown>)[key], nextAncestors);
    if (item === undefined) return undefined;
    Object.defineProperty(copy, key, {
      configurable: false,
      enumerable: true,
      value: item.value,
      writable: false,
    });
  }
  return { value: Object.freeze(copy) };
};

const captureImmutableProof = (value: unknown): ImmutableProofCapture | undefined =>
  captureBoundary(() => copyImmutableProof(value, new Set<object>()));

interface RequestSignatureScalars {
  readonly workspace: string;
  readonly decisionId: string;
  readonly authenticationProof: ImmutableProof;
  readonly idempotencyKey: string;
  readonly contractVersion: FocusOwnerSignatureContractVersion;
}

interface OwnerSignatureScalars {
  readonly ownerPrincipalId: string;
  readonly ownerAuthenticatedAt: string;
  readonly ownerCanonicalIdentity: CanonicalPrincipalIdentity;
}

interface RelayerSignatureScalars {
  readonly relayerTransport: RelayerTransport;
  readonly relayerId: string;
  readonly relayerCanonicalIdentity: CanonicalPrincipalIdentity;
}

interface ConfirmedSignatureScalars
  extends Omit<RequestSignatureScalars, "authenticationProof">,
    OwnerSignatureScalars,
    RelayerSignatureScalars {
  readonly recordId: string;
}

interface ReceiptScalars {
  readonly status: ReceiptStatus;
  readonly recordId: string;
}

const captureCanonicalIdentityUnsafe = (value: unknown): CanonicalPrincipalIdentity | undefined => {
  if (!isObject(value)) return undefined;

  const scalarSnapshot = Object.freeze({ issuer: value.issuer, subject: value.subject });
  if (!hasText(scalarSnapshot.issuer) || !hasText(scalarSnapshot.subject)) return undefined;

  return Object.freeze({
    issuer: normalizeIdentityPart(scalarSnapshot.issuer),
    subject: normalizeIdentityPart(scalarSnapshot.subject),
  });
};

const captureCanonicalIdentity = (value: unknown): CanonicalPrincipalIdentity | undefined =>
  captureBoundary(() => captureCanonicalIdentityUnsafe(value));

/** Capture every caller field once, then validate only the frozen scalar snapshot. */
const captureRequestUnsafe = (value: unknown): RequestSignatureScalars | undefined => {
  if (!isObject(value)) return undefined;

  const requestBoundary = Object.freeze({
    target: value.target,
    authentication: value.authentication,
    idempotencyKey: value.idempotencyKey,
  });
  if (!isObject(requestBoundary.target) || !isObject(requestBoundary.authentication)) return undefined;

  const scalarSnapshot = Object.freeze({
    workspace: requestBoundary.target.workspace,
    decisionId: requestBoundary.target.decisionId,
    authenticationKind: requestBoundary.authentication.kind,
    authenticationProof: requestBoundary.authentication.proof,
    idempotencyKey: requestBoundary.idempotencyKey,
  });
  const proofSnapshot = captureImmutableProof(scalarSnapshot.authenticationProof);
  if (
    scalarSnapshot.authenticationKind !== "own-principal" ||
    !hasText(scalarSnapshot.workspace) ||
    !hasText(scalarSnapshot.decisionId) ||
    !hasText(scalarSnapshot.idempotencyKey) ||
    proofSnapshot === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    workspace: copyText(scalarSnapshot.workspace),
    decisionId: copyText(scalarSnapshot.decisionId),
    authenticationProof: proofSnapshot.value,
    idempotencyKey: copyText(scalarSnapshot.idempotencyKey),
    contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  });
};

const captureRequest = (value: unknown): RequestSignatureScalars | undefined =>
  captureBoundary(() => captureRequestUnsafe(value));

/** Capture a runtime authentication result once; null, arrays, and malformed shapes are invalid. */
const captureAuthenticatedOwnerUnsafe = (value: unknown): OwnerSignatureScalars | undefined => {
  if (!isObject(value)) return undefined;

  const scalarSnapshot = Object.freeze({
    principalId: value.principalId,
    authenticatedAt: value.authenticatedAt,
    canonicalIdentity: value.canonicalIdentity,
  });
  if (!hasText(scalarSnapshot.principalId) || !hasText(scalarSnapshot.authenticatedAt)) return undefined;

  const canonicalIdentity = captureCanonicalIdentity(scalarSnapshot.canonicalIdentity);
  if (canonicalIdentity === undefined) return undefined;

  return Object.freeze({
    ownerPrincipalId: copyText(scalarSnapshot.principalId),
    ownerAuthenticatedAt: copyText(scalarSnapshot.authenticatedAt),
    ownerCanonicalIdentity: canonicalIdentity,
  });
};

const captureAuthenticatedOwner = (value: unknown): OwnerSignatureScalars | undefined =>
  captureBoundary(() => captureAuthenticatedOwnerUnsafe(value));

/** Capture trusted relayer provenance once; callers cannot supply this value. */
const captureRelayerProvenanceUnsafe = (value: unknown): RelayerSignatureScalars | undefined => {
  if (!isObject(value)) return undefined;

  const scalarSnapshot = Object.freeze({
    transport: value.transport,
    relayerId: value.relayerId,
    canonicalIdentity: value.canonicalIdentity,
  });
  if (!isRelayerTransport(scalarSnapshot.transport) || !hasText(scalarSnapshot.relayerId)) return undefined;

  const canonicalIdentity = captureCanonicalIdentity(scalarSnapshot.canonicalIdentity);
  if (canonicalIdentity === undefined) return undefined;

  return Object.freeze({
    relayerTransport: scalarSnapshot.transport,
    relayerId: copyText(scalarSnapshot.relayerId),
    relayerCanonicalIdentity: canonicalIdentity,
  });
};

const captureRelayerProvenance = (value: unknown): RelayerSignatureScalars | undefined =>
  captureBoundary(() => captureRelayerProvenanceUnsafe(value));

/** Capture a port-owned receipt once; no receipt property is ever consulted after this boundary. */
const captureReceiptUnsafe = (value: unknown): ReceiptScalars | undefined => {
  if (!isObject(value)) return undefined;

  const scalarSnapshot = Object.freeze({ status: value.status, recordId: value.recordId });
  if (!isReceiptStatus(scalarSnapshot.status) || !hasText(scalarSnapshot.recordId)) return undefined;

  return Object.freeze({ status: scalarSnapshot.status, recordId: copyText(scalarSnapshot.recordId) });
};

const captureReceipt = (value: unknown): ReceiptScalars | undefined =>
  captureBoundary(() => captureReceiptUnsafe(value));

const freezeTarget = (snapshot: Pick<RequestSignatureScalars, "workspace" | "decisionId">): TrackNativeDecisionTarget =>
  Object.freeze({ workspace: snapshot.workspace, decisionId: snapshot.decisionId });

const freezeCanonicalIdentity = (identity: CanonicalPrincipalIdentity): CanonicalPrincipalIdentity =>
  Object.freeze({ issuer: identity.issuer, subject: identity.subject });

const freezeAttester = (snapshot: OwnerSignatureScalars): AuthenticatedOwnPrincipal =>
  Object.freeze({
    principalId: snapshot.ownerPrincipalId,
    canonicalIdentity: freezeCanonicalIdentity(snapshot.ownerCanonicalIdentity),
    authenticatedAt: snapshot.ownerAuthenticatedAt,
  });

const freezeRelayer = (snapshot: RelayerSignatureScalars): RelayerProvenance =>
  Object.freeze({
    transport: snapshot.relayerTransport,
    relayerId: snapshot.relayerId,
    canonicalIdentity: freezeCanonicalIdentity(snapshot.relayerCanonicalIdentity),
  });

const freezeAuthentication = (snapshot: RequestSignatureScalars): OwnerSignatureRequest["authentication"] =>
  Object.freeze({ kind: "own-principal", proof: snapshot.authenticationProof });

const freezePortWrite = (
  snapshot: RequestSignatureScalars & OwnerSignatureScalars & RelayerSignatureScalars,
): TrackOwnerSignatureWrite =>
  Object.freeze({
    contractVersion: snapshot.contractVersion,
    target: freezeTarget(snapshot),
    attestation: Object.freeze({ attester: freezeAttester(snapshot) }),
    relayer: freezeRelayer(snapshot),
    idempotencyKey: snapshot.idempotencyKey,
  });

const freezeIdentity = (
  snapshot: OwnerSignatureScalars & Pick<RequestSignatureScalars, "workspace" | "decisionId">,
): OwnerSignatureIdentity =>
  Object.freeze({
    ownerCanonicalIdentity: freezeCanonicalIdentity(snapshot.ownerCanonicalIdentity),
    target: freezeTarget(snapshot),
  });

const canonicalIdentityEquals = (left: CanonicalPrincipalIdentity, right: CanonicalPrincipalIdentity): boolean =>
  left.issuer === right.issuer && left.subject === right.subject;

/** Capture every field of an untrusted persisted record before validating the read-back. */
const capturePersistedSignatureUnsafe = (value: unknown): ConfirmedSignatureScalars | undefined => {
  if (!isObject(value)) return undefined;

  const recordBoundary = Object.freeze({
    recordId: value.recordId,
    contractVersion: value.contractVersion,
    target: value.target,
    attestation: value.attestation,
    relayer: value.relayer,
    idempotencyKey: value.idempotencyKey,
  });
  if (!isObject(recordBoundary.target) || !isObject(recordBoundary.attestation) || !isObject(recordBoundary.relayer)) {
    return undefined;
  }

  const attestationBoundary = Object.freeze({ attester: recordBoundary.attestation.attester });
  if (!isObject(attestationBoundary.attester)) return undefined;

  const scalarSnapshot = Object.freeze({
    recordId: recordBoundary.recordId,
    contractVersion: recordBoundary.contractVersion,
    workspace: recordBoundary.target.workspace,
    decisionId: recordBoundary.target.decisionId,
    idempotencyKey: recordBoundary.idempotencyKey,
    ownerPrincipalId: attestationBoundary.attester.principalId,
    ownerAuthenticatedAt: attestationBoundary.attester.authenticatedAt,
    ownerCanonicalIdentity: attestationBoundary.attester.canonicalIdentity,
    relayerTransport: recordBoundary.relayer.transport,
    relayerId: recordBoundary.relayer.relayerId,
    relayerCanonicalIdentity: recordBoundary.relayer.canonicalIdentity,
  });
  if (
    scalarSnapshot.contractVersion !== FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION ||
    !hasText(scalarSnapshot.recordId) ||
    !hasText(scalarSnapshot.workspace) ||
    !hasText(scalarSnapshot.decisionId) ||
    !hasText(scalarSnapshot.idempotencyKey) ||
    !hasText(scalarSnapshot.ownerPrincipalId) ||
    !hasText(scalarSnapshot.ownerAuthenticatedAt) ||
    !isRelayerTransport(scalarSnapshot.relayerTransport) ||
    !hasText(scalarSnapshot.relayerId)
  ) {
    return undefined;
  }

  const ownerCanonicalIdentity = captureCanonicalIdentity(scalarSnapshot.ownerCanonicalIdentity);
  const relayerCanonicalIdentity = captureCanonicalIdentity(scalarSnapshot.relayerCanonicalIdentity);
  if (ownerCanonicalIdentity === undefined || relayerCanonicalIdentity === undefined) return undefined;

  return Object.freeze({
    contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
    workspace: copyText(scalarSnapshot.workspace),
    decisionId: copyText(scalarSnapshot.decisionId),
    idempotencyKey: copyText(scalarSnapshot.idempotencyKey),
    ownerPrincipalId: copyText(scalarSnapshot.ownerPrincipalId),
    ownerAuthenticatedAt: copyText(scalarSnapshot.ownerAuthenticatedAt),
    ownerCanonicalIdentity,
    relayerTransport: scalarSnapshot.relayerTransport,
    relayerId: copyText(scalarSnapshot.relayerId),
    relayerCanonicalIdentity,
    recordId: copyText(scalarSnapshot.recordId),
  });
};

const capturePersistedSignature = (value: unknown): ConfirmedSignatureScalars | undefined =>
  captureBoundary(() => capturePersistedSignatureUnsafe(value));

const confirms = (
  persisted: ConfirmedSignatureScalars,
  expected: ConfirmedSignatureScalars,
  requireMatchingIdempotencyKey: boolean,
): boolean =>
  persisted.recordId === expected.recordId &&
  persisted.contractVersion === expected.contractVersion &&
  persisted.workspace === expected.workspace &&
  persisted.decisionId === expected.decisionId &&
  (!requireMatchingIdempotencyKey || persisted.idempotencyKey === expected.idempotencyKey) &&
  persisted.ownerPrincipalId === expected.ownerPrincipalId &&
  persisted.ownerAuthenticatedAt === expected.ownerAuthenticatedAt &&
  canonicalIdentityEquals(persisted.ownerCanonicalIdentity, expected.ownerCanonicalIdentity) &&
  persisted.relayerTransport === expected.relayerTransport &&
  persisted.relayerId === expected.relayerId &&
  canonicalIdentityEquals(persisted.relayerCanonicalIdentity, expected.relayerCanonicalIdentity);

const freezePersistedSignature = (snapshot: ConfirmedSignatureScalars): PersistedOwnerSignature =>
  Object.freeze({
    contractVersion: snapshot.contractVersion,
    target: freezeTarget(snapshot),
    attestation: Object.freeze({ attester: freezeAttester(snapshot) }),
    relayer: freezeRelayer(snapshot),
    idempotencyKey: snapshot.idempotencyKey,
    recordId: snapshot.recordId,
  });

/**
 * Fail-closed live driver for owner acceptance of an existing Track-native decision.
 * A write receipt alone never means signed: only matching persisted read-back returns `signed`.
 */
export class FocusLiveSessionDriver implements FocusLiveSession {
  private readonly ownPrincipal: OwnPrincipalAuthenticator;
  private readonly relayerProvenance: TrustedRelayerProvenancePort;
  private readonly authorizer: OwnerSignatureAuthorizer;
  private readonly track: TrackOwnerSignaturePort;

  constructor(dependencies: FocusLiveSessionDependencies) {
    this.ownPrincipal = dependencies.ownPrincipal;
    this.relayerProvenance = dependencies.relayerProvenance;
    this.authorizer = dependencies.authorizer;
    this.track = dependencies.track;
  }

  async sign(request: OwnerSignatureRequest): Promise<OwnerSignatureResult> {
    const requestSnapshot = captureRequest(request);
    if (requestSnapshot === undefined) return { status: "not-done", reason: "invalid-signature-request" };

    const authenticationRequest: OwnerSignatureRequest = Object.freeze({
      target: freezeTarget(requestSnapshot),
      authentication: freezeAuthentication(requestSnapshot),
      idempotencyKey: requestSnapshot.idempotencyKey,
    });

    let authenticationResult: unknown;
    try {
      const authenticate = this.ownPrincipal.authenticate;
      authenticationResult = await authenticate.call(this.ownPrincipal, authenticationRequest);
    } catch {
      return { status: "not-done", reason: "owner-authentication-invalid" };
    }
    if (authenticationResult === undefined) {
      return { status: "not-done", reason: "owner-authentication-required" };
    }

    const ownerSnapshot = captureAuthenticatedOwner(authenticationResult);
    if (ownerSnapshot === undefined) return { status: "not-done", reason: "owner-authentication-invalid" };

    let relayerResult: unknown;
    try {
      const getRelayerProvenance = this.relayerProvenance.getRelayerProvenance;
      relayerResult = await getRelayerProvenance.call(this.relayerProvenance);
    } catch {
      return { status: "not-done", reason: "relayer-provenance-invalid" };
    }
    const relayerSnapshot = captureRelayerProvenance(relayerResult);
    if (relayerSnapshot === undefined) return { status: "not-done", reason: "relayer-provenance-invalid" };

    if (canonicalIdentityEquals(ownerSnapshot.ownerCanonicalIdentity, relayerSnapshot.relayerCanonicalIdentity)) {
      return { status: "not-done", reason: "attester-relayer-conflict" };
    }

    const authorizationOwner = freezeAttester(ownerSnapshot);
    const authorizationTarget = freezeTarget(requestSnapshot);
    let authorizationResult: unknown;
    try {
      const authorize = this.authorizer.authorize;
      authorizationResult = await authorize.call(
        this.authorizer,
        Object.freeze({ owner: authorizationOwner, target: authorizationTarget }),
      );
    } catch {
      return { status: "not-done", reason: "authorization-denied" };
    }
    const authorizationSnapshot = Object.freeze({ authorized: authorizationResult });
    if (authorizationSnapshot.authorized !== true) {
      return { status: "not-done", reason: "authorization-denied" };
    }

    let trackContractVersion: unknown;
    try {
      trackContractVersion = this.track.contractVersion;
    } catch {
      return { status: "not-done", reason: "track-write-failed" };
    }
    const trackContractSnapshot = Object.freeze({ contractVersion: trackContractVersion });
    if (trackContractSnapshot.contractVersion !== FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION) {
      return { status: "not-done", reason: "track-contract-mismatch" };
    }

    const write = freezePortWrite(Object.freeze({ ...requestSnapshot, ...ownerSnapshot, ...relayerSnapshot }));

    let receiptResult: unknown;
    try {
      const appendOwnerSignature = this.track.appendOwnerSignature;
      receiptResult = await appendOwnerSignature.call(this.track, write);
    } catch {
      return { status: "not-done", reason: "track-write-failed" };
    }
    const receiptSnapshot = captureReceipt(receiptResult);
    if (receiptSnapshot === undefined) return { status: "not-done", reason: "track-write-failed" };

    const confirmationSnapshot: ConfirmedSignatureScalars = Object.freeze({
      ...requestSnapshot,
      ...ownerSnapshot,
      ...relayerSnapshot,
      recordId: receiptSnapshot.recordId,
    });

    let persistedResult: unknown;
    try {
      const readOwnerSignature = this.track.readOwnerSignature;
      persistedResult = await readOwnerSignature.call(this.track, freezeIdentity(confirmationSnapshot));
    } catch {
      return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
    }
    const persistedSnapshot = capturePersistedSignature(persistedResult);
    if (
      persistedSnapshot === undefined ||
      !confirms(persistedSnapshot, confirmationSnapshot, receiptSnapshot.status === "written")
    ) {
      return { status: "not-done", reason: "persisted-attestation-not-confirmed" };
    }

    return {
      status: "signed",
      duplicate: receiptSnapshot.status === "duplicate",
      persisted: freezePersistedSignature(persistedSnapshot),
    };
  }
}
