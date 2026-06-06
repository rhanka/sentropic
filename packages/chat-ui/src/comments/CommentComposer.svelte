<script lang="ts">
  /**
   * CommentComposer.svelte — composer surface for the comments panel.
   *
   * Generic: no sentropic domain strings.
   * Renders the comment input + placeholder + assignee chip + mention popup.
   */
  import type { Snippet } from 'svelte';
  import type { MentionMember } from './types.js';

  export let commentInput = '';
  export let assignedToLabel: string | null = null;
  export let workspaceCanComment = true;
  export let commentThreadResolved = false;
  export let showMentionMenu = false;
  export let mentionMatches: MentionMember[] = [];
  export let mentionLoading = false;
  export let mentionDelayElapsed = false;
  export let mentionError: string | null = null;
  export let placeholder = '';
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (k) => k;
  export let getMentionLabel: (m: MentionMember) => string = (m) => m.displayName || m.email || m.userId;

  /** Snippet for the actual text input. Receives the current value + disabled state. */
  export let renderInput: Snippet<[{ value: string; disabled: boolean; placeholder: string }]> | undefined = undefined;

  export let onSelectMention: (m: MentionMember) => void = () => {};
  export let onClearAssignment: () => void = () => {};
  export let mentionMenuRef: HTMLDivElement | null = null;

  const disabled = !workspaceCanComment || commentThreadResolved;
</script>

<div class="relative">
  {#if showMentionMenu}
    <div
      class="absolute bottom-12 left-0 z-30 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-2"
      bind:this={mentionMenuRef}
    >
      {#if mentionLoading && mentionDelayElapsed}
        <div class="px-2 py-1 text-[11px] text-slate-500">{labels('common.loading')}</div>
      {:else if mentionError}
        <div class="px-2 py-1 text-[11px] text-red-600">{labels('chat.comments.mention.loadError')}</div>
      {:else if !mentionLoading && mentionMatches.length === 0}
        <div class="px-2 py-1 text-[11px] text-slate-500">{labels('chat.comments.mention.none')}</div>
      {:else}
        <div class="space-y-1 max-h-48 overflow-auto slim-scroll">
          {#each mentionMatches as member (member.userId)}
            <button
              class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
              type="button"
              on:click={() => onSelectMention(member)}
            >
              <div class="font-medium text-slate-900 truncate">{getMentionLabel(member)}</div>
              {#if member.email}
                <div class="text-[10px] text-slate-400 truncate">{member.email}</div>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if disabled && commentInput.trim().length === 0}
    <div class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
      {placeholder}
    </div>
  {/if}

  {#if assignedToLabel}
    <div class="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
      <span>{labels('chat.comments.assignedTo', { values: { label: assignedToLabel } })}</span>
      <button
        type="button"
        class="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200"
        on:click={onClearAssignment}
        aria-label={labels('chat.comments.unassign')}
        title={labels('chat.comments.unassign')}
      >
        ×
      </button>
    </div>
  {/if}

  {#if renderInput}
    {@render renderInput({ value: commentInput, disabled, placeholder })}
  {/if}
</div>
