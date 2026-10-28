import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const host of fixtures.splice(0)) host.dispose(); });

it.each([false, true])('should retain failed uploads across remount, retry, preview and remove in app-shaped=%s', async (appShaped) => {
  const host = await createConversationFixture(); fixtures.push(host); host.failNextUpload();
  const first = render(ConversationView, { runtime: host.runtime, appShaped, features: { attachments: true } });
  await fireEvent.change(first.getByLabelText('chat.attachments.add'), {
    target: { files: [new File(['image'], 'preview.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(first.getByRole('alert').textContent).toContain('Upload failed'));
  expect(host.runtime.snapshot().attachments[0]?.status).toBe('failed');
  first.unmount();
  const second = render(ConversationView, { runtime: host.runtime, appShaped: !appShaped, features: { attachments: true } });
  await fireEvent.click(second.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(host.runtime.snapshot().attachments[0]?.status).toBe('ready'));
  expect(host.uploads).toEqual(['preview.png', 'preview.png']);
  await fireEvent.click(second.getByRole('button', { name: 'common.enlarge' }));
  expect(second.getByTestId('chat-image-lightbox')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(second.queryByTestId('chat-image-lightbox')).toBeNull());
  await fireEvent.click(second.getByRole('button', { name: 'common.remove' }));
  await waitFor(() => expect(host.runtime.snapshot().attachments).toHaveLength(0));
  expect(host.docs.size).toBe(0);
});

it('should hydrate real history and render/download generated documents after runtime restart', async () => {
  const host = await createConversationFixture(); fixtures.push(host);
  host.runtime.commands.setDraft('History survives'); await host.runtime.commands.send();
  await host.restart();
  expect(host.runtime.snapshot().error).toBeNull();
  expect(host.runtime.session.snapshot().messages.map((message) => message.content)).toContain('History survives');
  const view = render(ConversationView, { runtime: host.runtime, appShaped: true, features: { documents: true } });
  expect(view.getByText('History survives')).toBeTruthy();
  await waitFor(() => expect(view.container.querySelector('strong')?.textContent).toBe('markdown'));
  const message = host.runtime.session.snapshot().messages.find((entry) => entry.role === 'assistant')!;
  host.runtime.session.mergeHistoryEvents(message.id, [
    { eventType: 'tool_call_start', sequence: 100, data: { tool_call_id: 'doc', name: 'document_generate' } },
    { eventType: 'tool_call_result', sequence: 101, data: { tool_call_id: 'doc', result: {
      status: 'completed', jobId: 'generated', fileName: 'report.docx', downloadUrl: 'http://chat.test/documents/generated/content',
    } } },
  ]);
  await waitFor(() => expect(view.getByText('report.docx')).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: 'common.download' }));
  await waitFor(() => expect(host.requests.some((entry) => entry.path === '/documents/generated/content' && entry.method === 'GET')).toBe(true));
  expect(host.runtime.snapshot().error).toBeNull();
});
