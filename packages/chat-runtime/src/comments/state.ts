/**
 * comments/state.ts
 *
 * createCommentState factory — owns all comment loading, sending, editing,
 * resolve/reopen/delete operations, mention handling, and thread navigation.
 *
 * D5: optimistic comment create uses host.currentUser().
 * R2: subscribeUpdates delegates to host.subscribeCommentUpdates.
 *
 * Framework-neutral (no svelte/store): uses a minimal hand-rolled store
 * matching the ReadableStore<T> shape so Svelte $-prefix subscriptions work.
 */

import type { CommentHost } from './host.js';
import type {
  CommentItem,
  CommentCurrentUser,
  CommentThreadSummary,
  MentionMember,
} from '@sentropic/chat-ui/comments';
import {
  buildCommentThreads,
  getMentionCandidate,
  getMentionMatches,
  findAssignedMentionFromText,
  type CommentPresentation,
} from './utils.js';

// ---------------------------------------------------------------------------
// Minimal hand-rolled store (no svelte/store import)
// ---------------------------------------------------------------------------

