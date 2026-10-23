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
 * FinalizationCoordinator here to leave the fixed coordinator-role
 * descriptor untouched.
 */
import type { CommitBarrierObserver, CommitBarrierPoint } from '../../testing.js';

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

/** A4 participant lock order inside the finalization transaction. */
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
export interface ArtifactCommitContext extends ArtifactInvocationContext {
  readonly operation: string;
  readonly artifactId: string;
  readonly bindingId: string;
  readonly commandIdentity: CommandIdentity;
  readonly policyRevision: string;
  readonly purpose: CommitPurpose;
}

/**
 * Opaque fence minted by the transaction-bound policy participant. It is
 * bound to one invocation and revision and is verified by the coordinator;
 * it cannot be synthesized from the revision string.
 */
export interface ArtifactAuthorizationFence {
  readonly fenceId: string;
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

/** Host guard: current account/cohort/activation/object/quota policy. */
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
  readonly transactionId: string;
  readonly invocationId: string;
  readonly policyRevision: string;
  readonly participant: CommitPolicyParticipant;
}

/** Current policy reads and provisional quota reservation on this transaction. */
export interface CommitPolicyParticipant {
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
  mintFence(revision: string, invocationId: string): ArtifactAuthorizationFence;
}

/** Factory binding a participant to one finalization connection. */
export interface CommitPolicyParticipantFactory {
  createParticipant(client: FinalizeTxClient, transactionToken: string): CommitPolicyParticipant;
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

/** Classified internal failure with private cause and commit state. */
export interface ArtifactFailure {
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
  /** Defined clock for activation-expiry evaluation; defaults to Date.now. */
  readonly nowMs?: () => number;
  readonly testObserver?: CommitBarrierObserver;
  /**
   * Points at which the test observer is invoked. Empty by default: an
   * unarmed observer is never invoked, so unbarriered runs never pause.
   * Each armed pair pauses at most once.
   */
  readonly testPoints?: readonly CoordinatorTestPoint[];
}

/** The atomic finalization coordinator. */
export interface FinalizationCoordinator {
  finalize(request: FinalizeRequest): Promise<FinalizeResult>;
  replayGuarded(request: FinalizeRequest): Promise<FinalizeResult>;
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
