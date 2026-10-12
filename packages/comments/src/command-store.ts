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
  CapacityDescriptor,
  CommentRevisionRecord,
  ThreadStructureRevisionRecord,
} from './revisions.js';
import type { ReviewAction, ReviewEventRecord } from './reviews.js';
import type {
  ArchiveKind,
  LifecycleAction,
  LifecycleEventRecord,
  LifecycleObjectKind,
  OperationAuditEventRecord,
  OperationAuditSubject,
} from './lifecycle.js';
import type { PreparedSubmissionManifest } from './submissions.js';

/**
 * Immutable import manifest record (kind `import-manifest`, SPEC §4.4/§7.2):
 * a standalone genesis envelope binding one frozen, admissible source
 * inventory. The digest is the caller's recomputed digest over the declared
 * units; it never attests undisclosed external-source completeness.
 */
export type CanonicalImportManifest = {
  readonly kind: 'import-manifest';
  readonly scope: CanonicalStoreScope;
  readonly importId: string;
  readonly sourceUnitCount: number;
  readonly admissibleManifestDigest: string;
  readonly mappingVersion: string;
  readonly hash: string;
};

/**
 * Committed unit receipt (kind `unit-receipt`): a standalone genesis record
 * binding one coherent unit to the manifest hash it was admitted under.
 */
export type CanonicalUnitReceipt = {
  readonly kind: 'unit-receipt';
  readonly scope: CanonicalStoreScope;
  readonly unitId: string;
  readonly manifestHash: string;
  readonly issuedAt: number;
  readonly hash: string;
};

/**
 * Batch receipt snapshot (kind `batch-receipt-snapshot`): progress snapshots
 * chain per scoped batch and each snapshot's digest covers the prior
 * snapshots; committed receipts never mutate (SPEC §4.4).
 */
export type CanonicalBatchReceiptSnapshot = {
  readonly kind: 'batch-receipt-snapshot';
  readonly scope: CanonicalStoreScope;
  readonly batchId: string;
  readonly receiptCount: number;
  readonly snapshotDigest: string;
  readonly hash: string;
};

/**
 * Conversion report record (kind `conversion-report`, SPEC §6.2): the
 * host-declared aggregate bound to the frozen inventory; count-only source
 * exclusions reconcile here and yield no per-row canonical content.
 */
export type CanonicalConversionReport = {
  readonly kind: 'conversion-report';
  readonly scope: CanonicalStoreScope;
  readonly reportId: string;
  readonly sourceUnitCount: number;
  readonly completenessDeclared: boolean;
  readonly admissibleManifestDigest: string;
  readonly hash: string;
};

/** Every canonical record kind readable through this port (SPEC §4.4). */
export type CanonicalChainRecord =
  | AnnotationRevisionRecord
  | ThreadStructureRevisionRecord
  | CommentRevisionRecord
  | ReviewEventRecord
  | LifecycleEventRecord
  | OperationAuditEventRecord
  | PreparedSubmissionManifest
  | CanonicalImportManifest
  | CanonicalUnitReceipt
  | CanonicalBatchReceiptSnapshot
  | CanonicalConversionReport;

/** One chain (or genesis record) selected for paged reading. */
export type CanonicalReadSelection =
  | { readonly kind: 'annotation-revisions'; readonly annotationId: string }
  | { readonly kind: 'thread-structure-revisions'; readonly threadId: string }
  | { readonly kind: 'comment-revisions'; readonly commentId: string }
  | { readonly kind: 'review-events'; readonly annotationId: string }
  | { readonly kind: 'lifecycle-events'; readonly objectKind: LifecycleObjectKind; readonly objectId: string }
  | { readonly kind: 'operation-audit-events'; readonly subject: OperationAuditSubject; readonly subjectId: string }
  | { readonly kind: 'prepared-submission-manifests'; readonly submissionId: string }
  | { readonly kind: 'import-manifests'; readonly importId: string }
  | { readonly kind: 'unit-receipts'; readonly unitId: string }
  | { readonly kind: 'batch-receipt-snapshots'; readonly batchId: string }
  | { readonly kind: 'conversion-reports'; readonly reportId: string };

/** Bounded read request: page limit plus opaque continuation cursor. */
export type CanonicalPageRequest = {
  readonly limit: number;
  readonly cursor: string | null;
};

/** Closed set of read-page outcomes (SPEC §4.6). */
export const CANONICAL_READ_PAGE_OUTCOMES = ['page', 'incomplete', 'inaccessible'] as const;
export type CanonicalReadPageOutcome = (typeof CANONICAL_READ_PAGE_OUTCOMES)[number];

/**
 * One page of records. `incomplete` and `inaccessible` are durable-adapter
 * or composition outcomes; `nextCursor` is null only at chain exhaustion.
 */
export type CanonicalReadPage = {
  readonly outcome: CanonicalReadPageOutcome;
  readonly records: readonly CanonicalChainRecord[];
  readonly nextCursor: string | null;
};

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

  /**
   * Append a prepared submission manifest as an idempotent genesis: replaying
   * the same submission ID with the same hash returns the stored record;
   * the same ID with a different hash is an `idempotency-conflict`.
   */
  appendPreparedSubmissionManifest(
    scope: CanonicalStoreScope,
    submissionId: string,
    manifest: PreparedSubmissionManifest,
  ): Promise<PreparedSubmissionManifest>;

  /**
   * Append an import manifest as an idempotent genesis: replaying the same
   * import ID with the same hash returns the stored record; a different
   * hash under the same ID is an `idempotency-conflict`.
   */
  appendImportManifest(
    scope: CanonicalStoreScope,
    importId: string,
    manifest: CanonicalImportManifest,
  ): Promise<CanonicalImportManifest>;

  /**
   * Append a committed unit receipt as an idempotent genesis: replaying the
   * same unit ID with the same hash returns the stored record; a different
   * hash under the same ID is an `idempotency-conflict`.
   */
  appendUnitReceipt(
    scope: CanonicalStoreScope,
    unitId: string,
    receipt: CanonicalUnitReceipt,
  ): Promise<CanonicalUnitReceipt>;

  /**
   * Append a batch receipt snapshot, CAS-checked against the scoped batch's
   * snapshot chain: `creation` binds the empty chain, `revision` binds the
   * last snapshot hash.
   */
  appendBatchReceiptSnapshot(
    scope: CanonicalStoreScope,
    batchId: string,
    snapshot: CanonicalBatchReceiptSnapshot,
    expected: ExpectedState,
  ): Promise<CanonicalBatchReceiptSnapshot>;

  /**
   * Append a conversion report, CAS-checked against the scoped report chain:
   * report revisions link their predecessor through the expected-state hash
   * (SPEC §6.2); the record itself carries no link field.
   */
  appendConversionReport(
    scope: CanonicalStoreScope,
    reportId: string,
    report: CanonicalConversionReport,
    expected: ExpectedState,
  ): Promise<CanonicalConversionReport>;

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

  /**
   * Read one bounded page of the selected chain. `limit` is a positive safe
   * integer; `cursor` is an opaque continuation token from a prior page.
   * The in-memory driver always returns `page`; `incomplete` and
   * `inaccessible` exist for durable adapters and composition layers.
   */
  readChainPage(
    scope: CanonicalStoreScope,
    selection: CanonicalReadSelection,
    page: CanonicalPageRequest,
  ): Promise<CanonicalReadPage>;

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

/**
 * Closed wire error vocabulary (SPEC §5): 401 boundary `unauthenticated`,
 * 403 `denied`, non-enumerating 404 `not-found`, 409 stale `conflict`,
 * 400 malformed `invalid-request`, bounded `capacity-exceeded`, and
 * continuation-required `incomplete`.
 */
export const CANONICAL_WIRE_ERROR_CODES = [
  'unauthenticated',
  'denied',
  'not-found',
  'conflict',
  'invalid-request',
  'capacity-exceeded',
  'incomplete',
] as const;
export type CanonicalWireErrorCode = (typeof CANONICAL_WIRE_ERROR_CODES)[number];

/** Wire-level error body; the message never enumerates protected resources. */
export type CanonicalWireError = {
  readonly code: CanonicalWireErrorCode;
  readonly message: string;
};

/** Review decision request over the canonical wire (SPEC §7.1). */
export type CanonicalReviewRequest = {
  readonly scope: CanonicalStoreScope;
  readonly annotationId: string;
  readonly action: ReviewAction;
  readonly revisionHash: string;
  readonly referencesEventHash: string;
  readonly reason: string | null;
  readonly decisionRef: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly expected: ExpectedState;
};

/** Lifecycle command request over the canonical wire (SPEC §7.1). */
export type CanonicalLifecycleRequest = {
  readonly scope: CanonicalStoreScope;
  readonly objectKind: LifecycleObjectKind;
  readonly objectId: string;
  readonly action: LifecycleAction;
  readonly archiveKind: ArchiveKind | null;
  readonly reason: string | null;
  readonly decisionRef: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly expected: ExpectedState;
};

/** One source unit declared in a batch import request (SPEC §7.2). */
export type CanonicalImportUnit = {
  readonly unitId: string;
  readonly unitKind: 'annotation' | 'discussion' | 'review';
  readonly dependsOnUnitIds: readonly string[];
  readonly manifestDigest: string;
  readonly payloadDigest: string;
};

/** Batch import request: one frozen manifest, its declared units, one idempotency key. */
export type CanonicalBatchImportRequest = {
  readonly scope: CanonicalStoreScope;
  readonly batchId: string;
  readonly manifest: CanonicalImportManifest;
  readonly units: readonly CanonicalImportUnit[];
  readonly expectedMappingVersion: string;
  readonly idempotencyKey: IdempotencyKey;
};

/** Per-unit import outcome: committed with receipt, or an outcome that yields no canonical content. */
export type CanonicalUnitOutcome =
  | { readonly outcome: 'committed'; readonly unitId: string; readonly receipt: CanonicalUnitReceipt }
  | { readonly outcome: 'denied'; readonly unitId: string }
  | { readonly outcome: 'rejected'; readonly unitId: string }
  | { readonly outcome: 'host-only'; readonly unitId: string };

/** Batch import response: the committed snapshot plus every unit outcome. */
export type CanonicalBatchImportResponse = {
  readonly snapshot: CanonicalBatchReceiptSnapshot;
  readonly unitOutcomes: readonly CanonicalUnitOutcome[];
};

/** Batch export request: bounded selections against one frozen snapshot boundary. */
export type CanonicalBatchExportRequest = {
  readonly scope: CanonicalStoreScope;
  readonly exportId: string;
  readonly selections: readonly CanonicalReadSelection[];
  readonly snapshotBoundary: { readonly frozenAt: number; readonly boundaryDigest: string };
  readonly idempotencyKey: IdempotencyKey;
};

/** Batch export response: one page of the frozen selection plus its continuation cursor. */
export type CanonicalBatchExportResponse = {
  readonly page: CanonicalReadPage;
  readonly nextCursor: string | null;
};

/**
 * Host parameters of the canonical HTTP composition. Capacity values are
 * host parameters: they bound accepted requests and never enter any hash.
 */
export type CanonicalRouterOptions = {
  readonly capacity: CapacityDescriptor;
};

/**
 * Factory signature of the future canonical router entrypoint: the owning
 * module composes the injected ports under these options and returns its own
 * router type.
 */
export type CanonicalRouterFactory<TRouter = unknown> = (
  ports: CanonicalHttpPorts,
  options: CanonicalRouterOptions,
) => TRouter;
