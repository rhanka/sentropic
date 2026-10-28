import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationFixture } from './fixtures/conversationHost.js';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); vi.useRealTimers(); });

async function start(overrides: Parameters<typeof createConversationFixture>[0]) {
  const fixture = await createConversationFixture(overrides);
  fixtures.push(fixture);
  fixture.runtime.commands.setDraft('Run a local tool');
  await fixture.runtime.commands.send();
  expect(fixture.runtime.snapshot().error).toBeNull();
  const streamId = fixture.runtime.snapshot().activeStreamId!;
  expect(streamId).toBeTruthy();
  vi.useFakeTimers();
  return { fixture, streamId };
}

function request(fixture: Awaited<ReturnType<typeof createConversationFixture>>, streamId: string, sequence = 1) {
  fixture.emit(streamId, 'tool_call_start', { tool_call_id: 'tool-1', name: 'render_mermaid', args: '{}' }, sequence);
}

describe('conversation permission boundary through the real runtime and HTTP server', () => {
  it('should execute only after a pending view command is approved by the host adapter', async () => {
    const { fixture, streamId } = await start({ authorizeLocalTool: (call) => call.decision === 'allow' ? true : 'pending' });
    request(fixture, streamId);
    await vi.advanceTimersByTimeAsync(121);
    expect(fixture.executions).toHaveLength(0);
    expect(fixture.runtime.snapshot().permissions[0]?.status).toBe('pending');
    await fixture.runtime.commands.decidePermission(`${streamId}:tool-1`, true);
    await vi.advanceTimersByTimeAsync(1);
