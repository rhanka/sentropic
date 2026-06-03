/**
 * message-actions.ts — pure, framework-agnostic utilities for the message action row.
 *
 * Extracted from AppChatPanel.svelte handlers (lines 2884-2911, 2975-3000,
 * 3081-3099, 3101-3108, 4409-4423 on main) and markup (lines 5095-5138 [user],
 * 5181-5244 [assistant]).
 *
 * EXCLUDED (app-owned): startEditComment, editingCommentId, checkpoint-restore logic.
 * No Svelte imports, no browser runtime — safe for node-only vitest.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The role of the message this action row is attached to. */
export type MessageActionRole = 'user' | 'assistant';

/** Current streaming / terminal state of the message. */
export type MessageActionStreamStatus = 'processing' | 'completed';

/**
 * Which actions are available for a message given its role and state.
 *
 * - `copy`       — always available on terminal messages; user-message copy is in-row.
 * - `edit`       — user messages only, never while streaming.
 * - `regenerate` — assistant messages only, terminal and last-assistant-segment only.
 * - `retry`      — synonym for regenerate; exposed as a separate flag so the host
 *                  can show a distinct button when appropriate.
 * - `feedbackUp` — assistant messages only, terminal.
 * - `feedbackDown` — assistant messages only, terminal.
 */
export type MessageActionAvailability = {
  copy: boolean;
  edit: boolean;
  regenerate: boolean;
  retry: boolean;
  feedbackUp: boolean;
  feedbackDown: boolean;
};

/** Input for resolving available message actions. */
export type ResolveAvailableActionsInput = {
  role: MessageActionRole;
  streamStatus: MessageActionStreamStatus;
  /** True only when this segment is both terminal and the last assistant segment. */
  isLastAssistantSegment?: boolean;
};

/**
 * Numeric feedback vote stored on a message.
 * 1 = thumbs-up, -1 = thumbs-down, null/undefined = no vote.
 */
export type MessageFeedbackVote = 1 | -1 | null | undefined;

/** Directions a feedback toggle can take. */
export type FeedbackDirection = 'up' | 'down';

/**
 * The next feedback action to send to the API given the current vote state
 * and the button the user clicked.
 *
 * Mirrors `setFeedback` logic in AppChatPanel (lines 4409-4423 on main).
 */
export type FeedbackNextAction = 'up' | 'down' | 'clear';

/**
 * Resolved display state of the feedback buttons for a given message.
 */
export type FeedbackDisplayState = {
  isUp: boolean;
  isDown: boolean;
};

// ---------------------------------------------------------------------------
// Available-actions resolver
// ---------------------------------------------------------------------------

/**
 * Resolve which action buttons should be rendered for a message.
 *
 * Rules mirror AppChatPanel behaviour:
 * - User message: copy + edit available when not streaming.
 * - Assistant message: copy + regenerate/retry + feedback available when terminal
 *   and this is the last assistant segment.
 */
export function resolveAvailableActions(
  input: ResolveAvailableActionsInput,
): MessageActionAvailability {
  const isTerminal = input.streamStatus === 'completed';

  if (input.role === 'user') {
    return {
      copy: isTerminal,
      edit: isTerminal,
      regenerate: false,
      retry: false,
      feedbackUp: false,
      feedbackDown: false,
    };
  }

  // assistant
  const showAll = isTerminal && (input.isLastAssistantSegment ?? false);
  return {
    copy: showAll,
    edit: false,
    regenerate: showAll,
    retry: showAll,
    feedbackUp: showAll,
    feedbackDown: showAll,
  };
}

// ---------------------------------------------------------------------------
// Feedback vote helpers
// ---------------------------------------------------------------------------

/**
 * Derive the current display state (isUp / isDown) from a stored feedback vote.
 */
export function resolveFeedbackDisplayState(
  vote: MessageFeedbackVote,
): FeedbackDisplayState {
  return {
    isUp: vote === 1,
    isDown: vote === -1,
  };
}

/**
 * Compute the next feedback action to send to the API.
 *
 * Clicking the already-active direction clears the vote.
 * Clicking the other direction sets it.
 *
 * Mirrors `setFeedback(m.id, isUp ? 'clear' : 'up')` pattern from AppChatPanel.
 */
export function buildFeedbackNextVote(
  currentVote: MessageFeedbackVote,
  clicked: FeedbackDirection,
): FeedbackNextAction {
  if (clicked === 'up') {
    return currentVote === 1 ? 'clear' : 'up';
  }
  return currentVote === -1 ? 'clear' : 'down';
}

/**
 * Apply an API response action to the stored numeric vote.
 *
 * Converts the string action used by the API (`'up' | 'down' | 'clear'`)
 * to the numeric value stored locally on the message.
 */
export function applyFeedbackAction(action: FeedbackNextAction): MessageFeedbackVote {
  if (action === 'up') return 1;
  if (action === 'down') return -1;
  return null;
}

// ---------------------------------------------------------------------------
// Copy-payload helpers
// ---------------------------------------------------------------------------

/**
 * Extract the plain-text copy payload for a message.
 *
 * This is intentionally trivial: the component is responsible for passing
 * the correct `content` prop. The helper exists so the host can pre-process
 * (trim, strip markdown, etc.) in a testable way without touching the component.
 */
export function formatCopyPayload(content: string | null | undefined): string {
  return (content ?? '').trimEnd();
}
