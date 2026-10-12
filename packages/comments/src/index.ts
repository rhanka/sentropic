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
  createAnnotationRevision,
  createCommentRevision,
  createThreadStructureRevision,
  isStructuralTrigger,
  validateRevisionBody,
  validateRevisionProvenance,
  validateRevisionTargets,
} from './revisions.js';
