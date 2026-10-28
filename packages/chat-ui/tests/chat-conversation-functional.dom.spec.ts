import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const fixture of fixtures.splice(0)) fixture.dispose(); });

    const { container } = render(ChatConversation, { props: { host } });
    expect(container.querySelector('.chat-composer-footer')).not.toBeNull();
  });

  it('should disable send button when no sessionId', () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, { props: { host } });
    const btn = container.querySelector('.chat-conversation-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
