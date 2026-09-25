import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWidget from '../src/components/ChatWidget.svelte';
import GateHarness from './fixtures/ChatWidgetGateHarness.svelte';

afterEach(cleanup);
const marker = (text: string) => createRawSnippet(() => ({ render: () => `<div>${text}</div>` }));
const composer = (mount = vi.fn(), destroy = vi.fn()) => createRawSnippet(() => ({
  render: () => '<div><textarea aria-label="Composer"></textarea></div>',
  setup: () => { mount(); return destroy; },
}));

describe('ChatWidget assembly', () => {
  it('composes one bar and pager, preserves draft across all routes and suppresses plugin comments', async () => {
    const onActiveTabChange = vi.fn();
    const mount = vi.fn(), destroy = vi.fn();
    const { container, rerender } = render(ChatWidget, {
      renderChatPanel: composer(mount, destroy), renderConversationHeader: marker('Sessions'),
      renderJobsPanel: marker('QueueMonitor host'), renderCommentsPanel: marker('Comments host'),
      renderHeaderLeading: marker('Burger'), renderHeaderActions: marker('Settings'),
      renderAgentsListHeader: marker('Scope'), agentsList: { rows: [{
        entry: { id: 'assembly-session', kind: 'session', title: 'Assembly conversation', status: 'active', lastActivityAt: 42 },
        depth: 0, aggregateStatus: 'active', childCount: 0,
      }], onSelect: vi.fn() },
      canAgentsListBeDefaultView: true, tabBarVariant: 'extension', showJobsBadge: false,
      activeJobsCount: 4, onPurgeJobs: vi.fn(), onActiveTabChange,
    });
    const draft = screen.getByLabelText('Composer') as HTMLTextAreaElement;
    draft.value = 'Unsent';
    const assertPersistentComposer = () => {
      expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
      expect(screen.getByLabelText('Composer')).toBe(draft);
      expect(draft.isConnected).toBe(true);
      expect(draft.value).toBe('Unsent');
      expect(mount).toHaveBeenCalledTimes(1);
      expect(destroy).not.toHaveBeenCalled();
    };
    assertPersistentComposer();
    expect(container.querySelector('.chat-widget-shell')?.tagName).toBe('DIV');
    expect(container.querySelector('.chat-widget-shell')?.hasAttribute('aria-label')).toBe(false);
    const bar = container.querySelector('[data-chat-widget-tab-bar]')!;
    expect(container.querySelectorAll('[data-chat-widget-tab-bar]')).toHaveLength(1);
    expect(screen.getByText('Burger').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(screen.getByText('Settings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('.extension-main-tab')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Jobs' }).textContent?.trim()).toBe('Jobs');
    await fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    assertPersistentComposer();
    expect(screen.getByText('QueueMonitor host')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Purge' })).toBeNull();
    expect(draft.closest('.hidden')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    assertPersistentComposer();
    expect(screen.getByText('Comments host')).not.toBeNull();
    expect(screen.queryByText('QueueMonitor host')).toBeNull();
    expect(draft.closest('.hidden')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    assertPersistentComposer();
    expect(onActiveTabChange.mock.calls).toEqual([['queue'], ['comments'], ['chat']]);
    expect(screen.queryByText('Comments host')).toBeNull();
    expect(draft.closest('.hidden')).toBeNull();
    expect(screen.getByLabelText('Composer')).toBe(draft);
    await rerender({ agentsView: 'list' });
    assertPersistentComposer();
    expect(screen.getByRole('option', { name: /Assembly conversation/ })).not.toBeNull();
    expect(screen.getByText('Scope')).not.toBeNull();
    expect(draft.closest('.hidden')).not.toBeNull();
    await rerender({ agentsView: 'conversation' });
    assertPersistentComposer();
    expect(draft.closest('.hidden')).toBeNull();
    await rerender({ agentsView: 'list' });
    assertPersistentComposer();
    await rerender({ agentsView: 'conversation', activeTab: 'comments', showCommentsTab: false });
    assertPersistentComposer();
    expect(screen.queryByText('Scope')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
    expect(screen.queryByText('Comments host')).toBeNull();
    expect(draft.closest('.hidden')).toBeNull();
    expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
    expect(screen.getByLabelText('Composer')).toBe(draft);
    expect(draft.value).toBe('Unsent');
    expect(screen.getAllByText('Sessions')).toHaveLength(1);
    // No inner clipping ancestor may defeat ChatDock's contentOverflowVisible.
    for (let el: Element | null = screen.getByText('Settings'); el && el !== container; el = el.parentElement) {
      expect(el.classList.contains('overflow-hidden')).toBe(false);
    }
  });

  it('keeps header/tabs outside loading/auth/onboarding and mounts ready exactly once', async () => {
    const mount = vi.fn(), destroy = vi.fn();
    const { container, rerender } = render(GateHarness, { widgetProps: {
      renderHeaderActions: marker('Settings'), renderChatPanel: composer(mount, destroy),
    } });
    for (const [state, message] of [['loading', 'Loading'], ['auth', 'Connect'], ['onboarding', 'Choose workspace']] as const) {
      await rerender({ state });
      expect(screen.getByText(message)).not.toBeNull();
      expect(screen.getByText('Settings')).not.toBeNull();
      expect(container.querySelectorAll('[data-chat-widget-tab-bar]')).toHaveLength(1);
      expect(screen.queryByLabelText('Composer')).toBeNull();
      expect(mount).not.toHaveBeenCalled();
    }
    await rerender({ state: 'ready' });
    expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    await rerender({ state: 'auth' });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Composer')).toBeNull();
    expect(screen.getByText('Settings')).not.toBeNull();
    await rerender({ state: 'ready' });
    expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });
});
