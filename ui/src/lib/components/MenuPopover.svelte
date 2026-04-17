<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let open = false;
  export let placement: 'up' | 'down' = 'down';
  export let align: 'left' | 'right' = 'right';
  export let widthClass = 'w-60';
  export let menuClass = '';
  export let menuPaddingClass = 'p-2';
  export let menuStyle = '';
  export let disabled = false;
  export let triggerRef: HTMLElement | null = null;
  export let strategy: 'absolute' | 'fixed' = 'absolute';

  let menuRef: HTMLDivElement | null = null;
  let fixedStyle = '';

  const dispatch = createEventDispatcher<{ open: void; close: void }>();

  const close = () => {
    if (!open) return;
    open = false;
    dispatch('close');
  };

  const computeFixedStyle = (): string => {
    if (strategy !== 'fixed' || !triggerRef) return '';
    const rect = triggerRef.getBoundingClientRect();
    const styles: string[] = [];
    if (placement === 'up') {
      styles.push(`bottom: ${window.innerHeight - rect.top + 8}px`);
    } else {
      styles.push(`top: ${rect.bottom + 8}px`);
    }
    if (align === 'left') {
      styles.push(`left: ${rect.left}px`);
    } else {
      styles.push(`right: ${window.innerWidth - rect.right}px`);
    }
    return styles.join('; ');
  };

  const toggle = () => {
    if (disabled) return;
    if (!open && strategy === 'fixed') {
      fixedStyle = computeFixedStyle();
    }
    open = !open;
    dispatch(open ? 'open' : 'close');
  };

  onMount(() => {
    const isWithinPopover = (event: Event) => {
      const path =
        typeof (event as Event & { composedPath?: () => EventTarget[] })
          .composedPath === 'function'
          ? (event as Event & { composedPath: () => EventTarget[] }).composedPath()
          : [];
      if (menuRef && path.includes(menuRef)) return true;
      if (triggerRef && path.includes(triggerRef)) return true;
      const target = event.target as Node | null;
      if (target && (menuRef?.contains(target) || triggerRef?.contains(target)))
        return true;
      return false;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!open) return;
      if (isWithinPopover(event)) return;
      close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  });

  $: positionClass = placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2';
  $: alignClass = align === 'right' ? 'right-0' : 'left-0';
</script>

{#if strategy === 'fixed'}
  <div>
    <slot name="trigger" {toggle} {open} {disabled} />
  </div>
  {#if open}
    <div
      class={`fixed ${widthClass} rounded-lg border border-slate-200 bg-white shadow-lg z-50 ${menuPaddingClass} ${menuClass}`}
      style="{fixedStyle}{menuStyle ? '; ' + menuStyle : ''}"
      bind:this={menuRef}
    >
      <slot name="menu" {close} />
    </div>
  {/if}
{:else}
  <div class="relative">
    <slot name="trigger" {toggle} {open} {disabled} />
    {#if open}
      <div
        class={`absolute ${positionClass} ${alignClass} ${widthClass} rounded-lg border border-slate-200 bg-white shadow-lg z-20 ${menuPaddingClass} ${menuClass}`}
        style={menuStyle}
        bind:this={menuRef}
      >
        <slot name="menu" {close} />
      </div>
    {/if}
  </div>
{/if}
