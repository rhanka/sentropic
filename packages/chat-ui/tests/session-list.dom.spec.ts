/**
 * session-list.dom.spec.ts — DOM/ARIA tests for @sentropic/chat-ui SessionList.
 *
 * Tests: renders session entries, active highlight (aria-current), onSelect fires
 * with correct sessionId, onDelete fires and suppresses propagation, empty-state
 * rendering, untitled-session label fallback, and ARIA structure.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom, BR-A0b-EX1).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SessionList from '../src/components/SessionList.svelte';
import type { SessionListEntry } from '../src/state/sessionList.js';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSIONS: SessionListEntry[] = [
  { id: 'session-1', title: 'First session', lastActivity: 1_000_000 },
  { id: 'session-2', title: 'Second session', lastActivity: 2_000_000 },
  { id: 'session-3', title: null, lastActivity: 3_000_000 },
];

// ---------------------------------------------------------------------------
// Render — basic structure
// ---------------------------------------------------------------------------

describe('SessionList — basic render', () => {
  it('should render a <nav> element with the list aria-label', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        labels: (key: string) => (key === 'chat.session.list.label' ? 'Sessions' : key),
        onSelect: vi.fn(),
      },
    });
    const nav = container.querySelector('nav.chat-session-list');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('Sessions');
  });

  it('should render one button per session', () => {
    render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    // Each session row has a select button
    const buttons = screen.getAllByRole('button');
    // 3 select buttons (no delete buttons since onDelete not provided)
    expect(buttons.length).toBe(3);
  });

  it('should render session titles in the buttons', () => {
    render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    expect(screen.getByText('First session')).not.toBeNull();
    expect(screen.getByText('Second session')).not.toBeNull();
  });

  it('should render the untitled fallback label for sessions with null title', () => {
    render(SessionList, {
      props: {
        sessions: SESSIONS,
        labels: (key: string) =>
          key === 'chat.session.untitled' ? '(untitled)' : key,
        onSelect: vi.fn(),
      },
    });
    expect(screen.getByText('(untitled)')).not.toBeNull();
  });

  it('should fall back to the label key itself when no resolver is provided', () => {
    render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    // The untitled session (session-3) should show the key
    expect(screen.getByText('chat.session.untitled')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('SessionList — empty state', () => {
  it('should render an empty-state element when sessions is empty', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: [],
        labels: (key: string) =>
          key === 'chat.session.list.empty' ? 'No sessions yet' : key,
        onSelect: vi.fn(),
      },
    });
    const empty = container.querySelector('.chat-session-list-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No sessions yet');
  });

  it('should NOT render a list when sessions is empty', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: [],
        onSelect: vi.fn(),
      },
    });
    const list = container.querySelector('ul');
    expect(list).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Active highlight
// ---------------------------------------------------------------------------

describe('SessionList — active highlight', () => {
  it('should apply chat-session-list-item-active class to the active session row', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        activeId: 'session-1',
        onSelect: vi.fn(),
      },
    });
    const items = container.querySelectorAll('.chat-session-list-item');
    expect(items[0]?.classList.contains('chat-session-list-item-active')).toBe(true);
    expect(items[1]?.classList.contains('chat-session-list-item-active')).toBe(false);
    expect(items[2]?.classList.contains('chat-session-list-item-active')).toBe(false);
  });

  it('should set aria-current="page" on the active session list item', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        activeId: 'session-2',
        onSelect: vi.fn(),
      },
    });
    const items = container.querySelectorAll('li[role="listitem"]');
    expect(items[0]?.getAttribute('aria-current')).toBeNull();
    expect(items[1]?.getAttribute('aria-current')).toBe('page');
    expect(items[2]?.getAttribute('aria-current')).toBeNull();
  });

  it('should NOT set aria-current when no activeId is provided', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    const items = container.querySelectorAll('li[role="listitem"]');
    for (const item of Array.from(items)) {
      expect(item.getAttribute('aria-current')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// onSelect callback
// ---------------------------------------------------------------------------

describe('SessionList — onSelect', () => {
  it('should call onSelect with the sessionId when a session button is clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect,
      },
    });
    const buttons = container.querySelectorAll('button.chat-session-list-select');
    await fireEvent.click(buttons[1]!);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('session-2');
  });

  it('should call onSelect with the correct id for the first session', async () => {
    const onSelect = vi.fn();
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect,
      },
    });
    const buttons = container.querySelectorAll('button.chat-session-list-select');
    await fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith('session-1');
  });
});

// ---------------------------------------------------------------------------
// onDelete callback (optional)
// ---------------------------------------------------------------------------

describe('SessionList — onDelete', () => {
  it('should NOT render delete buttons when onDelete is not provided', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    const deleteButtons = container.querySelectorAll('button.chat-session-list-delete');
    expect(deleteButtons.length).toBe(0);
  });

  it('should render delete buttons for each session when onDelete is provided', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    const deleteButtons = container.querySelectorAll('button.chat-session-list-delete');
    expect(deleteButtons.length).toBe(3);
  });

  it('should call onDelete with the sessionId when delete button is clicked', async () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect,
        onDelete,
      },
    });
    const deleteButtons = container.querySelectorAll('button.chat-session-list-delete');
    await fireEvent.click(deleteButtons[2]!);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith('session-3');
  });

  it('should NOT call onSelect when delete button is clicked (stopPropagation)', async () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect,
        onDelete,
      },
    });
    const deleteButtons = container.querySelectorAll('button.chat-session-list-delete');
    await fireEvent.click(deleteButtons[0]!);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should expose a delete button aria-label via labels resolver', () => {
    render(SessionList, {
      props: {
        sessions: [SESSIONS[0]!],
        onSelect: vi.fn(),
        onDelete: vi.fn(),
        labels: (key: string) =>
          key === 'chat.session.delete.label' ? 'Delete session' : key,
      },
    });
    const deleteBtn = screen.getByRole('button', { name: 'Delete session' });
    expect(deleteBtn).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ARIA structure
// ---------------------------------------------------------------------------

describe('SessionList — ARIA structure', () => {
  it('should expose a navigation landmark', () => {
    render(SessionList, {
      props: {
        sessions: SESSIONS,
        labels: (key: string) => (key === 'chat.session.list.label' ? 'Sessions' : key),
        onSelect: vi.fn(),
      },
    });
    const nav = screen.getByRole('navigation', { name: 'Sessions' });
    expect(nav).not.toBeNull();
  });

  it('should expose a list role for the session list', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    const list = container.querySelector('ul[role="list"]');
    expect(list).not.toBeNull();
  });

  it('should expose listitem roles for each session row', () => {
    const { container } = render(SessionList, {
      props: {
        sessions: SESSIONS,
        onSelect: vi.fn(),
      },
    });
    const items = container.querySelectorAll('li[role="listitem"]');
    expect(items.length).toBe(3);
  });
});
