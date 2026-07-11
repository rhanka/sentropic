/**
 * chat-panel-shell.dom.spec.ts — functional DOM tests for ChatPanelShell,
 * the gold sentropic panel composition (assembly validation, gold-shell
 * program). Anti-dead-shell: asserts the gold markup actually renders —
 * empty state, user bubble, composer with send button and model selector.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ChatPanelShell from '../src/components/ChatPanelShell.svelte';

afterEach(cleanup);

const LABELS = (key: string) => key;

const userItem = {
  kind: 'message',
  key: 'm:u1',
  message: { id: 'u1', role: 'user', content: 'Bonjour **gras**', sequence: 1 },
} as never;

describe('ChatPanelShell (gold shell assembly)', () => {
  it('renders the gold empty state in AI mode', () => {
    const { container, getByText } = render(ChatPanelShell, {
      props: { mode: 'ai', labels: LABELS, messagesCount: 0 },
    });
    expect(container.querySelector('.topai-chat-panel-shell')).not.toBeNull();
    getByText('chat.chat.empty');
  });

  it('renders the loading state while hydration is in flight with no items', () => {
    const { getByText } = render(ChatPanelShell, {
      props: {
        mode: 'ai',
        labels: LABELS,
        historyHydrationInFlight: true,
        projectedTimelineItems: [],
      },
    });
    getByText('common.loading');
  });

  it('renders a user message as the gold primary bubble', () => {
    const { container } = render(ChatPanelShell, {
      props: {
        mode: 'ai',
        labels: LABELS,
        messagesCount: 1,
        projectedTimelineItems: [userItem],
      },
    });
    const bubble = container.querySelector('.chat-user-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.className).toContain('bg-primary');
    expect(bubble?.textContent).toContain('Bonjour');
  });

  it('renders the composer with the compact icon send button and model selector', () => {
    const { container } = render(ChatPanelShell, {
      props: { mode: 'ai', labels: LABELS, primaryDisabled: true },
    });
    const send = container.querySelector('[data-testid="chat-composer-send-button"]');
    expect(send).not.toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('select')).not.toBeNull();
  });

  it('switches the primary button to steer mode', () => {
    const { container } = render(ChatPanelShell, {
      props: { mode: 'ai', labels: LABELS, primaryShowsSteer: true },
    });
    expect(
      container.querySelector('[data-testid="chat-composer-steer-button"]'),
    ).not.toBeNull();
  });

  it('renders the error banner when errorMsg is set', () => {
    const { getByText } = render(ChatPanelShell, {
      props: { mode: 'ai', labels: LABELS, errorMsg: 'HTTP 502: Unknown error' },
    });
    getByText('HTTP 502: Unknown error');
  });
});
