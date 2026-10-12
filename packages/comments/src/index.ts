export type {
  Comment,
  CommentAuthor,
  CommentProvenance,
  CommentState,
  CommentTarget,
  CommentTargetKind,
  CommentThreadSummary,
  LiveCommentTarget,
  NewComment,
  TargetQuery,
} from './types.js';
export {
  LIVE_RECORD_CONTEXT_TYPES,
  targetFromLive,
  targetToLive,
} from './types.js';

export type {
  CommentEvent,
  CommentEventEnvelope,
  CommentEventSink,
  CommentEventType,
} from './events.js';
export {
  CollectingCommentEventSink,
  noopCommentEventSink,
  toEventEnvelope,
} from './events.js';

export {
  isComment,
  isCommentAuthor,
  isCommentEvent,
  isCommentEventType,
  isCommentState,
  isCommentTarget,
  isCommentTargetKind,
  isCommentThreadSummary,
} from './guards.js';

export type { CommentStore } from './store.js';
export { CommentNotFoundError, ThreadNotFoundError } from './store.js';

export type { InMemoryCommentStoreOptions } from './in-memory.js';
export { InMemoryCommentStore } from './in-memory.js';

export type {
  Anchor,
  CaptureAnchor,
  CanonicalScope,
  DataAnchor,
  FieldAnchor,
  FieldSelector,
  FieldSelector as CanonicalFieldSelector,
  ResourceRef,
  SourceVersionIndicator,
  TextAnchor,
  UiAnchor,
} from './anchors.js';
export {
  AnchorValidationError,
  isCanonicalScope,
  isResourceRef,
  isSourceVersionIndicator,
  resourceKey,
  scopeKey,
  validateAnchor,
} from './anchors.js';

export type {
  BoxGeometryInput,
  CircleGeometryInput,
  GeometryFrame,
  GeometryInput,
  QuantizedBox,
  QuantizedCircle,
  QuantizedGeometry,
} from './geometry.js';
export {
  GEOMETRY_SCALE,
  GeometryValidationError,
  quantizeMillionths,
  validateBox,
  validateCircle,
  validateGeometry,
} from './geometry.js';

export { CanonicalizationError, canonicalJson } from './canonical-json.js';
export { sha256Hex } from './sha256.js';

export type { ChainLink, HashEnvelope, RecordKind } from './revision-hash.js';
export {
  RECORD_KINDS,
  REVISION_HASH_VERSION,
  RevisionHashError,
  canonicalRecordBytes,
  hashRecord,
  isChainLink,
  isRecordKind,
  validateChain,
} from './revision-hash.js';

export type {
  AnnotationRevisionRecord,
  BodyCodecDescriptor,
  BodyMention,
  BodySegment,
  CapacityBound,
  CapacityDescriptor,
  CapacityUnit,
  CommentRevisionRecord,
  DocumentaryAttribution,
  ImportExecution,
  RevisionBody,
  RevisionProvenance,
  RevisionRegistration,
  RevisionTargetBinding,
  SemanticProfile,
  SourceTime,
  StructuralTrigger,
  ThreadStructureRevisionRecord,
  VisualAnchorBinding,
} from './revisions.js';
export {
  STRUCTURAL_TRIGGERS,
  RevisionValidationError,
  checkRevisionBodyCapacity,
  createAnnotationRevision,
  createCommentRevision,
  createThreadStructureRevision,
  isStructuralTrigger,
  validateCapacityDescriptor,
  validateRevisionBody,
  validateRevisionProvenance,
  validateRevisionTargets,
} from './revisions.js';

export type {
  CanonicalStoreScope,
  CanonicalTransactionHandle,
  CanonicalPgSurface,
  CanonicalHonoSurface,
  CanonicalHttpPorts,
  CanonicalHttpCapability,
  CanonicalCommandStore,
} from './command-store.js';

export type {
  CanonicalCommandEnvelope,
  CapabilityCheckPort,
  CommandActor,
  CommandCapability,
  CommittedCommand,
  DecisionEvidence,
  DecisionResolutionPort,
  ExpectedState,
  ResourceResolverPort,
} from './commands.js';
export {
  COMMAND_CAPABILITIES,
  CanonicalCommandError,
  checkDecisionEvidence,
  commandIdempotencyKey,
  commandPayloadDigest,
  computeProposedContentDigest,
  defaultDenyCapabilityCheck,
  isCommandCapability,
  resolveIdempotentReplay,
} from './commands.js';

export type {
  ContestView,
  ReviewAction,
  ReviewAgentProposal,
  ReviewDecisionAudit,
  ReviewDecisionOutcome,
  ReviewEventRecord,
  ReviewExecutorAudit,
  ReviewProjection,
  ReviewState,
} from './reviews.js';
export {
  REVIEW_ACTIONS,
  REVIEW_DECISION_OUTCOMES,
  ReviewValidationError,
  createReviewEvent,
  isReviewAction,
  isReviewDecisionOutcome,
  projectReviewState,
  projectRevisionReview,
} from './reviews.js';

export type {
  ArchiveKind,
  LifecycleAction,
  LifecycleEventRecord,
  LifecycleObjectKind,
  LifecycleProjection,
  OperationAuditEventRecord,
  OperationAuditSubject,
  PurgeState,
} from './lifecycle.js';
export {
  ARCHIVE_KINDS,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_OBJECT_KINDS,
  OPERATION_AUDIT_SUBJECTS,
  LifecycleValidationError,
  OperationAuditValidationError,
  createLifecycleEvent,
  createOperationAuditEvent,
  isArchiveKind,
  isLifecycleAction,
  isLifecycleObjectKind,
  isOperationAuditSubject,
  projectLifecycleState,
} from './lifecycle.js';

export type {
  PreparedSubmissionManifest,
  PreparedSubmissionReceipt,
  SelectedCommentRevision,
  SelectedStructureRevision,
} from './submissions.js';
export {
  SubmissionValidationError,
  createPreparedSubmissionManifest,
  recoverPreparedSubmissionReceipt,
  verifyPreparedSubmission,
} from './submissions.js';
