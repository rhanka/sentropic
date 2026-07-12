<script lang="ts">
  /**
   * ChatSessionsBar — the sentropic gold conversation bar rendered above the
   * chat panel (gold shell program, S5b). Extracted from the app-local
   * `ChatWidget.svelte` sessions bar: truncated active-session label, session
   * list popover (host-rendered), "new session" and "delete" actions with an
   * inline delete confirm.
   *
   * Headless state comes from `resolveSessionsBar` (state/chatWidgetShell);
   * the host injects i18n labels, the popover menu and the icon set.
   */
  import type { Snippet } from 'svelte';

  import {
    resolveSessionsBar,
    type ChatWidgetSession,
    type SessionsBarLabels,
  } from '../state/chatWidgetShell.js';

  export let sessions: readonly ChatWidgetSession[] = [];
  export let sessionId: string | null = null;
  export let loading = false;
  export let barLabels: SessionsBarLabels;
  /** i18n — host-injected translator (button titles + confirm strings). */
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (
    k,
  ) => k;

  export let onNewSession: () => void = () => {};
  export let onConfirmDelete: () => void | Promise<void> = () => {};
  export let deleteConfirmPending = false;
  export let deleteInFlight = false;

  /**
   * Host-rendered session list popover (menu primitive stays host-side, same
   * pattern as the comments thread picker).
   */
  export let renderSessionsMenu:
    | Snippet<
        [
          {
            sessions: readonly ChatWidgetSession[];
            sessionId: string | null;
            loading: boolean;
            formatLabel: (s: ChatWidgetSession) => string;
            onNew: () => void;
          },
        ]
      >
    | undefined = undefined;

  /** Icons stay host-side (lucide): plus + trash. */
  export let renderPlusIcon: Snippet | undefined = undefined;
  export let renderTrashIcon: Snippet | undefined = undefined;

  $: bar = resolveSessionsBar({
    sessions,
    sessionId,
    loading,
    deleteConfirmPending,
    labels: barLabels,
  });

  const formatLabel = (s: ChatWidgetSession) =>
    s.title ? s.title : barLabels.defaultTitle(s.id.slice(0, 6));
</script>

<div class="border-b border-slate-100 px-3 py-2 flex items-center justify-between gap-2">
  <div class="min-w-0 text-xs text-slate-500 truncate" title={bar.label}>
    {bar.label}
  </div>
  <div class="flex items-center gap-1">
    {#if renderSessionsMenu}
      {@render renderSessionsMenu({
        sessions,
        sessionId,
        loading,
        formatLabel,
        onNew: onNewSession,
      })}
    {/if}
    <button
      class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
      on:click={onNewSession}
      title={labels('chat.sessions.new')}
      aria-label={labels('chat.sessions.new')}
      type="button"
    >
      {#if renderPlusIcon}{@render renderPlusIcon()}{/if}
    </button>
    <button
      class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
      on:click={() => (deleteConfirmPending = true)}
      title={labels('chat.sessions.delete')}
      aria-label={labels('chat.sessions.delete')}
      type="button"
      disabled={!bar.canDelete}
    >
      {#if renderTrashIcon}{@render renderTrashIcon()}{/if}
    </button>
  </div>
</div>
{#if bar.deleteConfirmPending && sessionId}
  <div class="border-b border-slate-100 px-3 py-2">
    <div class="chat-delete-confirm-surface rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
      <div class="text-xs font-semibold text-slate-700">
        {labels('chat.sessions.confirmDelete')}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="chat-delete-confirm-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90"
          type="button"
          disabled={deleteInFlight}
          on:click={() => void onConfirmDelete()}
        >
          {labels('common.delete')}
        </button>
        <button
          class="chat-delete-confirm-choice rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
          type="button"
          disabled={deleteInFlight}
          on:click={() => (deleteConfirmPending = false)}
        >
          {labels('common.cancel')}
        </button>
      </div>
    </div>
  </div>
{/if}
