import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import { createCommentFixture } from '../../chat-runtime/tests/fixtures/commentHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const disposables: Array<{ dispose(): void }> = [];
afterEach(() => { cleanup(); for (const value of disposables.splice(0)) value.dispose(); });

it.each([false, true])('should use the real optional comment runtime and retain its draft in app-shaped=%s', async (appShaped) => {
  const host = await createConversationFixture(); const comments = await createCommentFixture();
  disposables.push(host, comments);
  const first = render(ConversationView, { runtime: host.runtime, appShaped, commentModule: comments, features: { comments: true } });
  const input = first.getByRole('textbox', { name: 'chat.composer.ariaLabel' });
  await fireEvent.input(input, { target: { value: 'Comment draft' } });
  first.unmount();
  expect(comments.listeners.size).toBe(1);
  const second = render(ConversationView, { runtime: host.runtime, appShaped: !appShaped, commentModule: comments, features: { comments: true } });
  expect(second.getByRole('textbox', { name: 'chat.composer.ariaLabel' })).toHaveProperty('value', 'Comment draft');
  await fireEvent.click(second.getByRole('button', { name: 'common.send' }));
  await waitFor(() => expect([...comments.items.values()].map((item) => item.content)).toEqual(['Comment draft']));
  await waitFor(() => expect(second.getByText('Comment draft')).toBeTruthy());
  comments.dispose();
  expect(comments.listeners.size).toBe(0);
});
