/**
 * L0 frozen commit declaration (immo #861, ask 2 shape, spec r2 section 3.2).
 *
 * Frozen server-side public exports for the Radar acceptance target:
 * request-bound invocation context, commit context, typed authorization
 * decision with an opaque fence, opaque commit transaction and the
 * coordinator role. Barrier points, lane lock order and app signatures
 * follow in later slices. Runtime implementation lands in L3.
 */

import type { CommandIdentity } from './command-identity-contract.js';
import type { ArtifactOutcome } from './failure-contract.js';
import type { CompiledArtifactsProfile } from './profile-contract.js';

/** Version of the frozen commit-coordinator protocol. */
export const COMMIT_PROTOCOL_VERSION = 'artifacts-commit/v1' as const;

/** Outcome of a COMMIT acknowledgment wait. */
export const COMMIT_STATES = ['not_committed', 'committed', 'unknown'] as const;

export type CommitState = (typeof COMMIT_STATES)[number];

/** Purpose of one guard invocation: final decision or replayed receipt. */
export const COMMIT_PURPOSES = ['finalize', 'replay'] as const;

export type CommitPurpose = (typeof COMMIT_PURPOSES)[number];

/**
 * Guard callback supplied by the trusted host through server context.
 * The provider invokes it after lock, pool-connection and object waits,
 * inside the finalization boundary, before committing success. No public
 * caller supplies SQL or a connection through this seam.
 */
export type AuthorizeCommit = (
  context: ArtifactCommitContext,
  transaction: ArtifactCommitTransaction,
) => Promise<ArtifactAuthorizationDecision>;

/**
 * Frozen server-created invocation context. Neither body fields nor
 * mutable app-global state may supply it; every publish/ensure invocation
 * carries a fresh context binding the verified actor, the trusted storage
 * scope and the request-bound guard.
 */
export interface ArtifactInvocationContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly authorizeCommit: AuthorizeCommit;
}

/**
 * Commit-time context passed to the guard after all waits. It adds the
 * operation, artifact/binding identity, computed command identity, policy
 * revision and purpose to the invocation. The fence below, minted by the
 * transaction-bound policy participant, is the only usable allowed
 * credential; it cannot be synthesized from the revision string.
 */
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

/** Opaque fence minted by the transaction-bound policy participant. */
export interface ArtifactAuthorizationFence {
  readonly fenceId: string;
  readonly invocationId: string;
  readonly policyRevision: string;
}

/** Denial reasons for a refused finalization. */
export type AuthorizationDenialReason =
  | 'denied' | 'revoked' | 'expired' | 'invalid_object' | 'unavailable';

/**
 * Typed authorization decision. Never an unqualified boolean: an allowed
 * decision carries a usable guarded fence, a denial carries a typed
 * reason plus the public projection (code, status, retry). Entry rejection
 * stays distinguishable from a refusal raised inside finalization.
 */
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
 * Opaque transaction identity plus the host's registered
 * transaction-bound policy/quota participant. It exposes no
 * commit/rollback/release method to the guard. Policy registration and
 * SQL table mapping are fixed at coordinator construction.
 */
export interface ArtifactCommitTransaction {
  readonly transactionId: string;
  readonly invocationId: string;
  readonly policyRevision: string;
}

/**
 * Coordinator role owning the atomic finalization unit. The optional
 * test observer receives barrier arrivals below the app with invocation
 * correlation; it can never mark an operation authorized or successful.
 */
export interface ArtifactCommitCoordinator {
  readonly protocolVersion: typeof COMMIT_PROTOCOL_VERSION;
  readonly guardedOperations: readonly string[];
  readonly testObserver?: CommitBarrierObserver;
}

/**
 * Nine section 3.2 barrier points. Tests of actual contention hold the
 * exact coordination/policy/quota/pointer row from a second raw client at
 * these points; the coordinator rechecks authority after a resumed
 * barrier. S3 preparation precedes the key-lock barrier.
 */
export const COMMIT_BARRIER_POINTS = [
  'before_connection_acquire',
  'before_key_lock',
  'before_blob_put',
  'after_blob_put_before_verify',
  'before_blob_readback',
  'before_finalization_row_lock',
  'after_finalization_locks_before_guard',
  'after_replay_lookup_before_guard',
  'before_commit',
] as const;

export type CommitBarrierPoint = (typeof COMMIT_BARRIER_POINTS)[number];

/**
 * Test-only barrier seam. Bound once as the coordinator `testObserver`
 * option; `waitUntilReached` resolves after arrival and `release`
 * resumes only that invocation/point.
 */
export interface CommitBarrierObserver {
  arrive(point: CommitBarrierPoint, invocationId: string): void;
}

export interface ArtifactCommitBarrier {
  readonly observer: CommitBarrierObserver;
  waitUntilReached(point: CommitBarrierPoint, invocationId: string): Promise<void>;
  release(point: CommitBarrierPoint, invocationId: string): void;
}

export type CreateArtifactCommitBarrier = () => ArtifactCommitBarrier;

/**
 * A4 participant lock order inside the finalization transaction, after
 * the key lock: binding identity, artifact/lifecycle row, ACL row,
 * current-pointer row, host authority/revision rows, quota rows, then
 * blob-reference/deletion-claim rows. Multiple identities within one
 * class lock in stable bytewise order. Artifact/lifecycle, ACL, pointer
 * and quota rows use FOR UPDATE; authority rows use FOR SHARE. Binding
 * uniqueness uses its own coordination row even when caller keys differ.
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

/**
 * Frozen finalization order (ask 2, protocol A4). The host guard runs
 * after lock, connection and object waits, inside the finalization
 * boundary, before any committed success.
 */
export const FINALIZATION_PHASES = [
  'admit', 'prepare', 'lock', 'provision', 'guard', 'commit',
] as const;

export type FinalizationPhase = (typeof FINALIZATION_PHASES)[number];

/**
 * Residue a refused finalization must never leave committed: no new
 * ready release, pointer advance, attached provenance, ACL/binding or
 * lifecycle change, consumed quota or replayable success.
 */
export const REFUSAL_RESIDUE_FORBIDDEN = [
  'ready-release', 'pointer-advance', 'attached-provenance',
  'acl-binding-change', 'lifecycle-change', 'consumed-quota', 'replayable-success',
] as const;

export type RefusalResidue = (typeof REFUSAL_RESIDUE_FORBIDDEN)[number];

/** Profiles requiring guarded writes must declare a coordinator at startup. */
export interface CoordinatorRequirement {
  readonly requiresCoordinator: true;
  readonly guardedOperations: readonly string[];
}

/** Transport-free HTTP request shape consumed by the frozen app. */
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Transport-free HTTP response shape produced by the frozen app. */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Required app dependencies: no automatic legacy fallback exists. */
export const HTTP_APP_REQUIRED_DEPS = ['profile', 'coordinator'] as const;

/**
 * App dependencies. Omitted profile, coordinator or write guard fails
 * closed; the old split finalizer is removed, never selected implicitly.
 */
export interface HttpAppDeps {
  readonly profile: CompiledArtifactsProfile;
  readonly coordinator: ArtifactCommitCoordinator;
}

/**
 * Frozen app surface. `execute` is the sole execution path returning the
 * shared outcome with invocation, commit-state and replay correlation;
 * `handle` calls it once, then sanitizes with the outcome projector.
 * Hosts needing accounting call `execute` and the projector themselves,
 * never both methods. Reads/entry rejection use `not_committed`; write
 * success uses `committed`.
 */
export interface ArtifactApp {
  readonly selectedCapabilities: readonly string[];
  execute(
    request: HttpRequest,
    invocation: ArtifactInvocationContext,
  ): Promise<ArtifactOutcome<HttpResponse>>;
  handle(
    request: HttpRequest,
    invocation: ArtifactInvocationContext,
  ): Promise<HttpResponse>;
}

/** Sanitized projection from outcome to HTTP response. */
export type ProjectArtifactHttpOutcome = (
  outcome: ArtifactOutcome<HttpResponse>,
) => HttpResponse;
