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
  expect(fixture.runtime.snapshot().permissions).toEqual([
    { id: `${streamId}:native`, name: 'render_mermaid', status: allow ? 'approved' : 'denied' },
  ]);
  expect(fixture.executions).toHaveLength(allow ? 1 : 0);
  const results = fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'));
  expect(results).toHaveLength(1);
  expect(results[0].body).toMatchObject({ toolCallId: 'native', result: allow ? { rendered: true } : { status: 'error' } });
});

it('should deny a native permission timeout before execution or a successful result', async () => {
  const fixture = await createConversationFixture({ authorizeLocalTool: () => true, permissionTimeoutMs: 5 }, { nativePermissions: true });
  fixtures.push(fixture); fixture.runtime.commands.setDraft('Native timeout'); await fixture.runtime.commands.send();
  vi.useFakeTimers(); const streamId = fixture.runtime.snapshot().activeStreamId!;
  fixture.emit(streamId, 'tool_call_start', { tool_call_id: 'timeout', name: 'render_mermaid', args: '{}' }, 1);
  await vi.advanceTimersByTimeAsync(200);
  expect(fixture.executions).toHaveLength(0);
  expect(fixture.runtime.snapshot().permissions[0]?.status).toBe('denied');
  expect(fixture.runtime.session.snapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);
  expect(fixture.requests.filter((entry) => entry.path.endsWith('/tool-results')).map((entry) => entry.body))
    .toEqual([{ toolCallId: 'timeout', result: { status: 'error', error: expect.stringContaining('Permission denied') } }]);
});

it('should cancel native permission expiry when the host disposes the runtime', async () => {
  const fixture = await createConversationFixture({ authorizeLocalTool: () => true, permissionTimeoutMs: 20 }, { nativePermissions: true });
  fixtures.push(fixture); fixture.runtime.commands.setDraft('Dispose native'); await fixture.runtime.commands.send();
  vi.useFakeTimers(); const streamId = fixture.runtime.snapshot().activeStreamId!;
  fixture.emit(streamId, 'tool_call_start', { tool_call_id: 'dispose', name: 'render_mermaid', args: '{}' }, 1);
  await vi.advanceTimersByTimeAsync(121); fixture.runtime.dispose(); await vi.advanceTimersByTimeAsync(50);
  expect(fixture.executions).toHaveLength(0);
  expect(fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(0);
});
