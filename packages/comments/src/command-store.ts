/**
 * Canonical command store port (SPEC §3, §4.4).
 *
 * The root exposes only this driver-agnostic transaction handle and store
 * port: no driver-specific type is reachable from the root. The durable
 * storage adapter and the canonical HTTP composition are declared surfaces
 * owned by the cluster-mesh module (owner decision 2026-10-11), with
 * implementations due at M2/M3.
 */

import type { IdempotencyKey } from '@sentropic/contracts';
import type {
  CapabilityCheckPort,
  CommandCapability,
  DecisionResolutionPort,
  ExpectedState,
  CommittedCommand,
  ResourceResolverPort,
} from './commands.js';
import type {
  AnnotationRevisionRecord,
  CommentRevisionRecord,
  ThreadStructureRevisionRecord,
} from './revisions.js';
import type { ReviewEventRecord } from './reviews.js';
import type {
  LifecycleEventRecord,
  LifecycleObjectKind,
  OperationAuditEventRecord,
  OperationAuditSubject,
} from './lifecycle.js';

/** Scope shared by every canonical store operation. */
export type CanonicalStoreScope = { readonly tenantId: string; readonly workspaceId: string };

/**
 * Driver-agnostic transaction handle. Implementations (in-memory here, `/pg`
 * at M2) make each append atomic with its idempotency/index write; the root
 * never sees a driver-specific transaction object.
 */
export type CanonicalTransactionHandle = {
  readonly handleKind: 'canonical-transaction';
  run<T>(operation: () => Promise<T>): Promise<T>;
};

/**
 * Canonical persistence port. Every append is compare-and-swap against the
 * current head: concurrent edits from the same head yield one accepted result
 * and a `cas-conflict` for the other; there is no last-write-wins loss.
 */
export interface CanonicalCommandStore {
  /** Open a transaction-scoped view of this store (atomic multi-append unit). */
  transaction(): CanonicalTransactionHandle;

  /** Append an annotation revision, CAS-checked against the annotation head. */
  appendAnnotationRevision(
    scope: CanonicalStoreScope,
    annotationId: string,
    record: AnnotationRevisionRecord,
    expected: ExpectedState,
  ): Promise<AnnotationRevisionRecord>;

  /** Append a thread structural revision, CAS-checked against the thread head. */
  appendThreadStructureRevision(
    scope: CanonicalStoreScope,
    threadId: string,
    record: ThreadStructureRevisionRecord,
    expected: ExpectedState,
  ): Promise<ThreadStructureRevisionRecord>;

  /** Append a comment revision, CAS-checked against the comment head. */
  appendCommentRevision(
    scope: CanonicalStoreScope,
    commentId: string,
    record: CommentRevisionRecord,
    expected: ExpectedState,
  ): Promise<CommentRevisionRecord>;

  /**
   * Append a review event, CAS-checked against the annotation's review chain:
   * `creation` binds the empty chain, `revision` binds the last committed
   * review event hash. The record pins the exact annotation revision it
   * applies to; delayed reviews on older revisions stay attachable.
   */
  appendReviewEvent(
    scope: CanonicalStoreScope,
    annotationId: string,
    record: ReviewEventRecord,
    expected: ExpectedState,
  ): Promise<ReviewEventRecord>;

  /**
   * Append a lifecycle event (archive/restore, tombstone, purge
   * intent/outcome), CAS-checked against the scoped object's lifecycle chain.
   */
  appendLifecycleEvent(
    scope: CanonicalStoreScope,
    objectKind: LifecycleObjectKind,
    objectId: string,
    record: LifecycleEventRecord,
    expected: ExpectedState,
  ): Promise<LifecycleEventRecord>;

  /**
   * Append an operation audit event, CAS-checked against the scoped audit
   * subject's chain; audit chains stay separate from every content and
   * lifecycle chain.
   */
  appendOperationAuditEvent(
    scope: CanonicalStoreScope,
    subject: OperationAuditSubject,
    subjectId: string,
    record: OperationAuditEventRecord,
    expected: ExpectedState,
  ): Promise<OperationAuditEventRecord>;

  /** Current annotation head revision, or null when the annotation does not exist. */
  getAnnotationHead(
    scope: CanonicalStoreScope,
    annotationId: string,
  ): Promise<AnnotationRevisionRecord | null>;

  /** Full annotation revision chain, ordered by sequence. */
  getAnnotationChain(
    scope: CanonicalStoreScope,
    annotationId: string,
  ): Promise<readonly AnnotationRevisionRecord[]>;

  /** Current thread structural revision head, or null. */
  getThreadStructureHead(
    scope: CanonicalStoreScope,
    threadId: string,
  ): Promise<ThreadStructureRevisionRecord | null>;

  /** Full thread structural revision chain, ordered by sequence. */
  getThreadStructureChain(
    scope: CanonicalStoreScope,
    threadId: string,
  ): Promise<readonly ThreadStructureRevisionRecord[]>;

  /** Full review event chain of one annotation, ordered by sequence. */
  getReviewChain(
    scope: CanonicalStoreScope,
    annotationId: string,
  ): Promise<readonly ReviewEventRecord[]>;

  /** Full lifecycle chain of one scoped object, ordered by sequence. */
  getLifecycleChain(
    scope: CanonicalStoreScope,
    objectKind: LifecycleObjectKind,
    objectId: string,
  ): Promise<readonly LifecycleEventRecord[]>;

  /** Full operation audit chain of one scoped subject, ordered by sequence. */
  getOperationAuditChain(
    scope: CanonicalStoreScope,
    subject: OperationAuditSubject,
    subjectId: string,
  ): Promise<readonly OperationAuditEventRecord[]>;

  /** Current comment head revision, or null. */
  getCommentHead(
    scope: CanonicalStoreScope,
    commentId: string,
  ): Promise<CommentRevisionRecord | null>;

  /** Full comment revision chain of one comment, ordered by sequence. */
  getCommentChain(
    scope: CanonicalStoreScope,
    commentId: string,
  ): Promise<readonly CommentRevisionRecord[]>;

  /** Idempotency index read: the committed command for this key, or null. */
  findCommittedCommand(
    scope: CanonicalStoreScope,
    idempotencyKey: IdempotencyKey,
  ): Promise<CommittedCommand | null>;

  /** Idempotency index write; atomic with the append it records. */
  recordCommittedCommand(
    scope: CanonicalStoreScope,
    idempotencyKey: IdempotencyKey,
    committed: CommittedCommand,
  ): Promise<void>;
}

/**
 * DECLARED — IMPLEMENTATION DUE M2 (owner decision 2026-10-11): the durable
 * adapter of this port belongs to the cluster-mesh module, built on the
 * generic cluster-mesh storage port with injected connection, clock and ID
 * dependencies. This neutral declaration pins the port type and the
 * injected-dependency rule only; the owning module declares its own
 * entrypoints, schema and migration assets.
 */
export type CanonicalStorageAdapterSurface = {
  readonly port: CanonicalCommandStore;
  readonly basis: 'generic-cluster-mesh-storage-port';
  readonly dependencies: 'injected-connection-clock-ids';
  readonly status: 'due-m2';
};

/**
 * DECLARED — IMPLEMENTATION DUE M3 (owner decision 2026-10-11): the canonical
 * HTTP composition belongs to the cluster-mesh module and is exported through
 * that module's entrypoint. This declaration pins the entrypoint name, the
 * factory signature and the injected ports — never a placement path.
 */
export type CanonicalHttpSurface = {
  readonly entrypoint: 'createCanonicalCommentsRouter';
  readonly factorySignature: 'CanonicalRouterFactory';
  readonly ports: CanonicalHttpPorts;
  readonly status: 'due-m3';
};

/** Host-injected ports of the future canonical HTTP composition. */
export type CanonicalHttpPorts = {
  readonly store: CanonicalCommandStore;
  readonly capabilities: CapabilityCheckPort;
  readonly resolver: ResourceResolverPort;
  readonly decisions: DecisionResolutionPort;
};

/** Capability names exposed over the canonical HTTP surface (declared wire vocabulary). */
export type CanonicalHttpCapability = CommandCapability;
