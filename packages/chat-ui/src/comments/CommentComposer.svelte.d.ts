import type { Component, Snippet } from 'svelte';
import type { MentionMember } from './types.js';

export type CommentComposerProps = {
  /** Current comment text. */
  commentInput?: string;
  /** The resolved assignee label (if any). */
  assignedToLabel?: string | null;
  /** Whether the workspace allows commenting. */
  workspaceCanComment?: boolean;
  /** Whether the active thread is resolved. */
  commentThreadResolved?: boolean;
  /** Whether the mention popup is open. */
  showMentionMenu?: boolean;
  /** Mention candidates matching the current query. */
  mentionMatches?: MentionMember[];
  /** Whether mention members are loading. */
  mentionLoading?: boolean;
  /** Whether the mention loading delay has elapsed. */
  mentionDelayElapsed?: boolean;
  /** Error loading mention members. */
  mentionError?: string | null;
  /** Placeholder text for the input. */
  placeholder?: string;
  /** i18n helper. */
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  /** Returns the display label for a mention member. */
  getMentionLabel?: (m: MentionMember) => string;
  /** Snippet for the text input itself. */
  renderInput?: Snippet<[{ value: string; disabled: boolean; placeholder: string }]>;
  /** Called when a mention member is selected. */
  onSelectMention?: (m: MentionMember) => void;
  /** Called when the assignee chip is dismissed. */
  onClearAssignment?: () => void;
  /** Bindable: the mention popup element. */
  mentionMenuRef?: HTMLDivElement | null;
};

declare const CommentComposer: Component<CommentComposerProps>;

export default CommentComposer;
