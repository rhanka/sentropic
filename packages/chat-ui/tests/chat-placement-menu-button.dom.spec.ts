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
import { createChatPlacementMenu } from '../src/state/chatPlacementMenu';

afterEach(() => cleanup());

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
  it('lists exactly 4 items (Right/Left/Center/Full) when opened, current one checked', async () => {
    const menu = createMenu();
    await flushAsync();
    const { container } = render(ChatPlacementMenuButton, { props: { placementMenu: menu } });
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const items = container.querySelectorAll('[role="menuitemradio"]');
    expect(items.length).toBe(4);
    expect(Array.from(items).map((el) => el.textContent?.trim())).toEqual([
      'Right',
      'Left',
      'Center',
      'Full',
    ]);
    const checked = Array.from(items).filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain('Right'); // default placement = floating.right
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
    const fullItem = items.find((el) => el.textContent?.includes('Full')) as HTMLElement;
    await fireEvent.click(fullItem);
    await flushAsync();

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
    // Right (index 0) starts as the roving tabstop (it's the current placement).
    expect(items()[0]?.getAttribute('tabindex')).toBe('0');
    expect(items()[1]?.getAttribute('tabindex')).toBe('-1');

    await fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(items()[0]?.getAttribute('tabindex')).toBe('-1');
    expect(items()[1]?.getAttribute('tabindex')).toBe('0');
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
});
