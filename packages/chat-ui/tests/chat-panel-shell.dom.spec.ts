/**
 * chat-panel-shell.dom.spec.ts — functional DOM tests for ChatPanelShell,
 * the gold sentropic panel composition (assembly validation, gold-shell
 * program). Anti-dead-shell: asserts the gold markup actually renders —
 * empty state, user bubble, composer with send button and model selector.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
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

  it('reacts to workspace permission and comment input changes', async () => {
    const commentHost = {
      listComments: async () => ({ items: [] }),
      createComment: async () => ({ id: 'comment-1', thread_id: 'thread-1' }),
      updateComment: async () => ({ success: true }),
      closeComment: async () => ({ success: true }),
      reopenComment: async () => ({ success: true }),
      deleteComment: async () => ({ success: true }),
      listMentionMembers: async () => ({ items: [] }),
      canComment: () => true,
      canResolve: () => false,
      resolveSectionLabel: () => null,
      currentUser: () => null,
      subscribeCommentUpdates: () => () => {},
    } as never;
    const props = {
      mode: 'comments' as const,
      labels: LABELS,
      commentHost,
      workspaceCanComment: false,
      commentContextType: 'initiative',
      commentContextId: 'initiative-1',
    };
    const { container, rerender } = render(ChatPanelShell, {
      props,
    });
    const send = container.querySelector('button[aria-label="common.send"]');
    expect(send).not.toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(true);

    await rerender({ ...props, workspaceCanComment: true });
    const input = container.querySelector('textarea[aria-label="chat.composer.ariaLabel"]');
    expect(input).not.toBeNull();
    await fireEvent.input(input as HTMLTextAreaElement, { target: { value: 'Reply' } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  const assistantItem = {
    kind: 'assistant-segment',
    key: 'as:a1:0',
    message: { id: 'a1', role: 'assistant', content: 'Voici la réponse.', model: null },
    streamId: 'a1',
    segment: { id: 'assistant:1', content: 'Voici la réponse.', events: [] },
    isTerminal: true,
    isLastAssistantSegment: true,
  } as never;

  it('keeps the assistant bubble (card + 85% width) by default', () => {
    const { container } = render(ChatPanelShell, {
      props: {
        mode: 'ai',
        labels: LABELS,
        messagesCount: 1,
        projectedTimelineItems: [assistantItem],
      },
    });
    // Left-aligned assistant wrapper is width-constrained to 85%.
    expect(container.querySelector('.flex.justify-start .max-w-\\[85\\%\\]')).not.toBeNull();
    // Final content keeps the bubble card chrome.
    const card = container.querySelector('.chatMarkdown');
    expect(card?.className).toContain('border-slate-200');
  });

  it('renders the assistant full-width with no card when assistantLayout=plain', () => {
    const { container } = render(ChatPanelShell, {
      props: {
        mode: 'ai',
        labels: LABELS,
        assistantLayout: 'plain',
        messagesCount: 1,
        projectedTimelineItems: [assistantItem],
      },
    });
    // No 85% width constraint on the assistant wrapper.
    expect(container.querySelector('.flex.justify-start .max-w-\\[85\\%\\]')).toBeNull();
    expect(container.querySelector('.flex.justify-start .max-w-none')).not.toBeNull();
    // Final content drops the card chrome.
    const card = container.querySelector('.chatMarkdown');
    expect(card).not.toBeNull();
    expect(card?.className).not.toContain('border-slate-200');
    expect(card?.className).not.toContain('bg-white');
  });
});
