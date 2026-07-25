<script lang="ts">
  /**
   * ChatDock.svelte — generic dock surface for @sentropic/chat-ui.
   *
   * Encapsulates the GENERIC dock chrome:
   * - displayMode (docked/floating) via resolveEffectiveChatWidgetMode
   * - dockWidthCss + resize handler
   * - open/close/toggle + lazy mount (hasOpenedOnce)
   * - mobile bottom-sheet + scroll-lock (matchMedia ≤639px)
   * - layout publication to chatWidgetLayout store
   * - Ctrl+Shift+K global shortcut
   * - Base focus trap (Escape closes; Tab cycles; overrideable via onDialogKeyDown)
   *
   * APP-SPECIFIC concerns are injected via props/snippets/callbacks:
   * - Bubble trigger: renderBubble snippet — receives { toggle, isOpen }
   * - Dialog content: renderContent snippet — receives { isDocked, isMobileViewport }
   * - hostMode / isExtensionOverlayHost → props
   * - contentOverflowVisible → prop (set true when a popover menu extends outside)
   * - Custom keyboard handling: onDialogKeyDown prop (overrides base Tab trap)
   * - dialogEl / bubbleButtonEl: exported so the host can bind to them
   *
   * sentropic's ChatWidget passes its bubble button as renderBubble, and its
   * header+panels block as renderContent — ZERO UX change.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import {
    chatWidgetLayout,
    type ChatWidgetDisplayMode,
  } from '../stores/chatWidgetLayout.js';
  import {
    canChatPlacementMenuOwnPlacement,
    computeChatWidgetDockWidthCss,
    resolveEffectiveChatWidgetMode,
    type ChatWidgetHostMode,
  } from '../state/chatWidgetShell.js';
  import { displayModeToPlacement } from '../state/chatPlacementMigration.js';
  import { placementContainerClasses } from '../state/chatPlacementClasses.js';
  import type { ChatPlacement } from '../state/chatPlacement.js';
  import type { ChatPlacementMenu } from '../state/chatPlacementMenu.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /** Current display mode (docked | floating). Persisted by host via onDisplayModeChange. */
  export let displayMode: ChatWidgetDisplayMode = 'floating';

  /** Host mode: 'overlay' (default) or 'sidepanel'. */
  export let hostMode: ChatWidgetHostMode = 'overlay';

  /**
   * True when this widget is hosted in a Chrome extension overlay.
   * Forces displayMode to 'floating'.
   */
  export let isExtensionOverlayHost = false;

  /** True when the dock should start open (e.g. sidepanel forces open). */
  export let initialOpen = false;

  /**
   * When true the dialog container renders overflow-visible instead of
   * overflow-hidden — needed when a popover menu must extend outside the dialog.
   */
  export let contentOverflowVisible = false;

  /**
   * Extra CSS class(es) appended to the outer container div.
   * Use to add app-specific class names (e.g. 'queue-monitor') needed for
   * existing CSS rules.
   */
  export let containerClass = '';

  /**
   * Inline style string for the outer container div.
   * Use for font-family or other CSS custom properties.
   */
  export let containerStyle = '';

  /**
   * Override the dialog element id (default: 'chat-dock-dialog').
   * Set to 'chat-widget-dialog' to match the app's aria-controls attribute.
   */
  export let dialogId = 'chat-dock-dialog';

  /** aria-label for the dialog element. */
  export let dialogAriaLabel = '';

  /**
   * Extra CSS class(es) prepended to the dialog container div class list.
   * Use to add app-specific class names (e.g. 'topai-chat-widget-shell')
   * needed for existing CSS rules (app.css vscode dark mode overrides).
   */
  export let dialogClass = '';

  /** Whether the browser context is available (guards localStorage/window). */
  export let isBrowser = false;

  /**
   * Optional headless placement menu (surfaces L1c-menu). When provided,
   * ChatDock derives the active placement from `placementMenu.current()`
   * instead of the legacy displayMode->placement bridge. When undefined
   * (default), behavior is EXACTLY today's: zero change.
   *
   * ChatDock renders NO trigger/popup UI for this menu — that affordance
   * lives in ChatPlacementMenuButton, which the HOST mounts separately
   * (e.g. in its own header toolbar, alongside a display-mode toggle /
   * Close button) so it participates in normal in-flow layout instead of
   * floating as an overlay on top of host chrome.
   */
  export let placementMenu: ChatPlacementMenu | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Snippets
  // ---------------------------------------------------------------------------

  /**
   * Renders the floating bubble trigger button.
   * Signature: { toggle: () => void; isOpen: boolean }
   * Not rendered in sidepanel host mode.
   */
  export let renderBubble:
    | Snippet<[{ toggle: () => void; isOpen: boolean }]>
    | undefined = undefined;

  /**
   * Renders the dialog body (header + panels, etc.).
   * Signature: { isDocked: boolean; isMobileViewport: boolean }
   */
  export let renderContent:
    | Snippet<[{ isDocked: boolean; isMobileViewport: boolean }]>
    | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Callbacks / event handlers
  // ---------------------------------------------------------------------------

  /**
   * Called when the dock closes (host sidepanel override: call window.close()).
   * If supplied, ChatDock will NOT restore focus — the host is responsible.
   */
  export let onClose: (() => void) | undefined = undefined;

  /**
   * Overrides the built-in keydown handler on the dialog element.
   * The host should handle: Escape → close(), Tab cycling with custom refs.
   * If undefined, ChatDock uses its own base handler (Escape + simple Tab cycle).
   */
  export let onDialogKeyDown: ((e: KeyboardEvent) => void) | undefined = undefined;

  /**
   * Called when open/close state changes (for handoff-state sync, etc.).
   */
  export let onOpenChange: ((isOpen: boolean) => void) | undefined = undefined;

  /**
   * Called when displayMode changes (docked ↔ floating) so the host can
   * persist it to localStorage.
   */
  export let onDisplayModeChange:
    | ((mode: ChatWidgetDisplayMode) => void)
    | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Exported DOM refs (bindable by host for custom focus management)
  // ---------------------------------------------------------------------------

  /** The dialog container element — bind to use in custom onDialogKeyDown. */
  export let dialogEl: HTMLDivElement | null = null;

  /** The bubble button element — bind if host needs to restore focus to it. */
  export let bubbleButtonEl: HTMLButtonElement | null = null;

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  let isVisible = false;
  let hasOpenedOnce = false;
  let dockWidthCss = '0px';
  let isMobileViewport = false;
  let isBrowserReady = false;
  let bodyScrollLocked = false;
  let lastActiveElement: HTMLElement | null = null;

  // Cleanup handles
  let mobileMql: MediaQueryList | null = null;
  let mobileMqlChangeHandler: ((ev: MediaQueryListEvent) => void) | null = null;
  let resizeHandler: (() => void) | null = null;

  // Placement menu (surfaces L1c-menu) — only touched when `placementMenu`
  // is provided; otherwise stays null/unused. ChatDock only subscribes to
  // read the current placement (for container class derivation); the
  // trigger/popup UI lives in the host-mounted ChatPlacementMenuButton.
  let menuPlacement: ChatPlacement | null = null;
  let placementMenuUnsubscribe: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  $: isSidePanelHost = hostMode === 'sidepanel';

  $: effectiveMode = resolveEffectiveChatWidgetMode({
    hostMode,
    isExtensionOverlayHost,
    isMobileViewport,
    displayMode,
  });


  // (Re)subscribe whenever the placementMenu prop identity changes. When
  // undefined, effectivePlacement below falls back to the legacy bridge —
  // ZERO behavior change from today.
  $: {
    placementMenuUnsubscribe?.();
    placementMenuUnsubscribe = placementMenu
      ? placementMenu.subscribe((current) => {
          menuPlacement = current;
          if (isBrowserReady) publishLayout();
        })
      : null;
    if (!placementMenu) menuPlacement = null;
  }

  // A menu owns placement only in an ordinary desktop overlay. Hosts and the
  // mobile viewport remain authoritative, exactly as in the legacy path.
  $: menuOwnsPlacement = Boolean(placementMenu) && canChatPlacementMenuOwnPlacement({
    hostMode,
    isExtensionOverlayHost,
    isMobileViewport,
  });

  $: effectivePlacement = menuOwnsPlacement
    ? menuPlacement ?? displayModeToPlacement(effectiveMode)
    : displayModeToPlacement(effectiveMode);

  // Keep docking semantics in lockstep with the single ownership decision.
  let _isDocked = false;
  $: _isDocked = menuOwnsPlacement
    ? effectivePlacement.kind === 'drawer'
    : effectiveMode === 'docked';

  $: containerPlacement = placementContainerClasses(effectivePlacement, {
    dialogClass,
    dockWidthCss,
  });

  // Expose derived state for host binding
  export let isOpen: boolean = false;
  $: isOpen = isVisible;

  /** Bindable: true when effectiveMode === 'docked'. */
  export let isDocked: boolean = false;
  $: isDocked = _isDocked;

  /** Bindable: true when the viewport is ≤639px (mobile). */
  export let isMobileViewportBound: boolean = false;
  $: isMobileViewportBound = isMobileViewport;

  // ---------------------------------------------------------------------------
  // Scroll lock
  // ---------------------------------------------------------------------------

  const setBodyScrollLocked = (locked: boolean) => {
    if (typeof document === 'undefined') return;
    if (locked === bodyScrollLocked) return;
    bodyScrollLocked = locked;
    document.body.style.overflow = locked ? 'hidden' : '';
    // iOS: prevent elastic scrolling on background
    document.body.style.touchAction = locked ? 'none' : '';
  };

  const syncScrollLock = () => {
    if (!isBrowserReady) return;
    setBodyScrollLocked(Boolean(isVisible && isMobileViewport));
  };

  // ---------------------------------------------------------------------------
  // Layout publication
  // ---------------------------------------------------------------------------

  const publishLayout = () => {
    // The subscription callback can run before reactive assignments settle;
    // derive ownership from live inputs before reading the menu value.
    const menuOwnsPlacementNow = Boolean(placementMenu)
      && canChatPlacementMenuOwnPlacement({
        hostMode,
        isExtensionOverlayHost,
        isMobileViewport,
      });
    const placementNow = menuOwnsPlacementNow
      ? menuPlacement ?? placementMenu?.current()
      : undefined;
    const modeNow = menuOwnsPlacementNow && placementNow
      ? (placementNow.kind === 'drawer' ? 'docked' : 'floating')
      : resolveEffectiveChatWidgetMode({
          hostMode,
          isExtensionOverlayHost,
          isMobileViewport,
          displayMode,
        });
    chatWidgetLayout.set({
      mode: modeNow,
      isOpen: isVisible,
      dockWidthCss,
    });
  };

  // Republish after reactive ownership or forced-mode changes settle.
  let layoutPublicationKey = '';
  $: layoutPublicationKey = `${menuOwnsPlacement}:${effectiveMode}`;
  $: if (isBrowserReady && layoutPublicationKey) publishLayout();

  const computeDockWidthCssValue = (): string =>
    computeChatWidgetDockWidthCss({
      isBrowser,
      viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
    });

  // ---------------------------------------------------------------------------
  // Focus management (base — overrideable via onDialogKeyDown)
  // ---------------------------------------------------------------------------

  const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(selectors.join(',')),
    );
    return nodes.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  };

  const focusFirstFocusableInDialog = async () => {
    if (!isBrowser) return;
    await tick();
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length > 0) {
      focusables[0].focus();
      return;
    }
    root.focus();
  };

  const handleBaseDialogKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const dispatchDialogKeyDown = (e: KeyboardEvent) => {
    if (onDialogKeyDown) {
      onDialogKeyDown(e);
    } else {
      handleBaseDialogKeyDown(e);
    }
  };

  // ---------------------------------------------------------------------------
  // Open / close (exported so the host can call them)
  // ---------------------------------------------------------------------------

  export const toggle = async () => {
    if (isBrowser)
      lastActiveElement = (document.activeElement as HTMLElement | null) ?? null;
    isVisible = !isVisible;
    if (isVisible) hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    onOpenChange?.(isVisible);
    if (isVisible) void focusFirstFocusableInDialog();
  };

  export const open = async () => {
    if (isVisible) return;
    if (isBrowser)
      lastActiveElement = (document.activeElement as HTMLElement | null) ?? null;
    isVisible = true;
    hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    onOpenChange?.(isVisible);
    await focusFirstFocusableInDialog();
  };

  export const close = () => {
    if (isSidePanelHost) {
      onClose?.();
      return;
    }
    isVisible = false;
    syncScrollLock();
    publishLayout();
    onOpenChange?.(isVisible);
    onClose?.();
    if (isBrowser) {
      void tick().then(() => {
        if (bubbleButtonEl) {
          bubbleButtonEl.focus();
          return;
        }
        lastActiveElement?.focus?.();
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  const onBubbleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggle();
    }
  };

  const globalShortcutHandler = (e: KeyboardEvent) => {
    if (!e.ctrlKey || !e.shiftKey || (e.key !== 'K' && e.key !== 'k')) return;
    if (isVisible) {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      (target as any)?.isContentEditable
    )
      return;
    e.preventDefault();
    void toggle();
  };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    isBrowserReady = true;

    if (isExtensionOverlayHost) {
      displayMode = 'floating';
    }
    if (isSidePanelHost || initialOpen) {
      if (isSidePanelHost) displayMode = 'docked';
      isVisible = true;
      hasOpenedOnce = true;
      onOpenChange?.(true);
    }

    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      mobileMql = window.matchMedia('(max-width: 639px)');
      isMobileViewport = mobileMql.matches;
      mobileMqlChangeHandler = (e: MediaQueryListEvent) => {
        isMobileViewport = e.matches;
        syncScrollLock();
        publishLayout();
      };
      mobileMql.addEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any).addListener?.(mobileMqlChangeHandler);
    }

    dockWidthCss = computeDockWidthCssValue();
    publishLayout();

    resizeHandler = () => {
      dockWidthCss = computeDockWidthCssValue();
      publishLayout();
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('keydown', globalShortcutHandler);

    syncScrollLock();
  });

  onDestroy(() => {
    try {
      if (mobileMqlChangeHandler)
        mobileMql?.removeEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any)?.removeListener?.(mobileMqlChangeHandler);
    } catch {
      // ignore
    }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('keydown', globalShortcutHandler);
    placementMenuUnsubscribe?.();
    setBodyScrollLocked(false);
    publishLayout();
  });
</script>

<div
  class={isSidePanelHost
    ? `chat-dock h-full min-h-0 flex flex-col${containerClass ? ' ' + containerClass : ''}`
    : `chat-dock fixed bottom-4 right-4 z-50${containerClass ? ' ' + containerClass : ''}`}
  style={containerStyle || undefined}
>
  <!-- Bubble trigger (not rendered in sidepanel mode) -->
  {#if !isSidePanelHost}
    {#if renderBubble}
      {@render renderBubble({ toggle, isOpen: isVisible })}
    {:else}
      <!-- Fallback minimal bubble -->
      <button
        class="relative bg-primary hover:bg-primary/90 text-white rounded-full p-3 shadow-lg transition-colors"
        class:opacity-0={isVisible}
        class:pointer-events-none={isVisible}
        on:click={toggle}
        on:keydown={onBubbleKeyDown}
        aria-haspopup="dialog"
        aria-expanded={isVisible}
        aria-controls={dialogId}
        bind:this={bubbleButtonEl}
        type="button"
      >
        <span class="sr-only">Open Chat</span>
      </button>
    {/if}
  {/if}

  {#if hasOpenedOnce}
    <!-- Mobile backdrop -->
    {#if !_isDocked}
      <div
        class="fixed inset-0 z-40 sm:hidden"
        class:hidden={!isVisible}
        aria-hidden="true"
      >
        <button
          type="button"
          class="absolute inset-0 h-full w-full bg-black bg-opacity-40"
          on:click={close}
          tabindex="-1"
          aria-hidden="true"
        ></button>
      </div>
    {/if}

    <!-- Dialog container -->
    <div
      id={dialogId}
      role="dialog"
      aria-label={dialogAriaLabel || undefined}
      aria-modal={_isDocked ? 'false' : 'true'}
      tabindex="-1"
      bind:this={dialogEl}
      on:keydown={dispatchDialogKeyDown}
      class={isSidePanelHost
        ? `chat-dock-shell h-full w-full bg-white flex flex-col${dialogClass ? ' ' + dialogClass : ''}`
        : containerPlacement.className}
      style={isSidePanelHost ? '' : containerPlacement.style}
      class:hidden={!isVisible}
      class:overflow-hidden={!contentOverflowVisible}
      class:overflow-visible={contentOverflowVisible}
    >
      {#if renderContent}
        {@render renderContent({ isDocked: _isDocked, isMobileViewport })}
      {/if}
    </div>
  {/if}
</div>
