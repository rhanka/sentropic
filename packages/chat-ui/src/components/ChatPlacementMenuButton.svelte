<script lang="ts">
  /**
   * ChatPlacementMenuButton.svelte — "Move chat to…" placement menu affordance
   * (surfaces L1c-menu; SPEC_EVOL_CHAT_SURFACES).
   *
   * Extracted from ChatDock's former `absolute top-2 right-2 z-10` overlay,
   * which sat ON TOP of the host's own header toolbar (obscuring the Close
   * button — see e2e 03-chat.spec.ts:396 collision). The trigger+popup now
   * lives HERE, meant to be mounted by the HOST inside its own header toolbar
   * (next to its display-mode toggle / Close button) as a normal in-flow
   * element, not as a floating overlay. ChatDock no longer renders any
   * trigger/popup UI itself — it only derives the dock's container placement
   * from `placementMenu.current()` via its own subscription.
   *
   * Owns: the trigger button, the role="menu" popup (contextual MODE + SIDE),
   * and ALL keyboard/a11y/outside-click logic (code review fixes F1-F5):
   * F1 — Escape/Arrow keydowns on the popup stopPropagation so they never
   *      bubble to an ancestor dialog's own Escape-closes handler.
   * F4 — the host is responsible for not mounting this in contexts where the
   *      menu would be dead (e.g. sidepanel host mode): this component itself
   *      is unconditional, mounted only when the host chooses to.
   * F5 — a pointerdown outside the trigger+popup closes the popup.
   */
  import { onDestroy, tick } from 'svelte';
  import type { ChatPlacement } from '../state/chatPlacement.js';
  import type { ChatPlacementMenu, ChatPlacementMenuItem } from '../state/chatPlacementMenu.js';
  import Move from '@lucide/svelte/icons/move';
  import Check from '@lucide/svelte/icons/check';

  /** The headless placement menu model (owns intent + grouped menu surface). */
  export let placementMenu: ChatPlacementMenu;

  /** Called after a selected placement has settled. */
  export let onPlacementChange: ((placement: ChatPlacement) => void) | undefined = undefined;

  /** Optional host-owned drag lifecycle for the same Move icon used as the menu trigger. */
  export let dragCallbacks:
    | {
        start: (clientX: number, clientY: number) => void;
        move: (clientX: number, clientY: number) => void;
        end: (clientX: number, clientY: number) => void;
        cancel: () => void;
      }
    | undefined = undefined;

  /** Extra class(es) appended to the trigger button (host styling passthrough). */
  let className = '';
  export { className as class };

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  let menuPlacement: ChatPlacement | null = null;
  let placementMenuUnsubscribe: (() => void) | null = null;
  let placementMenuOpen = false;
  let placementMenuTriggerEl: HTMLButtonElement | null = null;
  let placementMenuItemEls: HTMLButtonElement[] = [];
  let placementMenuActiveIndex = 0;
  let placementMenuContainerEl: HTMLDivElement | null = null;
  let placementMenuGroups = placementMenu.groups();
  let placementMenuItems: ChatPlacementMenuItem[] = [];
  let dragPointerId: number | null = null;
  let dragStartPoint: { x: number; y: number } | null = null;
  let dragActive = false;
  let suppressNextTriggerClick = false;

  $: if (menuPlacement) {
    placementMenuGroups = placementMenu.groups();
    placementMenuItems = placementMenuGroups.flatMap((group) => group.items);
  }

  // (Re)subscribe whenever the placementMenu prop identity changes.
  $: {
    placementMenuUnsubscribe?.();
    placementMenuUnsubscribe = placementMenu.subscribe((current) => {
      menuPlacement = current;
    });
  }

  // ---------------------------------------------------------------------------
  // Open / close / select
  // ---------------------------------------------------------------------------

  const closePlacementMenu = () => {
    if (!placementMenuOpen) return;
    placementMenuOpen = false;
    placementMenuTriggerEl?.focus();
  };

  const openPlacementMenu = () => {
    if (placementMenuOpen) return;
    placementMenuGroups = placementMenu.groups();
    placementMenuItems = placementMenuGroups.flatMap((group) => group.items);
    const idx = placementMenuItems.findIndex((item) => item.checked);
    placementMenuActiveIndex = idx >= 0 ? idx : 0;
    placementMenuOpen = true;
    void tick().then(() => {
      placementMenuItemEls[placementMenuActiveIndex]?.focus();
    });
  };

  const togglePlacementMenu = () => {
    if (suppressNextTriggerClick) {
      suppressNextTriggerClick = false;
      return;
    }
    if (placementMenuOpen) closePlacementMenu();
    else openPlacementMenu();
  };

  const cancelPlacementDrag = () => {
    if (dragActive) dragCallbacks?.cancel();
    dragPointerId = null;
    dragStartPoint = null;
    dragActive = false;
  };

  const onPlacementMenuTriggerPointerDown = (event: PointerEvent) => {
    if (!dragCallbacks || event.button !== 0) return;
    dragPointerId = event.pointerId;
    dragStartPoint = { x: event.clientX, y: event.clientY };
    placementMenuTriggerEl?.setPointerCapture?.(event.pointerId);
  };

  const onPlacementMenuTriggerPointerMove = (event: PointerEvent) => {
    if (!dragCallbacks || event.pointerId !== dragPointerId || !dragStartPoint) return;
    if (!dragActive) {
      const moved = Math.hypot(event.clientX - dragStartPoint.x, event.clientY - dragStartPoint.y);
      if (moved < 6) return;
      dragActive = true;
      placementMenuOpen = false;
      dragCallbacks.start(event.clientX, event.clientY);
    }
    dragCallbacks.move(event.clientX, event.clientY);
  };

  const onPlacementMenuTriggerPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== dragPointerId) return;
    if (dragActive) {
      dragCallbacks?.end(event.clientX, event.clientY);
      suppressNextTriggerClick = true;
      dragPointerId = null;
      dragStartPoint = null;
      dragActive = false;
      return;
    }
    cancelPlacementDrag();
  };

  const selectPlacementMenuItem = (item: ChatPlacementMenuItem) => {
    void placementMenu.request(item.placement).then(() => {
      onPlacementChange?.(placementMenu.current());
    });
    closePlacementMenu();
  };

  // Standard menu dismissal: a pointerdown outside the trigger+popup closes
  // it. A pointerdown INSIDE (e.g. on a menu item) is left alone so it does
  // not steal focus / interfere with the item's own click handler.
  const onOutsidePlacementMenuPointerDown = (e: Event) => {
    if (!placementMenuOpen) return;
    const target = e.target as Node | null;
    if (placementMenuContainerEl && target && placementMenuContainerEl.contains(target)) {
      return;
    }
    closePlacementMenu();
  };

  $: if (typeof window !== 'undefined') {
    if (placementMenuOpen) {
      window.addEventListener('pointerdown', onOutsidePlacementMenuPointerDown);
    } else {
      window.removeEventListener('pointerdown', onOutsidePlacementMenuPointerDown);
    }
  }

  const onPlacementMenuTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dragActive) {
      e.stopPropagation();
      e.preventDefault();
      cancelPlacementDrag();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPlacementMenu();
    }
  };

  const movePlacementMenuFocus = (delta: number) => {
    const count = placementMenuItems.length;
    if (count === 0) return;
    placementMenuActiveIndex = (placementMenuActiveIndex + delta + count) % count;
    placementMenuItemEls[placementMenuActiveIndex]?.focus();
  };

  const onPlacementMenuListKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Must NOT reach any ancestor keydown handler (e.g. a host dialog's
      // own Escape-closes handler): otherwise Escape would close the whole
      // chat dock instead of just this popup (code review F1).
      e.stopPropagation();
      e.preventDefault();
      closePlacementMenu();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.stopPropagation();
      e.preventDefault();
      movePlacementMenuFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.stopPropagation();
      e.preventDefault();
      movePlacementMenuFocus(-1);
      return;
    }
    if (e.key === 'Tab') {
      closePlacementMenu();
    }
  };

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onOutsidePlacementMenuPointerDown);
    }
    placementMenuUnsubscribe?.();
    cancelPlacementDrag();
  });
</script>

<div class="relative inline-flex" bind:this={placementMenuContainerEl}>
  <button
    type="button"
    class="inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 {className}"
    aria-haspopup="menu"
    aria-expanded={placementMenuOpen}
    aria-label={placementMenu.labels.menuLabel}
    title={placementMenu.labels.menuLabel}
    bind:this={placementMenuTriggerEl}
    on:click={togglePlacementMenu}
    on:keydown={onPlacementMenuTriggerKeyDown}
    on:pointerdown={onPlacementMenuTriggerPointerDown}
    on:pointermove={onPlacementMenuTriggerPointerMove}
    on:pointerup={onPlacementMenuTriggerPointerUp}
    on:pointercancel={cancelPlacementDrag}
  >
    <Move class="w-4 h-4" aria-hidden="true" />
  </button>

  {#if placementMenuOpen}
    <div
      role="menu"
      aria-label={placementMenu.labels.menuLabel}
      tabindex="-1"
      class="absolute right-0 mt-1 w-40 rounded border border-gray-200 bg-white shadow-lg py-1 z-10"
      on:keydown={onPlacementMenuListKeyDown}
    >
      {#each placementMenuGroups as group, groupIndex (group.id)}
        {#if groupIndex > 0}
          <div role="separator" class="my-1 border-t border-gray-200"></div>
        {/if}
        <div role="group" aria-label={group.label}>
          {#each group.items as item (item.id)}
            {@const itemIndex = placementMenuItems.indexOf(item)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={item.checked}
              tabindex={itemIndex === placementMenuActiveIndex ? 0 : -1}
              class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50"
              bind:this={placementMenuItemEls[itemIndex]}
              on:click={() => selectPlacementMenuItem(item)}
            >
              <span>{item.label}</span>
              {#if item.checked}
                <Check class="w-3.5 h-3.5" aria-hidden="true" />
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>
