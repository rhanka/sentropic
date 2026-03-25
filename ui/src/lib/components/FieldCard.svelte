<script lang="ts">
  import CommentBadge from '$lib/components/CommentBadge.svelte';

  export let label: string = '';
  export let color: string = '';
  export let commentSection: string = '';
  export let commentCount: number = 0;
  export let onOpenComments: (() => void) | null = null;

  // Tailwind requires full class names at scan time — dynamic interpolation won't work.
  // Map color prop to the exact bg/text classes used in InitiativeDetail.
  const colorBgMap: Record<string, string> = {
    orange: 'bg-orange-100 text-orange-800',
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    purple: 'bg-purple-100 text-purple-800',
    white: 'bg-white text-slate-800 border-b border-slate-200',
  };

  $: headerClasses = color ? (colorBgMap[color] || 'bg-white text-slate-800 border-b border-slate-200') : '';
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section={commentSection}>
  {#if color}
    <div class="{headerClasses} px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
      <h3 class="flex items-center justify-between text-sm font-semibold">
        {label}
        <CommentBadge
          count={commentCount}
          disabled={!onOpenComments}
          on:click={() => { if (onOpenComments) onOpenComments(); }}
        />
      </h3>
    </div>
  {:else}
    <h3 class="flex items-center justify-between text-sm font-semibold text-slate-700 mb-2">
      {label}
      <CommentBadge
        count={commentCount}
        disabled={!onOpenComments}
        on:click={() => { if (onOpenComments) onOpenComments(); }}
      />
    </h3>
  {/if}
  <slot />
</div>
