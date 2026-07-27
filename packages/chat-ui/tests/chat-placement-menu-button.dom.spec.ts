/**
 * chat-placement-menu-button.dom.spec.ts — DOM/ARIA tests for
 * ChatPlacementMenuButton, the "Move to…" placement menu affordance
 * (surfaces L1c-menu).
 *
 * Extracted from ChatDock's former `absolute top-2 right-2 z-10` overlay,
 * which collided with host header controls (e2e 03-chat.spec.ts:396 — the
 * overlay sat on top of the app's own Close button). This component is now
 * meant to be mounted by the HOST inside its own toolbar as a normal in-flow
 * element; ChatDock itself renders no trigger/popup UI (see
 * chat-dock.dom.spec.ts for the container-class-only proof).
 *
 * These tests are the moved+adapted equivalent of the former
 * "ChatDock — placement menu affordance (provided)" and
 * "ChatDock — no dead menu in sidepanel mode" suites, now exercising the
 * component directly instead of through ChatDock's removed overlay.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatPlacementMenuButton from '../src/components/ChatPlacementMenuButton.svelte';
import ChatPlacementDropZones from '../src/components/ChatPlacementDropZones.svelte';
import { createChatPlacementMenu } from '../src/state/chatPlacementMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

const createMenu = () =>
  createChatPlacementMenu({
    userId: 'u1',
    hostId: 'h1',
    workspace: 'w1',
    storage: createMemoryStorage(),
  });

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

describe('ChatPlacementMenuButton — trigger', () => {
  it('renders the trigger with menu semantics', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-label')).toBe('Move chat to…');
    expect(trigger?.getAttribute('title')).toBe('Move chat to…');
  });

  it('applies the passed class prop to the trigger (host styling passthrough)', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, {
      props: { placementMenu: menu, class: 'my-host-class' },
    });
    const trigger = container.querySelector('[aria-haspopup="menu"]');
    expect(trigger?.classList.contains('my-host-class')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opening the popup
// ---------------------------------------------------------------------------

describe('ChatPlacementMenuButton — popup contents', () => {
  it('renders MODE and SIDE groups separated by a real separator when opened', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const groups = container.querySelectorAll('[role="group"]');
    expect(groups).toHaveLength(2);
    expect(Array.from(groups).map((group) => group.getAttribute('aria-label'))).toEqual(['Mode', 'Side']);
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(Array.from(groups[0]?.querySelectorAll('[role="menuitemradio"]') ?? []).map((el) => el.textContent?.trim())).toEqual([
      'Panel',
      'Floating',
      'Full screen',
    ]);
    expect(Array.from(groups[1]?.querySelectorAll('[role="menuitemradio"]') ?? []).map((el) => el.textContent?.trim())).toEqual([
      'Right',
      'Center',
      'Left',
    ]);
    expect(groups[0]?.querySelector('[aria-checked="true"]')?.textContent).toContain('Floating');
    expect(groups[1]?.querySelector('[aria-checked="true"]')?.textContent).toContain('Right');
  });

  it('renders only the MODE group in full screen', async () => {
    const menu = createMenu();
    await menu.request({ kind: 'full' });
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);

    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Mode');
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
  });

  it('updates rendered checkmarks and removes Centre after a Panel mode transition', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

    await fireEvent.click(trigger);
    const panel = Array.from(container.querySelectorAll('[role="menuitemradio"]')).find(
      (item) => item.textContent?.includes('Panel'),
    ) as HTMLElement;
    await fireEvent.click(panel);
    await flushAsync();

    await fireEvent.click(trigger);
    const sideItems = Array.from(
      container.querySelectorAll('[role="group"]:nth-of-type(3) [role="menuitemradio"]'),
    );
    expect(sideItems.map((item) => item.textContent?.trim())).toEqual(['Right', 'Left']);
    expect(container.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain('Panel');
    expect(Array.from(container.querySelectorAll('[role="menuitemradio"]')).some(
      (item) => item.textContent?.includes('Center'),
    )).toBe(false);

    const left = sideItems.find((item) => item.textContent?.includes('Left')) as HTMLElement;
    await fireEvent.click(left);
    await flushAsync();
    await fireEvent.click(trigger);
    expect(container.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain('Panel');
    expect(Array.from(container.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).some(
      (item) => item.textContent?.includes('Left'),
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe('ChatPlacementMenuButton — activation', () => {
  it('activating an item calls placementMenu.request with the item placement', async () => {
    const menu = createMenu();
    await flushAsync();
    const requestSpy = vi.spyOn(menu, 'request');
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);

    const items = Array.from(container.querySelectorAll('[role="menuitemradio"]'));
    const fullItem = items.find((el) => el.textContent?.includes('Full screen')) as HTMLElement;
    await fireEvent.click(fullItem);
    await flushAsync();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith({ kind: 'full' });
    expect(menu.current()).toEqual({ kind: 'full' });
    // Selecting an item closes the popup.
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('calls onPlacementChange with the settled placement after selection', async () => {
    const menu = createMenu();
    const onPlacementChange = vi.fn();
    const { container } = render(ChatPlacementMenuButton, {
      props: { placementMenu: menu, onPlacementChange },
    });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);

    const centerItem = Array.from(container.querySelectorAll('[role="menuitemradio"]')).find(
      (el) => el.textContent?.includes('Center'),
    ) as HTMLElement;
    await fireEvent.click(centerItem);
    await flushAsync();

    expect(onPlacementChange).toHaveBeenCalledTimes(1);
    expect(onPlacementChange).toHaveBeenCalledWith({ kind: 'floating', anchor: 'center' });
  });

  it('a pointerdown on a menu item does NOT get swallowed by outside-click dismissal (still selects)', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);
    const items = Array.from(container.querySelectorAll('[role="menuitemradio"]'));
    const fullItem = items.find((el) => el.textContent?.includes('Full')) as HTMLElement;

    await fireEvent.pointerDown(fullItem);
    await fireEvent.click(fullItem);
    await flushAsync();

    expect(menu.current()).toEqual({ kind: 'full' });
  });
});

// ---------------------------------------------------------------------------
// Keyboard / a11y (code review F1: Escape/Arrow must not bubble)
// ---------------------------------------------------------------------------

describe('ChatPlacementMenuButton — keyboard (code review F1)', () => {
  it('Escape closes the popup, returns focus to the trigger, and does NOT bubble to an ancestor keydown handler', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });

    // Reproduces the F1 guard AT THE NEW COMPONENT BOUNDARY: previously the
    // guard kept Escape from reaching ChatDock's own dialog keydown handler
    // (which would have closed the whole dock). Now that the trigger/popup
    // moved out of ChatDock into this standalone component, the equivalent
    // contract is "Escape never bubbles past this component's own root" —
    // whatever ancestor element the HOST wraps it in (a toolbar, a dialog,
    // anything) must never see it. `container` (the testing-library mount
    // point) is a real DOM ancestor of the component's rendered root, so a
    // listener attached there faithfully stands in for that host ancestor.
    const ancestorKeyDown = vi.fn();
    container.addEventListener('keydown', ancestorKeyDown);

    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const list = container.querySelector('[role="menu"]') as HTMLElement;
    await fireEvent.keyDown(list, { key: 'Escape' });

    // (a) the popup is gone.
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    // (b) the ancestor keydown handler was never reached — stopPropagation
    // held at the component boundary.
    expect(ancestorKeyDown).not.toHaveBeenCalled();

    // (c) focus returns to the trigger.
    expect(document.activeElement).toBe(trigger);
  });

  it('roving focus: ArrowDown moves tabindex=0 to the next item, without bubbling to an ancestor', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const ancestorKeyDown = vi.fn();
    container.addEventListener('keydown', ancestorKeyDown);

    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);

    const list = container.querySelector('[role="menu"]') as HTMLElement;
    const items = () => Array.from(container.querySelectorAll('[role="menuitemradio"]'));
    // Floating (index 1) starts as the roving tabstop because it is the active mode.
    expect(items()[0]?.getAttribute('tabindex')).toBe('-1');
    expect(items()[1]?.getAttribute('tabindex')).toBe('0');

    await fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(items()[1]?.getAttribute('tabindex')).toBe('-1');
    expect(items()[2]?.getAttribute('tabindex')).toBe('0');
    expect(ancestorKeyDown).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Outside-click dismissal (code review F5)
// ---------------------------------------------------------------------------

describe('ChatPlacementMenuButton — outside-click dismissal (code review F5)', () => {
  it('a pointerdown outside the trigger+popup closes the popup', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    await fireEvent.pointerDown(document.body);

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('adds one outside-pointer listener while open and removes it when closed', async () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const menu = createMenu();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

    await fireEvent.click(trigger);
    expect(addListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    await fireEvent.click(trigger);
    expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  });
});

describe('ChatPlacementMenuButton — drag lifecycle', () => {
  it('cancels an active drag on Escape without committing an end callback', async () => {
    const dragCallbacks = { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const { container } = render(ChatPlacementMenuButton, {
      props: { placementMenu: createMenu(), dragCallbacks },
    });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

    await fireEvent.pointerDown(trigger, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(trigger, { pointerId: 7, clientX: 20, clientY: 10 });
    expect(dragCallbacks.start).toHaveBeenCalledOnce();
    expect(dragCallbacks.move).toHaveBeenCalledOnce();

    await fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(dragCallbacks.cancel).toHaveBeenCalledOnce();
    await fireEvent.pointerUp(trigger, { pointerId: 7, clientX: 20, clientY: 10 });
    expect(dragCallbacks.end).not.toHaveBeenCalled();
  });

  it('starts only after the movement threshold and ends exactly once', async () => {
    const dragCallbacks = { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const { container } = render(ChatPlacementMenuButton, {
      props: { placementMenu: createMenu(), dragCallbacks },
    });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

    await fireEvent.pointerDown(trigger, { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(trigger, { pointerId: 8, clientX: 14, clientY: 10 });
    expect(dragCallbacks.start).not.toHaveBeenCalled();
    await fireEvent.pointerMove(trigger, { pointerId: 8, clientX: 20, clientY: 10 });
    await fireEvent.pointerUp(trigger, { pointerId: 8, clientX: 20, clientY: 10 });
    expect(dragCallbacks.start).toHaveBeenCalledOnce();
    expect(dragCallbacks.end).toHaveBeenCalledOnce();
    expect(dragCallbacks.cancel).not.toHaveBeenCalled();
  });
});

describe('ChatPlacementDropZones', () => {
  it('renders host-computed destinations and highlights the hovered placement', () => {
    const left = { kind: 'drawer', side: 'left', occupancy: 'primary' } as const;
    const { container, getByText } = render(ChatPlacementDropZones, {
      props: {
        zones: [{ placement: left, rect: { x: 0, y: 0, width: 200, height: 600 } }],
        hovered: left,
        labelForPlacement: () => 'Panel Left',
      },
    });

    expect(container.querySelector('[data-chat-placement-drop-zones]')).not.toBeNull();
    // `toHaveClass` is a jest-dom matcher and is NOT registered in this vitest
    // setup; use the classList idiom already used throughout this suite.
    expect(getByText('Panel Left').classList.contains('bg-primary/20')).toBe(true);
    const overlay = container.querySelector('[data-chat-placement-drop-zones]') as HTMLElement;
    expect(overlay.classList.contains('pointer-events-none')).toBe(true);
    expect(getByText('Panel Left').classList.contains('motion-reduce:transition-none')).toBe(true);
  });
});
