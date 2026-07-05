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

import type { CommentItem, CommentCurrentUser, MentionMember } from './types.js';

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
    contextId: string;
    sectionKey?: string | null;
    content: string;
    assignedTo?: string | null;
    threadId?: string | null;
  }): Promise<{ id: string; thread_id: string }>;

  /**
   * Update an existing comment (content / assignedTo).
   */
  updateComment(
    id: string,
    params: { content?: string; assignedTo?: string | null },
  ): Promise<{ success: boolean }>;

  /**
   * Close (resolve) a comment thread by root comment id.
   */
  closeComment(id: string): Promise<{ success: boolean }>;

  /**
   * Reopen a previously closed comment thread.
   */
  reopenComment(id: string): Promise<{ success: boolean }>;

  /**
   * Delete a comment (and its thread if it is the root).
   */
  deleteComment(id: string): Promise<{ success: boolean }>;

  /**
   * List workspace members eligible for @-mention.
   */
  listMentionMembers(): Promise<{ items: MentionMember[] }>;

  /**
   * Returns true if the current user is allowed to create/reply to comments.
   */
  canComment(): boolean;

  /**
   * Returns true if the current user can resolve/reopen the given comment.
   * Typically: comment.created_by === currentUser.id || role === 'admin'.
   */
  canResolve(comment: CommentItem): boolean;

  /**
   * Translate a section type + key into a human-readable label.
   * Returns null if no label is available.
   * App side: backed by SECTION_LABEL_KEYS + $_ i18n.
   */
  resolveSectionLabel(type: string | null, key: string | null): string | null;

  /**
   * Returns the current authenticated user, or null if unauthenticated.
   * Used for optimistic comment creation (D5).
   */
  currentUser(): CommentCurrentUser | null;

  /**
   * Subscribe to real-time comment updates for a given context (R2).
   * Calls cb whenever a comment_update event arrives for contextType+contextId.
   * Returns an unsubscribe function.
   */
  subscribeCommentUpdates(
    contextType: string,
    contextId: string,
    cb: () => void,
  ): () => void;

  /**
   * Optional: show a native confirm dialog before deleting a thread.
   * If absent, CommentsPanel shows its own inline confirm.
   */
  confirmDelete?(message: string): boolean;
};
