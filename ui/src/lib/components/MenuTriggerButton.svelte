<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { ChevronDownCircle } from '@lucide/svelte';

  export let title = 'Menu';
  export let ariaLabel = 'Menu';
  export let disabled = false;
  export let className = '';
  export let buttonRef: HTMLButtonElement | null = null;

  const dispatch = createEventDispatcher<{ click: MouseEvent }>();
</script>

<button
  type="button"
  class={`inline-flex items-center justify-center rounded p-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition ${className}`}
  {disabled}
  title={title}
  aria-label={ariaLabel}
  bind:this={buttonRef}
  on:click={(event) => dispatch('click', event)}
>
  <ChevronDownCircle class="w-5 h-5" aria-hidden="true" />
</button>
