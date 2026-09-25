import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Host from './fixtures/ProductionWidgetHarness.svelte';

afterEach(cleanup);

describe('production app → ChatWidget → Pager → AgentsList', () => {
  it('passes nonempty rows, labels, relative dates, active ID and exact interaction arguments', async () => {
    const handleSelectAgentsEntry = vi.fn(), handleAgentsAction = vi.fn();
    const labels = vi.fn((key: string) => `translated:${key}`);
    const formatAgentsRelative = vi.fn((epoch: number) => `age:${epoch}`);
    const agentsRows = [
      { entry: { id: 'session-17', kind: 'session', title: 'First conversation', status: 'active', lastActivityAt: 170 },
        depth: 0, aggregateStatus: 'active', childCount: 0 },
      { entry: { id: 'session-23', kind: 'session', title: null, status: 'active', lastActivityAt: 230 },
        depth: 0, aggregateStatus: 'active', childCount: 0 },
    ];
    const { container, rerender } = render(Host, {
      agentsRows, chatSessionId: 'session-23', agentsView: 'list', labels,
      handleSelectAgentsEntry, handleAgentsAction, formatAgentsRelative,
    });
    expect(screen.getByRole('listbox', { name: 'translated:chat.agents.list.label' })).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('First conversation')).not.toBeNull();
    expect(screen.getByText('translated:chat.agents.kind.session')).not.toBeNull();
    for (const epoch of [170, 230]) {
      expect(screen.getByText(`age:${epoch}`)).not.toBeNull();
      expect(formatAgentsRelative).toHaveBeenCalledWith(epoch);
    }
    expect(labels).toHaveBeenCalledWith('chat.agents.list.label');
    const first = container.querySelector('[data-agent-entry-id="session-17"]')!;
    const second = container.querySelector('[data-agent-entry-id="session-23"]')!;
    expect(first.getAttribute('aria-current')).toBeNull();
    expect(second.getAttribute('aria-current')).toBe('true');
    await fireEvent.click(within(second as HTMLElement).getByRole('option'));
    expect(handleSelectAgentsEntry.mock.calls).toEqual([['session-23']]);
    await fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'translated:chat.agents.actions.trigger' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'translated:chat.agents.action.delete' }));
    expect(handleAgentsAction.mock.calls).toEqual([['session-17', 'delete']]);
    expect(handleSelectAgentsEntry.mock.calls).toEqual([['session-23']]);
    await rerender({ chatSessionId: 'session-17' });
    expect(first.getAttribute('aria-current')).toBe('true');
    expect(second.getAttribute('aria-current')).toBeNull();
    await rerender({ agentsView: 'conversation' });
    expect(screen.queryByRole('listbox')).toBeNull();
    await rerender({ agentsView: 'list' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('age:230')).not.toBeNull();
    expect(container.querySelector('[aria-current="true"]')?.getAttribute('data-agent-entry-id')).toBe('session-17');
  });
});
