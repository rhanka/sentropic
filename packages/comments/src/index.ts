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
