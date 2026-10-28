/**
 * comments/host.ts
 *
 * CommentHost interface — the app-side adapter contract for the comments
 * module. Zero sentropic domain strings: all REST, RBAC, and i18n wiring
 * live in the app adapter (comment-host-adapter.ts).
 *
 * D5: optimistic comment create returns { id, thread_id } so the module
 *     can update local state before the full reload.
 * R2: subscribeCommentUpdates provides the streamHub integration seam.
 */

import type { CommentItem, CommentCurrentUser, MentionMember } from '@sentropic/chat-ui/comments';

export type { CommentItem, CommentCurrentUser, MentionMember };

export type CommentHost = {
  /**
   * List all comments for a given context (type + id).
   * Optionally filter by section key.
   */
  listComments(params: {
    contextType: string;
    contextId: string;
    sectionKey?: string | null;
  }): Promise<{ items: CommentItem[] }>;

  /**
   * Create a new comment. Returns { id, thread_id } for optimistic update (D5).
   */
  createComment(params: {
    contextType: string;
