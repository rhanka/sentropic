import { afterEach, expect, it, vi } from 'vitest';
import { createConversationFixture } from './fixtures/conversationHost.js';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); vi.useRealTimers(); });

it.each([false, true])('should settle native allow=%s without false approval or duplicate execution/results', async (allow) => {
  const fixture = await createConversationFixture({ authorizeLocalTool: () => true }, { nativePermissions: true });
  fixtures.push(fixture);
  fixture.runtime.commands.setDraft('Native tool'); await fixture.runtime.commands.send(); vi.useFakeTimers();
  const streamId = fixture.runtime.snapshot().activeStreamId!;
  const request = (sequence: number) => fixture.emit(streamId, 'tool_call_start', { tool_call_id: 'native', name: 'render_mermaid', args: '{}' }, sequence);
  request(1); await vi.advanceTimersByTimeAsync(121);
  expect(fixture.runtime.snapshot().permissions).toEqual([{ id: `native:${streamId}:native`, name: 'render_mermaid', status: 'pending' }]);
  expect(fixture.executions).toHaveLength(0);
  await fixture.runtime.commands.decidePermission(`native:${streamId}:native`, allow);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.runtime.snapshot().permissions[0]?.status).toBe(allow ? 'approved' : 'denied');
  expect(fixture.executions).toHaveLength(allow ? 1 : 0);
  request(5); await vi.advanceTimersByTimeAsync(200);
  expect(fixture.executions).toHaveLength(allow ? 1 : 0);
  const results = fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'));
  expect(results).toHaveLength(1);
  expect(results[0].body).toMatchObject({ toolCallId: 'native', result: allow ? { rendered: true } : { status: 'error' } });
});
