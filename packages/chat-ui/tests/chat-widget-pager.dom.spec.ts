import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWidgetPager from '../src/components/ChatWidgetPager.svelte';

afterEach(cleanup);

describe('ChatWidgetPager lifecycle', () => {
  it('destroys the list but retains exactly one conversation and its draft', async () => {
    const mount = vi.fn();
    const destroy = vi.fn();
    const body = createRawSnippet(() => ({
      render: () => '<div><textarea aria-label="Draft"></textarea></div>',
      setup: () => { mount(); return destroy; },
    }));
    const header = createRawSnippet(() => ({
      render: () => '<h2 data-chat-sessions-heading tabindex="-1">Conversation</h2>',
    }));
    const listHeader = createRawSnippet(() => ({ render: () => '<button>All workspaces</button>' }));
    const { container, rerender } = render(ChatWidgetPager, {
      agentsView: 'list', canAgentsListBeDefaultView: true,
      renderChatPanel: body, renderConversationHeader: header,
      renderAgentsListHeader: listHeader,
      agentsList: { rows: [{
        entry: { id: 'pager-session', kind: 'session', title: 'Pager conversation', status: 'active', lastActivityAt: 42 },
        depth: 0, aggregateStatus: 'active', childCount: 0,
      }], onSelect: vi.fn() },
      agentsViewAnnouncement: 'Choose a conversation',
    });
    const list = container.querySelector('section');
    const draft = screen.getByLabelText('Draft') as HTMLTextAreaElement;
    draft.value = 'Keep my draft';
    expect(list).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Pager conversation')).not.toBeNull();
    expect(draft.closest('.hidden')).not.toBeNull();
    expect(screen.getAllByText('Conversation')).toHaveLength(1);
    expect(screen.getAllByText('All workspaces')).toHaveLength(1);
    expect(container.querySelector('[aria-live="polite"][aria-atomic="true"]')?.textContent)
      .toBe('Choose a conversation');
    await rerender({ agentsView: 'conversation', agentsViewAnnouncement: 'Conversation opened' });
    expect(container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText('All workspaces')).toBeNull();
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft.closest('.hidden')).toBeNull();
    expect(draft.value).toBe('Keep my draft');
    expect(container.querySelector('[aria-live]')?.textContent).toBe('Conversation opened');
    await rerender({ agentsView: 'list' });
    expect(container.querySelector('section')).not.toBe(list);
    expect(container.querySelector('section')).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Pager conversation')).not.toBeNull();
    expect(screen.getAllByLabelText('Draft')).toHaveLength(1);
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    await rerender({ canAgentsListBeDefaultView: false });
    expect(container.querySelector('section')).toBeNull();
    expect(draft.closest('.hidden')).toBeNull();
    expect(screen.getByLabelText('Draft')).toBe(draft);
  });
});
