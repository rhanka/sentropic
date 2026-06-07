/**
 * comments/types.ts
 *
 * Generic comment types for @sentropic/chat-ui/comments.
 * Zero sentropic domain strings. All domain strings (SECTION_LABEL_KEYS,
 * CommentContextType enum) stay app-side.
 */

/**
 * Minimal shape of a comment as returned by the host.
 * Extends CommentLike from comment-adapter for full parity.
 */
export type CommentItem = {
  id: string;
  context_type: string;
  context_id: string;
  section_key: string | null;
  created_by: string;
  assigned_to: string | null;
  status: string;
  thread_id: string;
  content: string;
  tool_call_id?: string | null;
  created_at: string;
  updated_at: string | null;
  created_by_user: {
    id?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
  assigned_to_user: {
    id?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
};

/**
 * Aggregated thread summary built from a flat list of CommentItem.
 */
export type CommentThreadSummary = {
  id: string;
  sectionKey: string | null;
  count: number;
  lastAt: string;
  preview: string;
  authorLabel: string;
  status: 'open' | 'closed';
  assignedTo: string | null;
  rootId: string;
  createdBy: string;
};

/**
 * Workspace member eligible for @-mention.
 */
export type MentionMember = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role?: string;
};

/**
 * Current user identity forwarded from the host.
 */
export type CommentCurrentUser = {
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
};
