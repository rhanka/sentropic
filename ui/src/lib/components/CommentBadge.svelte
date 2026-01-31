<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { MessageCircle } from '@lucide/svelte';

  export let count = 0;
  export let disabled = false;
  export let title = 'Commentaires';
  export let hideWhenZero = true;

  const dispatch = createEventDispatcher();
  $: hasCount = count > 0;
  $: shouldHide = hideWhenZero && !hasCount;
</script>

<button
  type="button"
  class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 transition disabled:cursor-not-allowed disabled:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 {shouldHide ? 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto' : ''}"
  {disabled}
  title={title}
  aria-label={title}
  on:click={() => dispatch('click')}
>
  <MessageCircle class="w-3.5 h-3.5" />
  {#if hasCount}
    <span class="font-semibold">{count}</span>
  {/if}
</button>
