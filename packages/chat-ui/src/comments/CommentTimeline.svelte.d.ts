import type { Component, Snippet } from 'svelte';
import type { CommentItem } from './types.js';

export type CommentTimelineProps = {
  /** The comment messages to render. */
  commentMessages?: CommentItem[];
  /** Whether a loading indicator should be shown. */
  commentLoading?: boolean;
  /** The currently selected thread id (null = no thread selected). */
  commentThreadId?: string | null;
  /** Id of the last comment that the current user can edit. */
  lastEditableCommentId?: string | null;
  /** Id of the comment currently in edit mode. */
  editingCommentId?: string | null;
  /** Content of the comment being edited. */
  editingCommentContent?: string;
  /** Whether the workspace allows commenting. */
  workspaceCanComment?: boolean;
  /** i18n helper — returns a translated string for the given key. */
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  /** Format a comment timestamp string. */
  formatTimestamp?: (value: string | null | undefined) => string;
  /** Returns true if the comment was authored by the current user. */
  isCommentByCurrentUser?: (c: CommentItem) => boolean;
  /** Returns true if the given comment id has been copied. */
  isCopied?: (id: string) => boolean;
  /** Snippet for the edit form, rendered inside the user bubble when editingCommentId matches. */
  renderEditForm?: Snippet<[{
    commentId: string;
    content: string;
    onCancel: () => void;
    onCommit: () => void;
  }]>;
  /** Called when the user clicks the edit button on a comment. */
  onStartEdit?: (c: CommentItem) => void;
  /** Called when the user clicks the copy button on a comment. */
  onCopy?: (c: CommentItem) => void;
  /** Called when the user confirms a comment edit. */
  onCommitEdit?: () => void;
  /** Called when the user cancels a comment edit. */
  onCancelEdit?: () => void;
  /** Bindable: the scroll container element. */
  listEl?: HTMLDivElement | null;
};

declare const CommentTimeline: Component<CommentTimelineProps>;

export default CommentTimeline;
