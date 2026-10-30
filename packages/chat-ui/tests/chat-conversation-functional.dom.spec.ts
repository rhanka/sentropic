import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const fixture of fixtures.splice(0)) fixture.dispose(); });

it.each([false, true])('should require an explicit host decision and execute once after allow=%s', async (allow) => {
  const host = await createConversationFixture({
    authorizeLocalTool: (request) => request.decision === 'allow' ? true : 'pending',
  });
  fixtures.push(host);
  const view = render(ConversationView, { runtime: host.runtime });
  host.runtime.commands.setDraft('Request local execution');
  await host.runtime.commands.send();
  const streamId = host.runtime.snapshot().activeStreamId!;
  const emit = (sequence: number) => host.emit(streamId, 'tool_call_start', {
    tool_call_id: 'approval', name: 'render_mermaid', args: '{"diagram":"A-->B"}',
  }, sequence);
  emit(1);
  await waitFor(() => expect(view.getByText('render_mermaid: chat.permission.pending')).toBeTruthy());
  expect(host.executions).toHaveLength(0);
  expect(host.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(0);
  await fireEvent.click(view.getByRole('button', { name: `chat.permission.${allow ? 'allow' : 'deny'}` }));
  await waitFor(() => expect(view.getByText(`render_mermaid: chat.permission.${allow ? 'approved' : 'denied'}`)).toBeTruthy());
  if (allow) {
    await waitFor(() => expect(host.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(1));
    expect(host.executions).toEqual([{ id: 'approval', name: 'render_mermaid', args: { diagram: 'A-->B' } }]);
    emit(5);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(host.executions).toHaveLength(1);
    expect(host.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(1);
  } else {
    expect(host.executions).toHaveLength(0);
    expect(host.requests.filter((entry) => entry.path.endsWith('/tool-results'))
      .every((entry) => (entry.body as { result: { status: string } }).result.status === 'error')).toBe(true);
  }
});
