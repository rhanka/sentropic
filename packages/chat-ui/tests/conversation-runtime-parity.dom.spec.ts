import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const fixture of fixtures.splice(0)) fixture.dispose(); });
async function fixture(options: Parameters<typeof createConversationFixture>[0] = {}) {
  const value = await createConversationFixture(options); fixtures.push(value); return value;
}
async function type(container: HTMLElement, value: string) {
  const input = container.querySelector('[contenteditable]') as HTMLElement;
  input.textContent = value; await fireEvent.input(input); return input;
}

it.each([false, true])('should preserve the complete send payload and markdown stream in app-shaped=%s', async (appShaped) => {
  const host = await fixture({
    contextProvider: { context: { subscribe(run) { run([{ type: 'folder', id: 'f1', label: 'Folder', active: true }]); return () => {}; } } },
    sendPayload: () => ({ tools: ['web_search'], localToolDefinitions: [{ name: 'render_mermaid', description: 'Diagram', parameters: {} }] }),
  });
  const view = render(ConversationView, { runtime: host.runtime, appShaped, features: { attachments: true } });
  await fireEvent.change(view.getByRole('combobox'), { target: { value: 'openai::model-b' } });
  await fireEvent.change(view.getByLabelText('chat.attachments.add'), { target: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] } });
  await waitFor(() => expect(host.runtime.snapshot().attachments).toHaveLength(1));
  await type(view.container, 'Complete payload');
  await fireEvent.click(view.getByRole('button', { name: 'chat.composer.send', exact: true }));
  await waitFor(() => expect(view.getByText('Complete payload')).toBeTruthy());
  await waitFor(() => expect(host.runtime.snapshot().sending).toBe(false));
  const send = host.requests.find((entry) => entry.path === '/chat/messages' && entry.method === 'POST');
  expect(send?.body).toMatchObject({
    content: 'Complete payload', providerId: 'openai', model: 'model-b', sessionId: host.sessionId,
    contexts: [{ contextType: 'folder', contextId: 'f1' }], primaryContextType: 'folder', primaryContextId: 'f1', tools: ['web_search'],
    localToolDefinitions: [{ name: 'render_mermaid', description: 'Diagram', parameters: {} }],
    attachments: [{ kind: 'file', source: 'context_document', fileName: 'notes.txt' }],
  });
  expect(host.runtime.snapshot().draft).toBe('');
  await host.replay();
  await waitFor(() => expect(view.container.querySelector('strong')?.textContent).toBe('markdown'));
  expect(host.runtime.snapshot().error).toBeNull();
});

it('should preserve live progress, draft, attachments and checkpoints across a standalone/app-shaped remount', async () => {
  const host = await fixture();
  const first = render(ConversationView, { runtime: host.runtime });
  await type(first.container, 'First turn');
  await fireEvent.click(first.getByRole('button', { name: 'chat.composer.send', exact: true }));
  await waitFor(() => expect(host.runtime.snapshot().activeStreamId).toBeTruthy());
  const streamId = host.runtime.snapshot().activeStreamId!;
  await type(first.container, 'Unsent draft');
  await host.runtime.commands.attachFiles([new File(['x'], 'retained.txt', { type: 'text/plain' })]);
  host.runtime.session.setCheckpoints([{ id: 'checkpoint-retained' }]);
  first.unmount();
  expect(host.runtime.snapshot().draft).toBe('Unsent draft');
  expect(host.runtime.session.snapshot().viewBindings).toBe(0);
  expect(host.runtime.session.snapshot().disposed).toBe(false);
  host.emit(streamId, 'content_delta', { delta: 'Progress during remount' }, 1);
  const second = render(ConversationView, { runtime: host.runtime, appShaped: true, features: { attachments: true } });
  await waitFor(() => expect(second.getByText('Progress during remount')).toBeTruthy());
  expect(second.container.querySelector('[contenteditable]')?.textContent).toBe('Unsent draft');
  expect(second.getByText('retained.txt')).toBeTruthy();
  expect(host.runtime.session.snapshot().checkpoints).toEqual([{ id: 'checkpoint-retained' }]);
  expect(host.runtime.session.snapshot().attachGeneration).toBe(1);
  expect(host.runtime.session.snapshot().viewBindings).toBe(1);
});

it('should route edit, feedback, retry, stop and steer through the real runtime and HTTP server', async () => {
  const host = await fixture();
  const view = render(ConversationView, { runtime: host.runtime });
  await type(view.container, 'Original');
  await fireEvent.click(view.getByRole('button', { name: 'chat.composer.send', exact: true }));
  await waitFor(() => expect(host.runtime.snapshot().activeMessageId).toBeTruthy());
  const input = await type(view.container, 'Steer note');
  await fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(host.requests.some((entry) => entry.path.endsWith('/steer') && (entry.body as { message: string }).message === 'Steer note')).toBe(true));
  await host.replay();
  await waitFor(() => expect(view.getByRole('button', { name: 'chat.feedback.useful' })).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: 'chat.feedback.useful' }));
  await waitFor(() => expect(host.requests.some((entry) => entry.path.endsWith('/feedback') && (entry.body as { vote: string }).vote === 'up')).toBe(true));
  await fireEvent.click(view.getAllByRole('button', { name: 'chat.message.edit' })[0]);
  await fireEvent.input(view.getByRole('textbox', { name: 'chat.message.edit' }), { target: { value: 'Edited' } });
  await fireEvent.click(view.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(view.getByText('Edited')).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(host.requests.some((entry) => entry.path.endsWith('/retry'))).toBe(true));
  await waitFor(() => expect(view.getByRole('button', { name: 'chat.composer.stop' })).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: 'chat.composer.stop' }));
  await waitFor(() => expect(host.requests.some((entry) => entry.path.endsWith('/stop'))).toBe(true));
  expect(host.runtime.snapshot().error).toBeNull();
});

it('should show denied local permission without executing a platform tool', async () => {
  const host = await fixture();
  const view = render(ConversationView, { runtime: host.runtime });
  await type(view.container, 'Tool request');
  await fireEvent.click(view.getByRole('button', { name: 'chat.composer.send', exact: true }));
  await waitFor(() => expect(host.runtime.snapshot().activeStreamId).toBeTruthy());
  host.emit(host.runtime.snapshot().activeStreamId!, 'tool_call_start', { tool_call_id: 'denied', name: 'render_mermaid', args: '{}' }, 1);
  await waitFor(() => expect(view.getByText('render_mermaid: chat.permission.denied')).toBeTruthy());
  expect(host.executions).toHaveLength(0);
});
