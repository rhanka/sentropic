/**
 * chat-dock.dom.spec.ts — DOM/ARIA tests for ChatDock generic dock surface.
 *
 * Tests:
 * - Default (floating) mode: outer container has fixed positioning classes
 * - Slot: renderContent snippet is rendered inside the dialog
 * - open/close: dialog hidden when closed, visible when open
 * - Mobile-sheet: in docked mode the dialog uses the correct CSS classes
 * - Props: contentOverflowVisible toggles overflow-visible on dialog
 * - containerClass / dialogClass: extra classes are applied to correct elements
 * - dialogId: dialog id attribute matches the provided value
 * - placementMenu: ChatDock derives ONLY the dialog container's placement
 *   class from `placementMenu.current()` — it renders no trigger/popup UI
 *   (that affordance lives in ChatPlacementMenuButton, see
 *   chat-placement-menu-button.dom.spec.ts, mounted by the HOST separately).
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ChatDock from '../src/components/ChatDock.svelte';
import { createChatPlacementMenu } from '../src/state/chatPlacementMenu';
import { placementContainerClasses } from '../src/state/chatPlacementClasses';
import { chatWidgetLayout } from '../src/stores/chatWidgetLayout';

const chatDockSourcePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/components/ChatDock.svelte',
);

let mobileViewport = false;
const mobileViewportChangeListeners = new Set<
  (event: MediaQueryListEvent) => void
>();

const setMobileViewport = (matches: boolean) => {
  mobileViewport = matches;
  const event = { matches } as MediaQueryListEvent;
  for (const listener of mobileViewportChangeListeners) listener(event);
};

// jsdom does not implement window.matchMedia — provide a controllable stub so
// forced-mobile behavior can be exercised during component mounting.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return query === '(max-width: 639px)' && mobileViewport;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof listener === 'function') {
          mobileViewportChangeListeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof listener === 'function') {
          mobileViewportChangeListeners.delete(listener as (event: MediaQueryListEvent) => void);
        }
      }),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  mobileViewport = false;
  mobileViewportChangeListeners.clear();
  chatWidgetLayout.set({ mode: 'floating', isOpen: false, dockWidthCss: '0px' });
});

// ---------------------------------------------------------------------------
// Helper: render ChatDock with common test props
// ---------------------------------------------------------------------------

const renderDock = (
  props: Record<string, unknown> = {},
  content?: string,
) => {
  return render(ChatDock, {
    props: {
      isBrowser: false,
      ...props,
    },
  });
};

// ---------------------------------------------------------------------------
// Outer container structure
// ---------------------------------------------------------------------------

describe('ChatDock — outer container', () => {
  it('should render the outer container div', () => {
    const { container } = renderDock();
    const root = container.querySelector('.chat-dock');
    expect(root).not.toBeNull();
  });

  it('should apply containerClass to the outer div', () => {
    const { container } = renderDock({ containerClass: 'my-custom-root' });
    const root = container.querySelector('.chat-dock');
    expect(root?.classList.contains('my-custom-root')).toBe(true);
  });

  it('should have fixed positioning classes in floating mode (non-sidepanel)', () => {
    const { container } = renderDock({ displayMode: 'floating', hostMode: 'overlay' });
    const root = container.querySelector('.chat-dock');
    expect(root?.className).toContain('fixed');
  });

  it('should have h-full layout classes in sidepanel mode', () => {
    const { container } = renderDock({ hostMode: 'sidepanel' });
    const root = container.querySelector('.chat-dock');
    expect(root?.className).toContain('h-full');
    expect(root?.className).not.toContain('fixed');
  });
});

// ---------------------------------------------------------------------------
// Dialog container visibility
// ---------------------------------------------------------------------------

describe('ChatDock — dialog visibility', () => {
  it('should NOT render the dialog until hasOpenedOnce (closed by default)', () => {
    const { container } = renderDock();
    // Dialog only renders after first open (lazy mount)
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it('should render dialog as hidden when initialOpen is false and isSidePanelHost is false', () => {
    // With isBrowser:false, onMount won't fire in jsdom, so initialOpen=false keeps it closed
    const { container } = renderDock({ initialOpen: false });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dialog classes and attributes
// ---------------------------------------------------------------------------

describe('ChatDock — dialog attributes', () => {
  it('should apply dialogClass to the dialog container element', () => {
    // Open the dock first by using sidepanel mode (always open)
    const { container } = renderDock({
      hostMode: 'sidepanel',
      dialogClass: 'topai-chat-widget-shell',
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains('topai-chat-widget-shell')).toBe(true);
  });

  it('should apply custom dialogId to the dialog container', () => {
    const { container } = renderDock({
      hostMode: 'sidepanel',
      dialogId: 'chat-widget-dialog',
    });
    const dialog = container.querySelector('#chat-widget-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
  });

  it('should apply aria-label to the dialog when dialogAriaLabel is provided', () => {
    const { container } = renderDock({
      hostMode: 'sidepanel',
      dialogAriaLabel: 'Chat',
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Chat');
  });
});

// ---------------------------------------------------------------------------
// Overflow visibility
// ---------------------------------------------------------------------------

describe('ChatDock — contentOverflowVisible', () => {
  it('should apply overflow-hidden by default', () => {
    const { container } = renderDock({ hostMode: 'sidepanel' });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.classList.contains('overflow-hidden')).toBe(true);
    expect(dialog?.classList.contains('overflow-visible')).toBe(false);
  });

  it('should apply overflow-visible when contentOverflowVisible is true', () => {
    const { container } = renderDock({
      hostMode: 'sidepanel',
      contentOverflowVisible: true,
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.classList.contains('overflow-visible')).toBe(true);
    expect(dialog?.classList.contains('overflow-hidden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Docked mode — dialog positioning
// ---------------------------------------------------------------------------

describe('ChatDock — docked mode dialog classes', () => {
  it('should apply docked fixed positioning classes in docked mode', () => {
    const { container } = renderDock({
      hostMode: 'sidepanel',
    });
    const dialog = container.querySelector('.chat-dock-shell');
    expect(dialog).not.toBeNull();
    // Sidepanel: h-full w-full
    expect(dialog?.className).toContain('h-full');
    expect(dialog?.className).toContain('w-full');
  });
});

// ---------------------------------------------------------------------------
// Sidepanel: no bubble button
// ---------------------------------------------------------------------------

describe('ChatDock — sidepanel mode', () => {
  it('should NOT render the bubble button area in sidepanel mode', () => {
    const { container } = renderDock({ hostMode: 'sidepanel' });
    // The fallback bubble button would have class relative rounded-full
    // In sidepanel mode the bubble section is not rendered at all
    const bubble = container.querySelector('button[aria-haspopup="dialog"]');
    expect(bubble).toBeNull();
  });

  it('should open automatically in sidepanel mode', () => {
    const { container } = renderDock({ hostMode: 'sidepanel' });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains('hidden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default slot content
// ---------------------------------------------------------------------------

describe('ChatDock — default slot', () => {
  it('should not crash when no renderContent or slot provided', () => {
    expect(() => renderDock({ hostMode: 'sidepanel' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Effective-mode ownership (faithful dogfooding moved from gold ui ChatWidget)
// ---------------------------------------------------------------------------

describe('ChatDock — effective-mode resolution ownership', () => {
  it('resolves docked/floating mode via resolveEffectiveChatWidgetMode', () => {
    const source = readFileSync(chatDockSourcePath, 'utf8');
    // ChatDock owns docked/floating effective-mode resolution (moved here from
    // the gold ui ChatWidget when the dock chrome was extracted). It must import
    // and call the shared resolveEffectiveChatWidgetMode helper.
    expect(source).toContain('resolveEffectiveChatWidgetMode');
    expect(source).toContain("from '../state/chatWidgetShell");
  });
});

// ---------------------------------------------------------------------------
// Placement menu affordance (surfaces L1c-menu)
// ---------------------------------------------------------------------------

/** In-memory Storage stand-in — deterministic, isolated per test. */
const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

const flushAsync = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ChatDock — placement menu affordance (default-off)', () => {
  it('does NOT render the "Move to…" trigger when placementMenu is undefined', () => {
    const { container } = renderDock({ hostMode: 'sidepanel' });
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it('leaves the dialog container class identical to the pre-branch legacy rendering', () => {
    // Comparing "prop omitted" with "prop explicitly undefined" proves nothing:
    // both take the same code path by construction, so that assertion holds
    // even if the legacy rendering changes. Freeze the ACTUAL pre-branch class
    // strings instead — this fails the moment the menu-less path is altered.
    const { container } = renderDock({
      displayMode: 'floating',
      hostMode: 'overlay',
      initialOpen: true,
      isBrowser: false,
    });
    const className = container.querySelector('[role="dialog"]')?.className ?? '';
    // Legacy floating resolves to floating.right, which stays anchored inside
    // the host's bottom-4/right-4 container via `sm:absolute`.
    expect(className).toContain('sm:absolute');
    expect(className).toContain('sm:bottom-0');
    expect(className).toContain('sm:right-0');
    expect(className).not.toContain('sm:fixed');
    expect(className).not.toContain('sm:right-4');
  });

  it('publishes no drawer side on the legacy path', () => {
    // The published payload must stay exactly what hosts saw before this
    // branch: a menu-less dock never emits the new `drawerSide` field.
    let published: Record<string, unknown> | null = null;
    const unsubscribe = chatWidgetLayout.subscribe((layout) => {
      published = layout as unknown as Record<string, unknown>;
    });
    renderDock({ displayMode: 'floating', hostMode: 'overlay', initialOpen: true, isBrowser: true });
    expect(published).not.toBeNull();
    expect(published?.drawerSide).toBeUndefined();
    unsubscribe();
  });
});

describe('ChatDock — menu/legacy coexistence', () => {
  // Regression guard for the coexistence divergence: when a menu is provided,
  // dock semantics (aria-modal + backdrop) MUST follow the menu's effective
  // placement, NOT the legacy displayMode. Here displayMode is 'floating' but
  // the menu commits a drawer placement — the dialog must therefore be
  // non-modal with no backdrop. Under the pre-fix `_isDocked = effectiveMode
  // === 'docked'` derivation this FAILS (floating displayMode ⇒ modal+backdrop
  // over a drawer). Non-vacuous: it fixes only when _isDocked is menu-driven.
  it('drives docked semantics from a drawer menu even when legacy displayMode is floating', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const { container } = renderDock({
      displayMode: 'floating', hostMode: 'overlay', initialOpen: true, placementMenu: menu,
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('right-0');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(container.querySelector('.fixed.inset-0.z-40')).toBeNull();
  });

  it('uses a legacy-docked menu seed for both drawer placement and docked semantics', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const { container } = renderDock({
      displayMode: 'docked', hostMode: 'overlay', initialOpen: true, placementMenu: menu,
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('right-0');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(container.querySelector('.fixed.inset-0.z-40')).toBeNull();
  });

  it('tracks drawer/floating menu transitions in both placement and docked semantics', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const { container } = renderDock({ initialOpen: true, placementMenu: menu });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    await menu.request({ kind: 'floating', anchor: 'right' });
    await flushAsync();
    // floating.right keeps the legacy container-anchored positioning.
    expect(dialog.className).toContain('sm:absolute');
    expect(dialog.className).toContain('sm:right-0');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.fixed.inset-0.z-40')).not.toBeNull();
  });

  it('makes a Move selection from legacy docked state floating without changing its placement', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const { container } = renderDock({ initialOpen: true, placementMenu: menu });
    await menu.request({ kind: 'floating', anchor: 'left' });
    await flushAsync();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('sm:fixed');
    expect(dialog.className).toContain('sm:left-4');
    expect(dialog.className).not.toContain('sm:absolute');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('keeps sidepanel forced-docked semantics when a supplied menu prefers floating', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'floating', anchor: 'left' },
    });
    const { container } = renderDock({ hostMode: 'sidepanel', placementMenu: menu });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.className).toContain('h-full');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(container.querySelector('.fixed.inset-0.z-40')).toBeNull();
  });

  it('keeps extension-overlay forced-floating semantics when a supplied menu prefers a drawer', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const { container } = renderDock({
      displayMode: 'docked', initialOpen: true, isExtensionOverlayHost: true, placementMenu: menu,
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.className).toContain('sm:right-0');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.fixed.inset-0.z-40')).not.toBeNull();
  });

  it('keeps mobile forced-docked semantics when a supplied menu prefers floating', async () => {
    mobileViewport = true;
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'floating', anchor: 'left' },
    });
    const { container } = renderDock({ initialOpen: true, placementMenu: menu });
    await flushAsync();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.className).toContain('top-0');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(container.querySelector('.fixed.inset-0.z-40')).toBeNull();
  });

  it('publishes the menu-owned layout mode after a placement change', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'right', occupancy: 'primary' },
    });
    const published: Array<{ mode: string; isOpen: boolean; dockWidthCss: string }> = [];
    const unsubscribe = chatWidgetLayout.subscribe((layout) => published.push(layout));
    renderDock({ initialOpen: true, placementMenu: menu });
    await flushAsync();
    expect(published.at(-1)).toMatchObject({ mode: 'docked', isOpen: true });

    await menu.request({ kind: 'floating', anchor: 'center' });
    await flushAsync();
    expect(published.at(-1)).toMatchObject({ mode: 'floating', isOpen: true });
    unsubscribe();
  });

  it('publishes the active drawer side from the same menu-owned placement', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'drawer', side: 'left', occupancy: 'primary' },
    });
    const published: Array<{ mode: string; drawerSide?: string }> = [];
    const unsubscribe = chatWidgetLayout.subscribe((layout) => published.push(layout));
    renderDock({ initialOpen: true, placementMenu: menu });
    await flushAsync();
    expect(published.at(-1)).toMatchObject({ mode: 'docked', drawerSide: 'left' });

    await menu.request({ kind: 'drawer', side: 'right', occupancy: 'primary' });
    await flushAsync();
    expect(published.at(-1)).toMatchObject({ mode: 'docked', drawerSide: 'right' });
    unsubscribe();
  });

  it('publishes docked layout on an initial mobile mount even when the menu prefers floating', async () => {
    mobileViewport = true;
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'floating', anchor: 'right' },
    });
    const published: Array<{ mode: string; isOpen: boolean; dockWidthCss: string }> = [];
    const unsubscribe = chatWidgetLayout.subscribe((layout) => published.push(layout));

    renderDock({ isBrowser: true, initialOpen: true, placementMenu: menu });
    await flushAsync();

    expect(published.at(-1)).toMatchObject({ mode: 'docked', isOpen: true });
    unsubscribe();
  });

  it('republishes docked layout when the viewport crosses from desktop to mobile', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1', hostId: 'h1', workspace: 'w1', storage: createMemoryStorage(),
      defaultPlacement: { kind: 'floating', anchor: 'right' },
    });
    const published: Array<{ mode: string; isOpen: boolean; dockWidthCss: string }> = [];
    const unsubscribe = chatWidgetLayout.subscribe((layout) => published.push(layout));

    renderDock({ isBrowser: true, initialOpen: true, placementMenu: menu });
    await flushAsync();
    expect(published.at(-1)).toMatchObject({ mode: 'floating', isOpen: true });

    setMobileViewport(true);
    await flushAsync();

    expect(published.at(-1)).toMatchObject({ mode: 'docked', isOpen: true });
    unsubscribe();
  });
});

describe('ChatDock — container placement driven by placementMenu (provided)', () => {
  it('renders no "Move to…" trigger/popup even when placementMenu is provided — that UI lives in ChatPlacementMenuButton', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    const { container } = renderDock({ hostMode: 'overlay', initialOpen: true, placementMenu: menu });
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('renders no trigger in sidepanel mode either (code review F4 — no dead menu in sidepanel)', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    const { container } = renderDock({ hostMode: 'sidepanel', placementMenu: menu });
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it("dialog container className === placementContainerClasses(placementMenu.current()) and updates when the menu's current changes", async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    const { container } = renderDock({
      hostMode: 'overlay',
      initialOpen: true,
      placementMenu: menu,
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    const classNameBefore = dialog.className;

    // Non-tautological proof, WITHOUT a trigger inside ChatDock (there is
    // none anymore): drive the headless menu model directly — exactly what
    // a real ChatPlacementMenuButton click would do under the hood — and
    // assert ChatDock's container class tracks placementContainerClasses(
    // current), not the legacy displayMode bridge.
    await menu.request({ kind: 'full' });
    await flushAsync();

    expect(menu.current()).toEqual({ kind: 'full' });
    expect(dialog.className).not.toBe(classNameBefore);
    const expected = placementContainerClasses({ kind: 'full' }, { dockWidthCss: '0px' }).className;
    const actualTokens = new Set(dialog.className.split(/\s+/).filter(Boolean));
    const expectedTokens = new Set([...expected.split(/\s+/), 'overflow-hidden']);
    expect(actualTokens).toEqual(expectedTokens);
  });
});
