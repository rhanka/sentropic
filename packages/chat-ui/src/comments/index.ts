/**
 * @sentropic/chat-ui/comments
 *
 * Generic comments module — pure TS + Svelte components.
 * ZERO sentropic domain strings.
 *
 * Provides:
 *   - CommentHost interface (app-side adapter seam)
 *   - CommentItem / CommentThreadSummary / MentionMember / CommentCurrentUser (types)
 *   - createCommentState(host) factory
 *   - CommentState / CommentStateSnapshot / CommentStateActions (state types)
 *   - Generic helpers: buildCommentThreads, getMentionCandidate, getMentionMatches,
 *     findAssignedMentionFromText, getInitials, getCommentAuthorLabel, getMentionLabel,
 *     isCommentByUser, isAiComment, formatCommentTimestamp, isSameDay
 *   - CommentsPanel.svelte — self-contained comment panel (canonical comments surface)
 */

// Types
export type {
  CommentItem,
  CommentThreadSummary,
  MentionMember,
  CommentCurrentUser,
} from './types.js';

// Host interface
export type { CommentHost } from './host.js';

// State factory + types
export { createCommentState } from './state.js';
export type {
  CommentState,
  CommentStateSnapshot,
  CommentStateActions,
} from './state.js';

// Generic helpers (re-exported from utils)
export {
  buildCommentThreads,
  getMentionCandidate,
  getMentionMatches,
  findAssignedMentionFromText,
  getInitials,
  getCommentAuthorLabel,
  getMentionLabel,
  isCommentByUser,
  isAiComment,
  formatCommentTimestamp,
  isSameDay,
} from './utils.js';
