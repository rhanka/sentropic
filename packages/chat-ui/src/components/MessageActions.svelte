<script lang="ts">
  /**
   * MessageActions — a presentational action row for a single chat message.
   *
   * Renders copy / edit / regenerate (retry) / feedback buttons for user and
   * assistant messages.  All transport (API calls, clipboard writes) is delegated
   * to injected callbacks — this component only renders and emits.
   *
   * Extracted from AppChatPanel.svelte markup (lines 5095-5138 [user row],
   * 5181-5244 [assistant row] on main).
   *
   * EXCLUDED (app-owned): checkpoint-restore button, comment copy/edit.
   *
   * Contract:
   * - `role`          — 'user' | 'assistant'; drives which buttons are shown.
   * - `streamStatus`  — 'processing' | 'completed'; disables actions while streaming.
   * - `isLastAssistantSegment` — show assistant actions only on last terminal segment.
   * - `isCopied`      — caller tracks copy-flash state per message/segment key.
   * - `feedbackVote`  — current numeric vote (1 | -1 | null | undefined).
   * - `labels`        — injected resolver (key: string) => string; NO hardcoded strings.
   * - `onCopy`        — called when the user clicks copy; caller handles clipboard write.
   * - `onEdit`        — called when the user clicks edit (user messages only).
   * - `onRegenerate`  — called when the user clicks regenerate/retry (assistant only).
   * - `onFeedback`    — called with 'up' | 'down' | 'clear' when feedback clicked.
   */

  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Pencil from '@lucide/svelte/icons/pencil';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ThumbsDown from '@lucide/svelte/icons/thumbs-down';
  import ThumbsUp from '@lucide/svelte/icons/thumbs-up';

  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
  import {
    buildFeedbackNextVote,
    resolveAvailableActions,
    resolveFeedbackDisplayState,
    type MessageActionRole,
    type MessageActionStreamStatus,
    type MessageFeedbackVote,
  } from '../utils/message-actions.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /** Role of the message this row belongs to. */
  export let role: MessageActionRole;

  /** Stream status — 'processing' while streaming, 'completed' when done. */
  export let streamStatus: MessageActionStreamStatus = 'completed';

  /**
   * True when this is both a terminal segment AND the last assistant segment.
   * Only meaningful for assistant messages.  Controls whether assistant actions
   * (regenerate, feedback) are displayed.
   */
  export let isLastAssistantSegment: boolean = false;

  /**
   * Whether the copy-flash indicator is active for this message.
   * The host manages the flash timer and passes the boolean here.
   */
  export let isCopied: boolean = false;

  /**
   * Current feedback vote stored on the message (1 = up, -1 = down, null = none).
   */
  export let feedbackVote: MessageFeedbackVote = null;

  /**
   * i18n / label resolver injected by the host.
   * Receives a key string; returns the display string.
   * No user-facing string is hardcoded in this component.
   */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Callbacks — transport is the host's responsibility
  // ---------------------------------------------------------------------------

  /** Called when the user clicks the copy button. */
  export let onCopy: (() => void) | undefined = undefined;

  /** Called when the user clicks the edit button (user messages only). */
  export let onEdit: (() => void) | undefined = undefined;

  /**
   * Called when the user clicks regenerate / retry (assistant messages only).
   * The host is responsible for handling checkpoint prompts if needed.
   */
  export let onRegenerate: (() => void) | undefined = undefined;

  /**
   * Called with the next feedback action when the user clicks a feedback button.
   * Payload: 'up' | 'down' | 'clear'.
   */
  export let onFeedback: ((action: 'up' | 'down' | 'clear') => void) | undefined =
    undefined;

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  $: available = resolveAvailableActions({ role, streamStatus, isLastAssistantSegment });
  $: feedback = resolveFeedbackDisplayState(feedbackVote);

  // ---------------------------------------------------------------------------
  // Label resolver — falls back to the key when no resolver is provided
  // ---------------------------------------------------------------------------
  const resolveLabel = (key: string): string => labels?.(key) ?? key;
</script>

<!--
  User message action row — aligns right, visible on group-hover.
  Mirrors AppChatPanel markup lines 5095-5138 on main.
-->
{#if role === 'user' && (available.copy || available.edit)}
  <div
    class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
  >
    {#if available.copy}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
        type="button"
        aria-label={resolveLabel('common.copy')}
        title={resolveLabel('common.copy')}
        on:click={() => onCopy?.()}
      >
        {#if isCopied}
          <Check class="w-3.5 h-3.5 text-slate-900" />
        {:else}
          <Copy class="w-3.5 h-3.5" />
        {/if}
      </button>
    {/if}
    {#if available.edit}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
        type="button"
        aria-label={resolveLabel('chat.message.edit')}
        title={resolveLabel('chat.message.edit')}
        on:click={() => onEdit?.()}
      >
        <Pencil class="w-3.5 h-3.5" />
      </button>
    {/if}
  </div>
{/if}

<!--
  Assistant message action row — visible on group-hover (owner UAT 2026-07-05:
  align with the user row; was previously always visible).
  Mirrors AppChatPanel markup lines 5181-5244 on main.
-->
{#if role === 'assistant' && (available.copy || available.regenerate || available.feedbackUp)}
  <div
    class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
  >
    {#if available.copy}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        type="button"
        aria-label={resolveLabel('common.copy')}
        title={resolveLabel('common.copy')}
        on:click={() => onCopy?.()}
      >
        {#if isCopied}
          <Check class="w-3.5 h-3.5 text-slate-900" />
        {:else}
          <Copy class="w-3.5 h-3.5" />
        {/if}
      </button>
    {/if}
    {#if available.regenerate}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        type="button"
        aria-label={resolveLabel('common.retry')}
        title={resolveLabel('common.retry')}
        on:click={() => onRegenerate?.()}
      >
        <RotateCcw class="w-3.5 h-3.5" />
      </button>
    {/if}
    {#if available.feedbackUp}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        class:text-slate-900={feedback.isUp}
        class:chat-message-action-button-active={feedback.isUp}
        type="button"
        aria-label={resolveLabel('chat.feedback.useful')}
        title={resolveLabel('chat.feedback.useful')}
        on:click={() => onFeedback?.(buildFeedbackNextVote(feedbackVote, 'up'))}
      >
        <ThumbsUp
          class="w-3.5 h-3.5"
          fill={feedback.isUp ? 'currentColor' : 'none'}
        />
      </button>
    {/if}
    {#if available.feedbackDown}
      <button
        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        class:text-slate-900={feedback.isDown}
        class:chat-message-action-button-active={feedback.isDown}
        type="button"
        aria-label={resolveLabel('chat.feedback.notUseful')}
        title={resolveLabel('chat.feedback.notUseful')}
        on:click={() => onFeedback?.(buildFeedbackNextVote(feedbackVote, 'down'))}
      >
        <ThumbsDown
          class="w-3.5 h-3.5"
          fill={feedback.isDown ? 'currentColor' : 'none'}
        />
      </button>
    {/if}
  </div>
{/if}
