<script lang="ts">
  /**
   * CommentTimeline.svelte — renders a list of CommentItem messages in a thread.
   *
   * Generic: no sentropic domain strings, no REST calls.
   * The host / parent provides all display content (labels, timestamps, user info).
   */
  import type { Snippet } from 'svelte';
  import type { CommentItem } from './types.js';
  import { getInitials, getCommentAuthorLabel, isAiComment } from './utils.js';

  export let commentMessages: CommentItem[] = [];
  export let commentLoading = false;
  export let commentThreadId: string | null = null;
  export let lastEditableCommentId: string | null = null;
  export let editingCommentId: string | null = null;
  export let editingCommentContent = '';
  export let workspaceCanComment = true;
  /** i18n helpers — passed from parent so the module stays framework-neutral. */
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (k) => k;
  export let formatTimestamp: (value: string | null | undefined) => string = () => '';
  export let isCommentByCurrentUser: (c: CommentItem) => boolean = () => false;
  export let isCopied: (id: string) => boolean = () => false;

  /** Snippet for rendering an edit form inside a user bubble. */
  export let renderEditForm:
    | Snippet<[{ commentId: string; content: string; onCancel: () => void; onCommit: () => void }]>
    | undefined = undefined;

  /** Callbacks */
  export let onStartEdit: (c: CommentItem) => void = () => {};
  export let onCopy: (c: CommentItem) => void = () => {};
  export let onCommitEdit: () => void = () => {};
  export let onCancelEdit: () => void = () => {};

  /** Optional scroll anchor element binder. */
  export let listEl: HTMLDivElement | null = null;
</script>

<div
  class="h-full overflow-y-auto p-3 space-y-2 slim-scroll"
  style="scrollbar-gutter: stable;"
  bind:this={listEl}
>
  {#if commentLoading && commentMessages.length === 0}
    <div class="text-xs text-slate-500">{labels('common.loading')}</div>
  {:else if !commentThreadId}
    <div class="text-xs text-slate-500">{labels('chat.comments.selectThreadHint')}</div>
  {:else if commentMessages.length === 0}
    <div class="text-xs text-slate-500">{labels('chat.comments.noMessagesThread')}</div>
  {:else}
    {#each commentMessages as c (c.id)}
      {@const isMine = isCommentByCurrentUser(c)}
      {@const canEdit = isMine && c.id === lastEditableCommentId && workspaceCanComment}
      {@const isAi = isAiComment(c)}
      {@const authorLabel = getCommentAuthorLabel(c)}
      {@const initials = getInitials(authorLabel)}

      {#if isMine}
        <div class="flex flex-col items-end group">
          {#if isAi}
            <div class="mb-1 flex items-center justify-end">
              <div
                class="relative h-7 w-7 rounded-full bg-primary text-white border border-primary/80 flex items-center justify-center text-[11px]"
              >
                {initials}
                <span
                  class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[9px] text-slate-600"
                >
                  AI
                </span>
              </div>
            </div>
          {/if}
          <div
            class="chat-user-bubble max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
          >
            {#if editingCommentId === c.id && renderEditForm}
              {@render renderEditForm({
                commentId: c.id,
                content: editingCommentContent,
                onCancel: onCancelEdit,
                onCommit: onCommitEdit,
              })}
            {:else}
              {c.content ?? ''}
            {/if}
          </div>
          <div
            class="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <button
              class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
              on:click={() => onCopy(c)}
              type="button"
              aria-label={labels('common.copy')}
              title={labels('common.copy')}
            >
              {isCopied(c.id) ? '✓' : '⎘'}
            </button>
            {#if canEdit && editingCommentId !== c.id}
              <button
                class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                on:click={() => onStartEdit(c)}
                type="button"
                aria-label={labels('chat.edit.editLabel')}
                title={labels('chat.edit.editLabel')}
              >
                ✏
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex items-start gap-2 group">
          <div
            class="relative h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] text-slate-600"
          >
            {initials}
            {#if isAi}
              <span
                class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[9px] text-slate-600"
              >
                AI
              </span>
            {/if}
          </div>
          <div class="max-w-[85%] w-full">
            <div class="text-[11px] text-slate-500 mb-1 flex items-center gap-2">
              <span>{authorLabel}{isAi ? ', AI' : ''}</span>
              {#if c.created_at}
                <span>{formatTimestamp(c.created_at)}</span>
              {/if}
            </div>
            <div class="rounded border border-slate-200 bg-white text-xs px-3 py-2 break-words">
              {c.content ?? ''}
            </div>
            <div
              class="mt-1 flex items-center gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <button
                class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                on:click={() => onCopy(c)}
                type="button"
                aria-label={labels('common.copy')}
                title={labels('common.copy')}
              >
                {isCopied(c.id) ? '✓' : '⎘'}
              </button>
            </div>
          </div>
        </div>
      {/if}
    {/each}
  {/if}
  {#if commentLoading && commentMessages.length > 0}
    <div class="text-[11px] text-slate-400 mt-2">{labels('chat.comments.updating')}</div>
  {/if}
</div>
