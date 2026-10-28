import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const host of fixtures.splice(0)) host.dispose(); });

it.each([false, true])('should preserve or restore the checkpoint before retry, restore=%s', async (restore) => {
  const host = await createConversationFixture(); fixtures.push(host);
  host.runtime.commands.setDraft('Checkpoint turn'); await host.runtime.commands.send();
  await host.restart();
  expect(host.runtime.snapshot().error).toBeNull();
  const assistant = host.runtime.session.snapshot().messages.find((message) => message.role === 'assistant')!;
  host.runtime.session.mergeHistoryEvents(assistant.id, [
    { eventType: 'tool_call_start', sequence: 100, data: { tool_call_id: 'mutate', name: 'record_update', args: '{}' } },
    { eventType: 'tool_call_result', sequence: 101, data: { tool_call_id: 'mutate', result: { updated: true } } },
  ]);
  const first = render(ConversationView, { runtime: host.runtime, appShaped: !restore });
  await fireEvent.click(first.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(first.getByRole('dialog')).toBeTruthy());
  expect(host.requests.some((request) => request.path.endsWith('/retry'))).toBe(false);
  first.unmount();
  const second = render(ConversationView, { runtime: host.runtime, appShaped: restore });
  expect(second.getByRole('dialog')).toBeTruthy();
  await fireEvent.click(second.getByRole('button', { name: restore ? 'chat.checkpoints.restoreCta' : 'chat.checkpoints.retryWithoutRestore' }));
  await waitFor(() => expect(host.requests.some((request) => request.path.endsWith('/retry'))).toBe(true));
  const actions = host.requests.filter((request) => /\/(restore|retry)$/.test(request.path));
  expect(actions.map((request) => request.path.split('/').at(-1))).toEqual(restore ? ['restore', 'retry'] : ['retry']);
  expect(host.runtime.snapshot().checkpointPrompt).toBeNull();
  expect(host.runtime.snapshot().error).toBeNull();
});
