import type { Component, Snippet } from 'svelte';
import type { CommentHost } from './host.js';
import type { CommentThreadSummary } from './types.js';

export type CommentsPanelProps = {
  /** Required: the app-side host adapter. */
  host: CommentHost;
  /** Comment context type (e.g. 'organization', 'folder'). */
  contextType?: string | null;
  /** Comment context entity id. */
  contextId?: string | null;
  /** Section key filter (null = all sections). */
  sectionKey?: string | null;
  /** Human-readable section label (fallback if host.resolveSectionLabel returns null). */
  sectionLabel?: string | null;
  /** Bindable: currently selected thread id. */
  commentThreadId?: string | null;
  /** Whether the workspace allows commenting (forwarded from parent RBAC). */
  workspaceCanComment?: boolean;
  /** Bindable: whether the panel is loading (controlled by the panel, readable by parent). */
  commentLoading?: boolean;
  /** i18n helper — parent must provide. */
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  /** Format a comment timestamp. */
  formatTimestamp?: (v: string | null | undefined) => string;
  /**
   * Snippet for the text input inside the composer.
   * If absent, a simple <textarea> is rendered.
   */
  renderComposerInput?: Snippet<[{
    value: string;
    disabled: boolean;
    placeholder: string;
    onChange: (v: string) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  }]>;
  /**
   * Snippet for the comment edit form inside a user bubble.
   * If absent, the content is shown as plain text during editing.
   */
  renderEditForm?: Snippet<[{
    commentId: string;
    content: string;
    onCancel: () => void;
    onCommit: () => void;
  }]>;
  /**
   * Snippet for the send button.
   * If absent, a default button is rendered.
   */
  renderSendButton?: Snippet<[{ disabled: boolean; onSend: () => void }]>;
  /**
   * Snippet for the thread picker menu popover trigger + content.
   * If absent, no picker menu is shown (threads are navigated only via prev/next).
   */
  renderThreadMenuPopover?: Snippet<[{
    threads: CommentThreadSummary[];
    currentThreadId: string | null;
    resolvedCount: number;
    showResolvedComments: boolean;
    onSelect: (t: CommentThreadSummary) => void;
    onNew: () => void;
    onToggleShowResolved: () => void;
    getThreadSectionLabel: (sectionKey: string | null) => string;
  }]>;
};

declare const CommentsPanel: Component<CommentsPanelProps>;

export default CommentsPanel;
