import type { CommentEvent, CommentEventType } from './events.js';
import type {
  Comment,
  CommentAuthor,
  CommentState,
  CommentTarget,
  CommentTargetKind,
  CommentThreadSummary,
} from './types.js';

const COMMENT_TARGET_KINDS: ReadonlySet<CommentTargetKind> = new Set([
  'message',
  'canvas',
  'artifact',
  'field',
  'record',
]);

const COMMENT_STATES: ReadonlySet<CommentState> = new Set(['open', 'resolved']);

const COMMENT_EVENT_TYPES: ReadonlySet<CommentEventType> = new Set([
  'created',
  'updated',
  'resolved',
  'reopened',
  'deleted',
  'reassigned',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

export const isCommentTargetKind = (
  value: unknown,
): value is CommentTargetKind =>
  typeof value === 'string' &&
  COMMENT_TARGET_KINDS.has(value as CommentTargetKind);

export const isCommentState = (value: unknown): value is CommentState =>
  typeof value === 'string' && COMMENT_STATES.has(value as CommentState);

export const isCommentEventType = (
  value: unknown,
): value is CommentEventType =>
  typeof value === 'string' &&
  COMMENT_EVENT_TYPES.has(value as CommentEventType);

export const isCommentTarget = (value: unknown): value is CommentTarget => {
  if (!isRecord(value)) return false;
  if (!isCommentTargetKind(value.kind)) return false;
  if (typeof value.id !== 'string') return false;
  if (!isOptionalString(value.sectionKey)) return false;
  if (!isOptionalString(value.recordType)) return false;
  return true;
};

export const isCommentAuthor = (value: unknown): value is CommentAuthor => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (
    value.kind !== undefined &&
    value.kind !== 'human' &&
    value.kind !== 'agent' &&
    value.kind !== 'nhi'
  ) {
    return false;
  }
  if (!isOptionalString(value.displayLabel)) return false;
  return true;
};

const isTenantContext = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.tenantId === 'string' &&
  typeof value.workspaceId === 'string' &&
  typeof value.userId === 'string';

export const isComment = (value: unknown): value is Comment => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (!isTenantContext(value.tenant)) return false;
  if (!isCommentTarget(value.target)) return false;
  if (typeof value.threadId !== 'string') return false;
  if (!isCommentAuthor(value.author)) return false;
  if (!isOptionalString(value.assignedTo)) return false;
  if (!isCommentState(value.state)) return false;
  if (typeof value.body !== 'string') return false;
  if (typeof value.createdAt !== 'string') return false;
  if (!isOptionalString(value.updatedAt)) return false;
  return true;
};

export const isCommentEvent = (value: unknown): value is CommentEvent => {
  if (!isRecord(value)) return false;
  if (!isCommentEventType(value.type)) return false;
  if (!isTenantContext(value.tenant)) return false;
  if (!isCommentTarget(value.target)) return false;
  if (typeof value.commentId !== 'string') return false;
  if (typeof value.threadId !== 'string') return false;
  return true;
};

export const isCommentThreadSummary = (
  value: unknown,
): value is CommentThreadSummary => {
  if (!isRecord(value)) return false;
  if (typeof value.threadId !== 'string') return false;
  if (!isOptionalString(value.contextType)) return false;
  if (!isCommentTarget(value.target)) return false;
  if (!isOptionalString(value.sectionKey)) return false;
  if (typeof value.rootMessage !== 'string') return false;
  if (typeof value.rootMessageAt !== 'string') return false;
  if (typeof value.lastMessage !== 'string') return false;
  if (typeof value.lastMessageAt !== 'string') return false;
  if (typeof value.messageCount !== 'number') return false;
  if (!isCommentState(value.status)) return false;
  if (!isOptionalString(value.assignee)) return false;
  return true;
};
