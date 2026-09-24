/**
 * ChatWidget header frame — package header slots (L-C-shell S2).
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 * Proves the additive header slots (renderHeaderLeading / renderHeaderActions / headerGrip):
 * order leading → tab bar → actions, the grip pointer contract, and that the DEFAULT path
 * (no slots) still renders the tab bar + purge unchanged (I4 for the package's own consumers).
 * No rename (L-A').
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatWidget from '../src/components/ChatWidget.svelte';

afterEach(cleanup);

const marker = (id: string) =>
  createRawSnippet(() => ({
    render: () => `<span data-testid="${id}">${id}</span>`,
  }));

describe('ChatWidget header frame (S2)', () => {
  it('default (no slots) still renders the tab bar and a purge action (I4)', () => {
    const { container } = render(ChatWidget, {
      props: { activeTab: 'queue', onPurgeJobs: vi.fn(), queueTabLabel: 'Jobs' },
    });
    expect(container.querySelector('nav')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Purge' })).not.toBeNull();
    // No host header slots present by default.
    expect(screen.queryByTestId('lead')).toBeNull();
    expect(screen.queryByTestId('act')).toBeNull();
  });

  it('renders header slots in order: leading → tab bar → actions', () => {
    const { container } = render(ChatWidget, {
      props: {
        activeTab: 'chat',
        chatTabLabel: 'Chat',
        renderHeaderLeading: marker('lead'),
        renderHeaderActions: marker('act'),
      },
    });
    const lead = screen.getByTestId('lead');
    const nav = container.querySelector('nav')!;
    const act = screen.getByTestId('act');
    expect(nav).not.toBeNull();
    // Document order: leading before nav, nav before actions.
    expect(lead.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renderHeaderActions replaces the default purge action', () => {
    render(ChatWidget, {
      props: {
        activeTab: 'queue',
        onPurgeJobs: vi.fn(),
        renderHeaderActions: marker('act'),
      },
    });
    expect(screen.getByTestId('act')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Purge' })).toBeNull();
  });

  it('fires the grip onPointerDown and reflects grip state as data attributes', async () => {
    const onPointerDown = vi.fn();
    const { container } = render(ChatWidget, {
      props: { activeTab: 'chat', headerGrip: { enabled: true, dragging: true, onPointerDown } },
    });
    const header = container.querySelector('header')!;
    expect(header.getAttribute('data-header-grip')).toBe('true');
    expect(header.getAttribute('data-dragging')).toBe('true');
    await fireEvent.pointerDown(header);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
