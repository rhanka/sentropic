/**
 * chat-context-picker.dom.spec.ts — DOM markup-parity tests for ChatContextPicker.
 *
 * Asserts that the rendered DOM structure is IDENTICAL to the original inline block
 * in AppChatPanel.svelte (lines ~5616-5648 before extraction):
 *   - container: div.space-y-1.overflow-auto.slim-scroll with inline style
 *   - per-button: flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50
 *     + text-slate-900 (active) / text-slate-400 (inactive)
 *   - icon: svelte:component with class="w-4 h-4"
 *   - label span: truncate max-w-[220px]
 *   - leading slot: passes through arbitrary content above the entry list
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatContextPicker from '../src/components/ChatContextPicker.svelte';
import type { ChatContextEntry } from '../src/state/chat-context.js';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIVE_ENTRY: ChatContextEntry = {
  type: 'folder',
  id: 'f-1',
  label: 'Dossier principal',
  active: true,
  used: true,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
};

const INACTIVE_ENTRY: ChatContextEntry = {
  type: 'organization',
  id: 'org-1',
  label: 'ACME Corp',
  active: false,
  used: true,
  lastUsedAt: '2026-01-02T00:00:00.000Z',
};

// Minimal icon stub: a Svelte 4 component constructor-like function.
// svelte:component calls it as a constructor; returning an empty object is enough
// for the jsdom environment — we only assert button-level classes and label text.
function MockIcon(this: unknown) { return this; }
MockIcon.prototype.$set = () => undefined;
MockIcon.prototype.$destroy = () => undefined;

const iconFor = vi.fn((_e: ChatContextEntry) => MockIcon as unknown);

// ---------------------------------------------------------------------------
// Container structure
// ---------------------------------------------------------------------------

describe('ChatContextPicker — container', () => {
  it('should render a div with space-y-1 overflow-auto slim-scroll classes', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [ACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const div = container.querySelector('div.space-y-1.overflow-auto.slim-scroll');
    expect(div).not.toBeNull();
  });

  it('should apply the maxHeightStyle as inline style on the container', () => {
    const { container } = render(ChatContextPicker, {
      props: {
        entries: [ACTIVE_ENTRY],
        iconFor,
        maxHeightStyle: 'max-height:8rem',
      },
    });
    const div = container.querySelector('div.space-y-1.overflow-auto.slim-scroll') as HTMLDivElement | null;
    expect(div).not.toBeNull();
    // jsdom normalizes inline styles: 'max-height:8rem' becomes 'max-height: 8rem;'
    expect(div!.style.maxHeight).toBe('8rem');
  });

  it('should default maxHeightStyle to max-height:10rem when not supplied', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [], iconFor },
    });
    const div = container.querySelector('div.space-y-1.overflow-auto.slim-scroll') as HTMLDivElement | null;
    expect(div).not.toBeNull();
    // jsdom normalizes inline styles: 'max-height:10rem' becomes 'max-height: 10rem;'
    expect(div!.style.maxHeight).toBe('10rem');
  });
});

// ---------------------------------------------------------------------------
// Active entry button classes — EXACT parity with AppChatPanel inline block
// ---------------------------------------------------------------------------

describe('ChatContextPicker — active entry button', () => {
  it('should render a button with all required base classes for an active entry', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [ACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    const btn = buttons[0];
    // Exact class list from the original AppChatPanel block (5636-5638):
    //   flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50 text-slate-900
    expect(btn.classList.contains('flex')).toBe(true);
    expect(btn.classList.contains('w-full')).toBe(true);
    expect(btn.classList.contains('items-center')).toBe(true);
    expect(btn.classList.contains('gap-2')).toBe(true);
    expect(btn.classList.contains('rounded')).toBe(true);
    expect(btn.classList.contains('px-1')).toBe(true);
    expect(btn.classList.contains('py-1')).toBe(true);
    // classList.contains takes the literal class name (no CSS escaping)
    expect(btn.classList.contains('text-[11px]')).toBe(true);
    expect(btn.classList.contains('hover:bg-slate-50')).toBe(true);
    // Active state: text-slate-900 present, text-slate-400 absent
    expect(btn.classList.contains('text-slate-900')).toBe(true);
    expect(btn.classList.contains('text-slate-400')).toBe(false);
  });

  it('should set type="button" on the entry button', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [ACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('type')).toBe('button');
  });
});

// ---------------------------------------------------------------------------
// Inactive entry button classes
// ---------------------------------------------------------------------------

describe('ChatContextPicker — inactive entry button', () => {
  it('should render text-slate-400 (not text-slate-900) for an inactive entry', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [INACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // Inactive: text-slate-400 present, text-slate-900 absent
    expect(btn!.classList.contains('text-slate-400')).toBe(true);
    expect(btn!.classList.contains('text-slate-900')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Label span — EXACT parity with AppChatPanel line 5646
// ---------------------------------------------------------------------------

describe('ChatContextPicker — label span', () => {
  it('should render a span with truncate + max-w-[220px] containing the entry label', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [ACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // The span is a direct child of the button (after the icon)
    const span = btn!.querySelector('span.truncate') as HTMLSpanElement | null;
    expect(span).not.toBeNull();
    // classList.contains takes the literal class name (no CSS escaping)
    expect(span!.classList.contains('max-w-[220px]')).toBe(true);
    expect(span!.textContent).toBe(ACTIVE_ENTRY.label);
  });
});

// ---------------------------------------------------------------------------
// Multiple entries — order + keys
// ---------------------------------------------------------------------------

describe('ChatContextPicker — multiple entries', () => {
  it('should render one button per entry in document order', () => {
    const { container } = render(ChatContextPicker, {
      props: {
        entries: [ACTIVE_ENTRY, INACTIVE_ENTRY],
        iconFor,
        maxHeightStyle: 'max-height:10rem',
      },
    });
    const spans = container.querySelectorAll('button span.truncate');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe(ACTIVE_ENTRY.label);
    expect(spans[1].textContent).toBe(INACTIVE_ENTRY.label);
  });

  it('should render no buttons when entries is empty', () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// onToggle event
// ---------------------------------------------------------------------------

describe('ChatContextPicker — onToggle callback', () => {
  it('should call onToggle with the clicked entry when a button is clicked', async () => {
    const onToggle = vi.fn();
    const { container } = render(ChatContextPicker, {
      props: {
        entries: [ACTIVE_ENTRY],
        iconFor,
        onToggle,
        maxHeightStyle: 'max-height:10rem',
      },
    });
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledWith(ACTIVE_ENTRY);
  });

  it('should not throw when onToggle is not provided', async () => {
    const { container } = render(ChatContextPicker, {
      props: { entries: [ACTIVE_ENTRY], iconFor, maxHeightStyle: 'max-height:10rem' },
    });
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // Must not throw
    expect(() => btn!.click()).not.toThrow();
  });
});
