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
    expect(fixture.executions).toHaveLength(1);
    expect(fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(1);
  });
  it.each([
    ['missing permission adapter', {}],
    ['explicit denial', { authorizeLocalTool: () => false }],
    ['permission timeout', { authorizeLocalTool: () => new Promise<boolean>(() => {}), permissionTimeoutMs: 5 }],
    ['missing executor', { localTools: undefined, authorizeLocalTool: () => true }],
  ] as const)('should deny %s before platform execution', async (_name, options) => {
    const { fixture, streamId } = await start(options);
    request(fixture, streamId);
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.runtime.snapshot().permissions).toEqual([
      { id: `${streamId}:tool-1`, name: 'render_mermaid', status: 'denied' },
    ]);
    expect(fixture.executions).toHaveLength(0);
    const posts = fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'));
    expect(posts.every((entry) => (entry.body as { result: { status: string } }).result.status === 'error')).toBe(true);
  });

  it('should expose pending state and ignore approval arriving after the timeout', async () => {
    let approve!: (allowed: boolean) => void;
    const { fixture, streamId } = await start({
      authorizeLocalTool: () => new Promise<boolean>((resolve) => { approve = resolve; }), permissionTimeoutMs: 20,
    });
    request(fixture, streamId);
    await vi.advanceTimersByTimeAsync(121);
    expect(fixture.runtime.snapshot().permissions[0]?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(30);
    approve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.runtime.snapshot().permissions[0]?.status).toBe('denied');
    expect(fixture.executions).toHaveLength(0);
  });

  it('should execute and post once after explicit host approval, including replayed calls', async () => {
    const { fixture, streamId } = await start({ authorizeLocalTool: () => true });
    request(fixture, streamId);
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.executions).toEqual([{ id: 'tool-1', name: 'render_mermaid', args: {} }]);
    request(fixture, streamId, 5);
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.executions).toHaveLength(1);
    const posts = fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ toolCallId: 'tool-1', result: { rendered: true } });
  });

  it('should cancel pending approval when the host disposes the runtime', async () => {
    let approve!: (allowed: boolean) => void;
    const { fixture, streamId } = await start({ authorizeLocalTool: () => new Promise<boolean>((resolve) => { approve = resolve; }) });
    request(fixture, streamId);
    await vi.advanceTimersByTimeAsync(121);
    fixture.runtime.dispose();
    approve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.executions).toHaveLength(0);
    expect(fixture.requests.filter((entry) => entry.path.endsWith('/tool-results'))).toHaveLength(0);
  });
});
