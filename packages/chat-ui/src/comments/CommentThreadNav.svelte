<script lang="ts">
  /**
   * CommentThreadNav.svelte — header bar for the comments panel.
   *
   * Renders: section label, resolve status/assignee, thread picker menu,
   * new-thread button, resolve/reopen button, prev/next buttons, delete button.
   *
   * Generic: no sentropic domain strings.
   */
  import type { Snippet } from 'svelte';
  import type { CommentThreadSummary } from './types.js';

  export let activeCommentSectionLabel = '';
  export let commentThreadResolved = false;
  export let commentThreadResolvedAt: string | null = null;
  export let assignedToLabel: string | null = null;
  export let isAssignedToCurrentUser = false;
  export let currentCommentRootId: string | null = null;
  export let canResolveCurrent = false;
  export let hasPreviousThread = false;
  export let hasNextThread = false;
  export let showResolvedComments = false;
  export let resolvedCount = 0;
  export let visibleCommentThreads: CommentThreadSummary[] = [];
  export let commentThreadId: string | null = null;
  export let showCommentMenu = false;
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (k) => k;
  export let getThreadSectionLabel: (sectionKey: string | null) => string = () => '';
  export let formatTimestamp: (value: string | null | undefined) => string = () => '';

  export let onNewThread: () => void = () => {};
  export let onSelectThread: (t: CommentThreadSummary) => void = () => {};
  export let onResolveThread: () => void = () => {};
  export let onDeleteThread: () => void = () => {};
  export let onPreviousThread: () => void = () => {};
  export let onNextThread: () => void = () => {};
  export let onToggleShowResolved: () => void = () => {};

  /** Optional snippet for rendering the menu popover trigger + menu. */
  export let renderThreadMenu: Snippet<[{
    open: boolean;
    toggle: () => void;
    threads: CommentThreadSummary[];
    currentThreadId: string | null;
    onSelect: (t: CommentThreadSummary) => void;
    onNew: () => void;
  }]> | undefined = undefined;
</script>

<div class="border-b border-slate-100 px-3 py-2 space-y-2">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="min-w-0 text-xs text-slate-500 flex flex-wrap items-center gap-2">
      <span>{activeCommentSectionLabel}</span>
      {#if commentThreadResolved && commentThreadResolvedAt}
        <span class="text-slate-400">•</span>
        <span>
          {labels('chat.comments.resolvedAt', { values: { at: formatTimestamp(commentThreadResolvedAt) } })}
        </span>
      {:else if assignedToLabel}
        <span class="text-slate-400">•</span>
        <span>
          {#if isAssignedToCurrentUser}
            {labels('chat.comments.assignedToMe')}
          {:else}
            {labels('chat.comments.assignedTo', { values: { label: assignedToLabel } })}
          {/if}
        </span>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-1">
      {#if renderThreadMenu}
        {@render renderThreadMenu({
          open: showCommentMenu,
          toggle: () => { showCommentMenu = !showCommentMenu; },
          threads: visibleCommentThreads,
          currentThreadId: commentThreadId,
          onSelect: onSelectThread,
          onNew: onNewThread,
        })}
      {/if}

      <button
        class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
        on:click={onNewThread}
        title={labels('chat.comments.newThread')}
        aria-label={labels('chat.comments.newThread')}
        type="button"
      >
        +
      </button>

      <button
        class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
        on:click={onResolveThread}
        title={commentThreadResolved ? labels('chat.comments.reopen') : labels('chat.comments.resolve')}
        aria-label={commentThreadResolved ? labels('chat.comments.reopen') : labels('chat.comments.resolve')}
        type="button"
        disabled={!currentCommentRootId || !canResolveCurrent}
      >
        {commentThreadResolved ? '↩' : '✓'}
      </button>

      <button
        class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
        type="button"
        disabled={!hasPreviousThread}
        on:click={onPreviousThread}
        title={labels('chat.comments.previous')}
        aria-label={labels('chat.comments.previous')}
      >
        ‹
      </button>

      <button
        class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
        type="button"
        disabled={!hasNextThread}
        on:click={onNextThread}
        title={labels('chat.comments.next')}
        aria-label={labels('chat.comments.next')}
      >
        ›
      </button>

      <button
        class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
        on:click={onDeleteThread}
        title={labels('chat.comments.deleteThread')}
        aria-label={labels('chat.comments.deleteThread')}
        type="button"
        disabled={!currentCommentRootId}
      >
        🗑
      </button>
    </div>
  </div>
</div>
