/**
 * L3 (immo #861) — finalization protocol types (spec r2 §§3.1–3.2).
 *
 * r2-exact server-side shapes, reconciled with the fixed L0 declarations:
 * invocation context, commit context with nested command identity, opaque
 * fence, typed authorization decision, opaque transaction plus the
 * coordinator-bound policy participant, lock order and coordinator
 * request/receipt types. Outcome shapes mirror the fixed success
 * correlation fields (invocationId, commitState, replayed travel on every
 * success). The export-map promotion of these modules is integration-owner
 * work qualified in L6/L8; the operational coordinator interface is named
 * ArtifactCommitCoordinator here to leave the fixed coordinator-role
 * descriptor untouched.
 */
import type { CommitArrivalObserver, CommitBarrierObserver, CommitBarrierPoint } from '../../testing.js';
import type { commitFenceBrand, commitTransactionBrand } from './brands.js';

/** Version of the frozen command-codec shape (r2 C6). */
export const COMMAND_CODEC_VERSION = 'artifacts-command/v1' as const;

/** Server-derived internal key: distinct from any caller key. */
export type InternalIdempotencyKey = string & { readonly __brand: 'internal-key' };

/** Server-created identity for one durable command. */
export interface CommandIdentity {
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly codecVersion: typeof COMMAND_CODEC_VERSION;
}

/**
 * A4 participant lock order inside the finalization transaction. The
 * coordinator acquires it in three groups: object locks up to and including
 * `authority-revision`, then an explicit authority re-read followed by the
 * `quota` callbacks and the provisional quota reservation (so the guard
 * decision never precedes the quota wait), then `blob-reference-deletion-claim`
 * callbacks and provisional writes. Guarded replay runs only the pre-quota
 * groups: it serializes with object/ACL/policy writers but neither charges
 * quota nor claims blob references.
 */
export const PARTICIPANT_LOCK_ORDER = [
  'binding-identity',
  'artifact-lifecycle',
  'acl',
  'current-pointer',
  'authority-revision',
  'quota',
  'blob-reference-deletion-claim',
] as const;

export type ParticipantLockClass = (typeof PARTICIPANT_LOCK_ORDER)[number];

/** Finalize or guarded replay. */
export type CommitPurpose = 'finalize' | 'replay';

/** Request-bound immutable invocation context (r2 §3.2). */
export interface ArtifactInvocationContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly authorizeCommit: AuthorizeCommit;
}

/** Commit context: invocation plus operation, identities, revision, purpose. */
export interface ArtifactCommitContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly operation: string;
  readonly artifactId: string;
  readonly bindingId: string;
  readonly commandIdentity: CommandIdentity;
  readonly policyRevision: string;
  readonly purpose: CommitPurpose;
}

/**
 * Opaque fence minted by the transaction-bound policy participant. It is
 * bound to one transaction, one invocation and one revision, and is
 * verified by the coordinator; it cannot be synthesized from the revision
 * string. This mirrors the frozen `ArtifactAuthorizationFence` role
 * (`l0-freeze/commit-contract.ts`): the `transactionId` carries the binding
 * to the coordinator-issued transaction, `fenceId` stays an opaque fence
 * identity. `mintFence` MUST return `transactionId` equal to the transaction
 * token the coordinator supplied to `createParticipant` for this
 * transaction. The coordinator rejects any fence whose `transactionId`
 * differs from the current transaction, whose `fenceId` is empty, whose
 * invocation differs from the request, or whose revision differs from the
 * freshly re-read policy revision (`invalid_object`).
 */
export interface ArtifactAuthorizationFence {
  readonly [commitFenceBrand]: true;
  readonly fenceId: string;
  readonly transactionId: string;
  readonly invocationId: string;
  readonly policyRevision: string;
}

export type AuthorizationDenialReason =
  | 'denied'
  | 'revoked'
  | 'expired'
  | 'invalid_object'
  | 'unavailable';

/** Typed authorization decision: never an unqualified boolean. */
export type ArtifactAuthorizationDecision =
  | { readonly allowed: true; readonly fence: ArtifactAuthorizationFence }
  | {
      readonly allowed: false;
      readonly reason: AuthorizationDenialReason;
      readonly publicCode: string;
      readonly status: number;
      readonly retriable: boolean;
    };

/**
 * Host guard: current account/cohort/activation/object/quota policy. The
 * coordinator may invoke the guard twice per finalization: once for the
 * guarded decision after all lock/quota waits, and once to revalidate after
 * the post-guard receipt/intent/barrier waits before COMMIT. The guard MUST
 * therefore be side-effect-free (policy reads plus fence minting); only the
 * second allowed decision gates the commit.
 */
export type AuthorizeCommit = (
  context: ArtifactCommitContext,
  transaction: ArtifactCommitTransaction,
) => Promise<ArtifactAuthorizationDecision>;

/**
 * Opaque transaction identity plus the host's registered
 * transaction-bound policy/quota participant. No commit, rollback,
 * release, SQL or connection capability for the guard. The participant
 * handle is a coordinator-internal extension of the fixed opaque shape;
 * fixed-typed guards still accept this object structurally.
 */
export interface ArtifactCommitTransaction {
  readonly [commitTransactionBrand]: true;
  readonly transactionId: string;
  readonly invocationId: string;
  readonly policyRevision: string;
  readonly participant: ArtifactCommitParticipant;
}

/**
 * Current policy reads and provisional quota reservation on this
 * transaction. This is the mechanism-level seam behind the frozen
 * `ArtifactCommitParticipant` role (`l0-freeze/commit-contract.ts`): the
 * separate revision/approval reads (instead of one bundled admission read)
 * exist so the coordinator can order the authority lock before the quota
 * wait (A4.4) and re-read both after post-guard waits (A4.6).
 */
export interface ArtifactPolicyDriver {
  /** Read the current policy revision row (shared lock) on this transaction. */
  readRevision(): Promise<string>;
  /** Check account/cohort/activation approval under the current revision. */
  checkApproval(input: {
    actorId: string;
    operation: string;
  }): Promise<{ approved: boolean; reason?: AuthorizationDenialReason }>;
  /**
   * Provisionally reserve quota on this transaction. Rolls back with the
   * unit when the guard denies or the unit conflicts.
   */
  reserveQuota(input: {
    actorId: string;
    operation: string;
  }): Promise<{ reserved: boolean }>;
  /** Mint the opaque fence for an allowed decision. */
  mintFence(revision: string, invocationId: string): Omit<ArtifactAuthorizationFence, typeof commitFenceBrand>;
}

/** Frozen participant ABI plus coordinator-internal policy reads and fence minting. */
export interface ArtifactCommitParticipant extends Omit<ArtifactPolicyDriver, 'reserveQuota' | 'mintFence'> {
  readonly policyRevision: string;
  readAdmission(input: AdmissionReadInput): Promise<AdmissionReadResult>;
  reserveQuota(input: QuotaReserveInput | { actorId: string; operation: string }): Promise<{ reserved: boolean }>;
  mintFence(revision: string, invocationId: string): ArtifactAuthorizationFence;
}
export interface AdmissionReadInput {
  readonly operation: string;
  readonly artifactId: string;
  readonly bindingId: string;
  readonly actorId: string;
  readonly policyRevision: string;
}
export interface AdmissionReadResult {
  readonly allowed: boolean;
  readonly reason: AuthorizationDenialReason;
}
export interface QuotaReserveInput {
  readonly storageScopeId: string;
  readonly operation: string;
  readonly bytes: number;
}

/** Factory binding a participant to one finalization connection. */
export interface CommitPolicyParticipantFactory {
  createParticipant(client: FinalizeTxClient, transactionToken: string): ArtifactPolicyDriver;
}

/** Constrained transaction handle for provider-internal provisional work. */
export interface FinalizeTxClient {
  query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

/** Finalization connection: coordinator-owned lifecycle plus receipt SQL. */
export interface FinalizeConnection extends FinalizeTxClient {
  beginReadCommitted(): Promise<void>;
  lockOperationKey(scopeId: string, internalKey: string): Promise<void>;
  readReceipt(scopeId: string, internalKey: string): Promise<StoredCommitReceipt | undefined>;
  insertReceipt(receipt: StoredCommitReceipt): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /**
   * Return the client. Pass the failure when the session state is
   * uncertain (failed COMMIT/rollback): the client is destroyed instead
   * of rejoining the pool with an open transaction and held locks.
   */
  release(error?: unknown): void;
}

/** Executor seam: coordination row and raw finalization connections. */
export interface CommitExecutor {
  ensureCoordinationRow(scopeId: string, internalKey: string): Promise<void>;
  beginFinalization(): Promise<FinalizeConnection>;
}

/** One caller lock callback, run inside the coordinator transaction. */
export type CommitLockFn = (client: FinalizeTxClient) => Promise<void>;

/** Durable success receipt stored once per (scope, internal key). */
export interface StoredCommitReceipt {
  readonly scopeId: string;
  readonly internalKey: string;
  readonly commandHash: string;
  readonly codecVersion: string;
  readonly receipt: unknown;
  readonly createdAt: string;
}

/** Coordinator-owned test observation points. */
export type CoordinatorTestPoint =
  | 'before_connection_acquire'
  | 'before_key_lock'
  | 'before_finalization_row_lock'
  | 'after_finalization_locks_before_guard'
  | 'after_replay_lookup_before_guard'
  | 'before_commit';

export const COORDINATOR_TEST_POINTS: readonly CommitBarrierPoint[] = [
  'before_connection_acquire',
  'before_key_lock',
  'before_finalization_row_lock',
  'after_finalization_locks_before_guard',
  'after_replay_lookup_before_guard',
  'before_commit',
];

/** One atomic finalization request. */
export interface FinalizeRequest {
  readonly scopeId: string;
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly codecVersion: string;
  readonly invocationId: string;
  readonly actorId: string;
  readonly operation: string;
  readonly artifactId?: string | null;
  readonly bindingName?: string | null;
  readonly policyRevision: string;
  /** Fixed class order; stable bytewise order within each class is the caller's obligation. */
  readonly locks?: Partial<Record<ParticipantLockClass, CommitLockFn[]>>;
  /** Provisional writes before the guard decision. */
  readonly provisional?: (client: FinalizeTxClient) => Promise<void>;
  /** Intent completion inside the unit, after the success insert. */
  readonly finishIntents?: (client: FinalizeTxClient) => Promise<void>;
  /** Preparation-abandonment hook, invoked on loser/denial paths. */
  readonly noteAbandonedAttempt?: (attemptId: string) => Promise<void>;
  readonly attemptId?: string;
  readonly guard: AuthorizeCommit;
  readonly receiptData: unknown;
  /** Domain identity must still match the winner under the replay locks. */
  readonly validateReplayReceipt?: (receipt: StoredCommitReceipt) => boolean;
}

/** Internal failure categories (r2 E2). */
export const FAILURE_CATEGORIES = [
  'capability_unselected',
  'provider_unavailable',
  'conflict',
  'unauthorized_at_commit',
  'provider_error',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Frozen category-to-public projection (r2 E2). */
export interface FailureProjection {
  readonly category: FailureCategory;
  readonly variant?: string;
  readonly httpStatus: number;
  readonly publicCode: string;
  /** Null when the failure happens before dispatch and creates no ledger entry. */
  readonly ledgerReason: string | null;
  readonly retriable: boolean;
}

export const FAILURE_PROJECTIONS: readonly FailureProjection[] = [
  {
    category: 'capability_unselected', variant: 'unselected_operation',
    httpStatus: 503, publicCode: 'capability_unavailable', ledgerReason: null,
    retriable: false,
  },
  {
    category: 'provider_unavailable', variant: 'dispatch_failure',
    httpStatus: 503, publicCode: 'capability_unavailable', ledgerReason: 'provider_unavailable',
    retriable: true,
  },
  {
    category: 'conflict', variant: 'key_contention',
    httpStatus: 409, publicCode: 'conflict', ledgerReason: 'provider_conflict',
    retriable: false,
  },
  {
    category: 'conflict', variant: 'quota_exhausted',
    httpStatus: 409, publicCode: 'conflict', ledgerReason: 'provider_conflict',
    retriable: false,
  },
  {
    category: 'unauthorized_at_commit', variant: 'policy_denial',
    httpStatus: 403, publicCode: 'access_denied', ledgerReason: 'unauthorized_at_commit',
    retriable: false,
  },
  {
    category: 'unauthorized_at_commit', variant: 'authority_unavailable',
    httpStatus: 503, publicCode: 'capability_unavailable', ledgerReason: 'unauthorized_at_commit',
    retriable: true,
  },
  {
    category: 'provider_error', variant: 'unclassified',
    httpStatus: 500, publicCode: 'internal_error', ledgerReason: 'provider_error',
    retriable: false,
  },
] as const;

/**
 * Classified internal failure with private cause and commit state. Carries
 * the frozen `operational` kind so L3 outcomes are assignable to the frozen
 * failure contract (`l0-freeze/failure-contract.ts`).
 */
export interface ArtifactFailure {
  readonly kind: 'operational';
  readonly category: FailureCategory;
  readonly variant?: string;
  readonly httpStatus: number;
  readonly publicCode: string;
  readonly retriable: boolean;
  readonly invocationId: string;
  readonly operation: string;
  readonly phase: string;
  readonly commitState: 'not_committed' | 'committed' | 'unknown';
  readonly cause: unknown;
}

/**
 * Internal discriminated outcome. Success carries invocation identity,
 * commit state and the replay flag alongside the result, mirroring the
 * fixed success correlation fields.
 */
export type ArtifactOutcome<T> =
  | {
      readonly ok: true;
      readonly result: T;
      readonly invocationId: string;
      readonly commitState: 'committed';
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly failure: ArtifactFailure };

/** Coordinator result: the stored receipt plus fixed success correlation. */
export type FinalizeResult = ArtifactOutcome<StoredCommitReceipt>;

/** Coordinator construction options. */
export interface CommitCoordinatorOptions {
  readonly executor: CommitExecutor;
  readonly policy: CommitPolicyParticipantFactory;
  /** Trusted domain adapters; every call resolves fresh state, including replay. */
  readonly operations?: {
    readonly guardedOperations: readonly string[];
    finalize(input: FinalizationInput): Promise<FinalizeRequest>;
    replay(input: ReplayInput): Promise<FinalizeRequest>;
  };
  /** Defined clock for activation-expiry evaluation; defaults to Date.now. */
  readonly nowMs?: () => number;
  readonly testObserver?: CommitBarrierObserver | CommitArrivalObserver;
  /**
   * Optional filter for observer arrivals; all coordinator points by default.
   * Each armed pair pauses at most once. Only the six coordinator
   * transaction points are accepted; the three preparation points
   * (`before_blob_put`, `after_blob_put_before_verify`,
   * `before_blob_readback`) are fired by L4 preparation adapters holding the
   * same observer, never by this coordinator (preparation precedes the key
   * lock per A4.2). Arming a point the coordinator never fires throws at
   * construction instead of hanging a test.
   */
  readonly testPoints?: readonly CoordinatorTestPoint[];
}

/**
 * The atomic finalization coordinator mechanism. It implements the unit
 * owned by the frozen `ArtifactCommitCoordinator` role
 * (`l0-freeze/commit-contract.ts`): `finalize`/`replayGuarded` are the
 * mechanism behind `finalizeOperation`/`replayOperation`. The frozen role
 * binds `HttpRequest`/invocation/effective-command at the app layer (L5/L6
 * composition); this interface operates on internal keys below that
 * binding. The two layers share the fence/transaction/phase semantics, not
 * the input types; no wrapper or private-type cast bridges them.
 */
export const COMMIT_PROTOCOL_VERSION = 'artifacts-commit/v1' as const;
export interface FinalizationRecord {
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly codecVersion: typeof COMMAND_CODEC_VERSION;
  readonly replayed: boolean;
}
export interface FinalizationInput {
  readonly request: {
    readonly method: string; readonly path: string;
    readonly headers: Record<string, string>; readonly body: unknown;
  };
  readonly invocation: ArtifactInvocationContext;
  readonly command: {
    readonly operation: string; readonly scopeBinding: string;
    readonly payload: Record<string, unknown>;
    readonly provenance: { readonly kind: 'inline-original' };
    readonly identity: CommandIdentity;
  };
}
export interface ReplayInput {
  readonly invocation: ArtifactInvocationContext;
  readonly internalKey: InternalIdempotencyKey;
}
export interface ArtifactCommitCoordinator {
  readonly protocolVersion: typeof COMMIT_PROTOCOL_VERSION;
  readonly guardedOperations: readonly string[];
  readonly testObserver?: CommitArrivalObserver;
  finalizeOperation(input: FinalizationInput): Promise<ArtifactOutcome<FinalizationRecord>>;
  replayOperation(input: ReplayInput): Promise<ArtifactOutcome<FinalizationRecord>>;
  /** Provider-internal prepared units; domain effects remain inside the same transaction. */
  finalizePrepared(request: FinalizeRequest): Promise<FinalizeResult>;
  replayPrepared(request: FinalizeRequest): Promise<FinalizeResult>;
}

/** Unknown legacy codec on a found success row: L6 projects the migration condition. */
export class CommitQuarantineError extends Error {
  readonly scopeId: string;
  readonly internalKey: string;
  readonly codecVersion: string;
  constructor(scopeId: string, internalKey: string, codecVersion: string) {
    super(`commit quarantine: codec ${codecVersion} for ${scopeId}/${internalKey}`);
    this.name = 'CommitQuarantineError';
    this.scopeId = scopeId;
    this.internalKey = internalKey;
    this.codecVersion = codecVersion;
  }
}
