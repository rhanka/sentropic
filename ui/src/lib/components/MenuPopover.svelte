<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let open = false;
  export let placement: 'up' | 'down' = 'down';
  export let align: 'left' | 'right' = 'right';
  export let widthClass = 'w-60';
  export let menuClass = '';
  export let disabled = false;
  export let triggerRef: HTMLElement | null = null;

  let menuRef: HTMLDivElement | null = null;

  const dispatch = createEventDispatcher<{ open: void; close: void }>();

  const close = () => {
    if (!open) return;
    open = false;
    dispatch('close');
  };

  const toggle = () => {
    if (disabled) return;
    open = !open;
    dispatch(open ? 'open' : 'close');
  };

  onMount(() => {
    const handleClick = (event: MouseEvent) => {
      if (!open) return;
      const target = event.target as Node | null;
      if (target && (menuRef?.contains(target) || triggerRef?.contains(target))) return;
      close();
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });

  $: positionClass = placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2';
  $: alignClass = align === 'right' ? 'right-0' : 'left-0';
</script>

<div class="relative">
  <slot name="trigger" {toggle} {open} {disabled} />
  {#if open}
    <div
      class={`absolute ${positionClass} ${alignClass} ${widthClass} rounded-lg border border-slate-200 bg-white shadow-lg p-2 z-20 ${menuClass}`}
      bind:this={menuRef}
    >
      <slot name="menu" {close} />
    </div>
  {/if}
</div>
