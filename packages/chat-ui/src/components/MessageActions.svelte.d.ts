import type { Component } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type {
  MessageActionRole,
  MessageActionStreamStatus,
  MessageFeedbackVote,
} from '../utils/message-actions.js';

export type MessageActionsProps = {
  /** Role of the message this row belongs to. */
  role: MessageActionRole;
  /** Stream status — 'processing' while streaming, 'completed' when done. */
  streamStatus?: MessageActionStreamStatus;
  /**
   * True when this is both a terminal segment AND the last assistant segment.
   * Only meaningful for assistant messages.
   */
  isLastAssistantSegment?: boolean;
  /**
   * Whether the copy-flash indicator is active for this message.
   * The host manages the flash timer.
   */
  isCopied?: boolean;
  /** Current feedback vote stored on the message (1 = up, -1 = down, null = none). */
  feedbackVote?: MessageFeedbackVote;
  /** i18n / label resolver injected by the host. */
  labels?: ChatUiLabelResolver;
  /** Called when the user clicks the copy button. */
  onCopy?: () => void;
  /** Called when the user clicks the edit button (user messages only). */
  onEdit?: () => void;
  /**
   * Called when the user clicks regenerate / retry (assistant messages only).
   * The host is responsible for handling checkpoint prompts if needed.
   */
  onRegenerate?: () => void;
  /**
   * Called with the next feedback action when the user clicks a feedback button.
   * Payload: 'up' | 'down' | 'clear'.
   */
  onFeedback?: (action: 'up' | 'down' | 'clear') => void;
};

declare const MessageActions: Component<MessageActionsProps>;

export default MessageActions;
