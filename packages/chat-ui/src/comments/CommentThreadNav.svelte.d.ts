import type { Component, Snippet } from 'svelte';
import type { CommentThreadSummary } from './types.js';

export type CommentThreadNavProps = {
  activeCommentSectionLabel?: string;
  commentThreadResolved?: boolean;
  commentThreadResolvedAt?: string | null;
  assignedToLabel?: string | null;
  isAssignedToCurrentUser?: boolean;
  currentCommentRootId?: string | null;
  canResolveCurrent?: boolean;
  hasPreviousThread?: boolean;
  hasNextThread?: boolean;
  showResolvedComments?: boolean;
  resolvedCount?: number;
  visibleCommentThreads?: CommentThreadSummary[];
  commentThreadId?: string | null;
  showCommentMenu?: boolean;
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  getThreadSectionLabel?: (sectionKey: string | null) => string;
  formatTimestamp?: (value: string | null | undefined) => string;
  onNewThread?: () => void;
  onSelectThread?: (t: CommentThreadSummary) => void;
  onResolveThread?: () => void;
  onDeleteThread?: () => void;
  onPreviousThread?: () => void;
  onNextThread?: () => void;
  onToggleShowResolved?: () => void;
  renderThreadMenu?: Snippet<[{
    open: boolean;
    toggle: () => void;
    threads: CommentThreadSummary[];
    currentThreadId: string | null;
    onSelect: (t: CommentThreadSummary) => void;
    onNew: () => void;
  }]>;
};

declare const CommentThreadNav: Component<CommentThreadNavProps>;

export default CommentThreadNav;
