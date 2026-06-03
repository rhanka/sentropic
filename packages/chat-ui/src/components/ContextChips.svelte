<script lang="ts">
  /**
   * ContextChips — a presentational list of context chips.
   *
   * Renders the `ChatContextEntry[]` stream from an injected provider as a
   * horizontal chip row.  Active / used states drive CSS class variants.
   * All user-visible strings go through the injected `labels` resolver —
   * no hardcoded strings.
   *
   * Domain-neutral: the chip `type` is an opaque string; the host decides
   * what types exist and how they map to display text via `labels`.
   *
   * Contract (radar P3 — neg:chat-librarization-radar):
   * - `provider`  — the injected `ChatContextProvider`; defaults to a no-op.
   * - `labels`    — optional resolver `(key: string) => string`; key format
   *                 for chip labels: 'chat.context.chip.<type>'.
   * - `onRemove`  — called with the removed `ChatContextEntry` when the user
   *                 clicks the × on a chip (if removal is enabled).
   * - `onChipClick` — called with the clicked `ChatContextEntry`.
   */

  import { createNoopChatContextProvider, type ChatContextEntry, type ChatContextProvider } from '../state/chat-context.js';
  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /**
   * Host-injected provider that emits the current chip list.
   * Defaults to the no-op provider (empty list).
   */
  export let provider: ChatContextProvider = createNoopChatContextProvider();

  /**
   * i18n / label resolver injected by the host.
   * Receives a key string; returns the display string.
   * No user-facing string is hardcoded in this component.
   */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  /**
   * Called when the user clicks the remove (×) button on a chip.
   * If not provided, no remove button is rendered.
   */
  export let onRemove: ((entry: ChatContextEntry) => void) | undefined = undefined;

  /**
   * Called when the user clicks on a chip (not the remove button).
   * Optional — chips are non-interactive when not provided.
   */
  export let onChipClick: ((entry: ChatContextEntry) => void) | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Subscribe to the provider store. */
  $: entries = provider?.context;

  // ---------------------------------------------------------------------------
  // Label resolver — falls back to the key when no resolver is provided
  // ---------------------------------------------------------------------------
  const resolveLabel = (key: string): string => labels?.(key) ?? key;
</script>

<!--
  Chip row — inline-flex, wrapping, left-aligned.
  Each chip reflects active/used state via ARIA + CSS classes.
-->
{#if $entries && $entries.length > 0}
  <div
    class="flex flex-wrap gap-1"
    role="list"
    aria-label={resolveLabel('chat.context.chips.label')}
  >
    {#each $entries as entry (entry.type + (entry.id ?? ''))}
      <span
        role="listitem"
        class="chat-context-chip inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
        class:chat-context-chip-active={entry.active}
        class:chat-context-chip-used={entry.used}
        aria-current={entry.active ? 'true' : undefined}
      >
        {#if onChipClick}
          <button
            type="button"
            class="chat-context-chip-label truncate max-w-[160px] text-left"
            title={entry.label}
            on:click={() => onChipClick?.(entry)}
          >
            {entry.label}
          </button>
        {:else}
          <span class="chat-context-chip-label truncate max-w-[160px]" title={entry.label}>
            {entry.label}
          </span>
        {/if}
        {#if onRemove}
          <button
            type="button"
            class="chat-context-chip-remove ml-0.5 flex-shrink-0 opacity-50 hover:opacity-100"
            aria-label={resolveLabel('chat.context.chip.remove')}
            title={resolveLabel('chat.context.chip.remove')}
            on:click|stopPropagation={() => onRemove?.(entry)}
          >
            ×
          </button>
        {/if}
      </span>
    {/each}
  </div>
{/if}
