/**
 * BR14b Lot 15.5 — direct unit tests for the 5 in-memory port adapters.
 * Targets full coverage on adapter behaviours that are not exercised by
 * the ChatRuntime suites (session list ordering, scriptable mesh
 * dispatch, stream buffer active listing, etc.).
 */
import { describe, expect, it } from 'vitest';

import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
} from '../src/in-memory/index.js';

describe('InMemorySessionStore', () => {
  it('lists sessions for user, optionally scoped by workspaceId', async () => {
    const store = new InMemorySessionStore();
    await store.create({ userId: 'u1', workspaceId: 'w1', title: 'a' });
    await store.create({ userId: 'u1', workspaceId: 'w2', title: 'b' });
    await store.create({ userId: 'u2', workspaceId: 'w1', title: 'other' });

    const all = await store.listForUser('u1');
    expect(all).toHaveLength(2);

    const scoped = await store.listForUser('u1', 'w2');
    expect(scoped).toHaveLength(1);
    expect(scoped[0].workspaceId).toBe('w2');

    // Trims whitespace and treats empty string as no scope.
    const emptyScope = await store.listForUser('u1', '   ');
    expect(emptyScope).toHaveLength(2);
  });

  it('deletes session only for owning user', async () => {
    const store = new InMemorySessionStore();
    const { sessionId } = await store.create({ userId: 'u1' });
    await store.deleteForUser(sessionId, 'other');
    expect(await store.findForUser(sessionId, 'u1')).not.toBeNull();
    await store.deleteForUser(sessionId, 'u1');
    expect(await store.findForUser(sessionId, 'u1')).toBeNull();
  });

  it('updates context, title and refreshes updatedAt', async () => {
    const store = new InMemorySessionStore();
    const { sessionId } = await store.create({ userId: 'u1' });
    const before = await store.findForUser(sessionId, 'u1');
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.updateContext(sessionId, {
      primaryContextType: 'organization',
      primaryContextId: 'org-1',
    });
    const middle = await store.findForUser(sessionId, 'u1');
    expect(middle?.primaryContextType).toBe('organization');
    expect(middle?.primaryContextId).toBe('org-1');
    expect(middle?.updatedAt).not.toEqual(before?.updatedAt);

    await store.updateTitle(sessionId, 'Renamed');
    const after = await store.findForUser(sessionId, 'u1');
    expect(after?.title).toBe('Renamed');
  });

  it('snapshot returns defensive copies', async () => {
    const store = new InMemorySessionStore();
    await store.create({ userId: 'u1', title: 'a' });
    const snapshot = store.snapshot();
    snapshot[0].title = 'mutated';
    const fresh = await store.listForUser('u1');
    expect(fresh[0].title).toBe('a');
  });
});

describe('InMemoryStreamBuffer', () => {
  it('generates predictable stream ids by priority', () => {
    const buffer = new InMemoryStreamBuffer();
    expect(buffer.generateStreamId(undefined, undefined, 'msg-1')).toBe('msg-1');
    expect(buffer.generateStreamId(undefined, 'job-1')).toBe('job_job-1');
    expect(buffer.generateStreamId('prompt-1')).toMatch(/^prompt_prompt-1_/);
    expect(buffer.generateStreamId()).toMatch(/^stream_mem-/);
  });

  it('reads events ordered by sequence with optional sinceSequence + limit', async () => {
    const buffer = new InMemoryStreamBuffer();
    await buffer.append('s1', 'content_delta', { delta: 'a' }, 1);
    await buffer.append('s1', 'content_delta', { delta: 'b' }, 2);
    await buffer.append('s1', 'content_delta', { delta: 'c' }, 3);

    expect((await buffer.read('s1')).map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(
      (await buffer.read('s1', { sinceSequence: 1 })).map((event) => event.sequence),
    ).toEqual([2, 3]);
    expect((await buffer.read('s1', { limit: 2 })).map((event) => event.sequence)).toEqual([
      1, 2,
    ]);
  });

  it('throws on duplicate sequence (mirrors 23505 conflict)', async () => {
    const buffer = new InMemoryStreamBuffer();
    await buffer.append('s1', 'content_delta', { delta: 'a' }, 1);
    await expect(
      buffer.append('s1', 'content_delta', { delta: 'b' }, 1),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('appendWithSequenceRetry allocates next sequence atomically by default', async () => {
    const buffer = new InMemoryStreamBuffer();
    const seq1 = await buffer.appendWithSequenceRetry('s1', 'status', { state: 'started' });
    const seq2 = await buffer.appendWithSequenceRetry('s1', 'content_delta', {
      delta: 'x',
    });
    expect([seq1, seq2]).toEqual([1, 2]);
  });

  it('appendWithSequenceRetry honors injected deps', async () => {
    const buffer = new InMemoryStreamBuffer();
    let calls = 0;
    const getNextSequenceFn = async () => {
      calls += 1;
      return calls;
    };
    const writeStreamEventFn = async (
      streamId: string,
      eventType: 'content_delta' | 'done' | 'error' | 'reasoning_delta' | 'status' | 'tool_call_delta' | 'tool_call_result' | 'tool_call_start',
      data: unknown,
      sequence: number,
    ) => {
      return buffer.append(streamId, eventType, data, sequence, null);
    };
    const seq = await buffer.appendWithSequenceRetry('s1', 'status', { state: 'started' }, {
      deps: { getNextSequenceFn, writeStreamEventFn },
    });
    expect(seq).toBe(1);
    expect(calls).toBe(1);
  });

  it('listActive returns streams with started but not done events', async () => {
    const buffer = new InMemoryStreamBuffer();
    await buffer.append('s1', 'status', { state: 'started' }, 1);
    await buffer.append('s2', 'status', { state: 'started' }, 1);
    await buffer.append('s2', 'done', {}, 2);
    const active = await buffer.listActive();
    expect(active).toEqual(['s1']);
  });
});

describe('InMemoryCheckpointStore', () => {
  it('lists by prefix, newest first', async () => {
    const store = new InMemoryCheckpointStore<{ marker: string }>();
    await store.save('sess1#a', { marker: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.save('sess1#b', { marker: 'b' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.save('sess2#c', { marker: 'c' });

    const sess1 = await store.list('sess1');
    expect(sess1.map((meta) => meta.key)).toEqual(['sess1#b', 'sess1#a']);

    const sess2 = await store.list('sess2');
    expect(sess2.map((meta) => meta.key)).toEqual(['sess2#c']);
  });

  it('returns empty without a prefix', async () => {
    const store = new InMemoryCheckpointStore<unknown>();
    await store.save('a#b', 'state');
    expect(await store.list()).toEqual([]);
  });

  it('versions increment on save and delete removes the entry', async () => {
    const store = new InMemoryCheckpointStore<unknown>();
    const first = await store.save('s#a', 'v1');
    const second = await store.save('s#a', 'v2');
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await store.delete('s#a');
    expect(await store.load('s#a')).toBeNull();
  });
});

describe('InMemoryMeshDispatch', () => {
  it('returns enqueued invoke responses FIFO and records calls', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueInvoke({ raw: { id: 'r1' } });
    mesh.enqueueInvoke({ raw: { id: 'r2' } });
    const first = await mesh.invoke({ messages: [] });
    const second = await mesh.invoke({ messages: [] });
    expect(first.raw).toEqual({ id: 'r1' });
    expect(second.raw).toEqual({ id: 'r2' });
    expect(mesh.invokeCalls).toHaveLength(2);
  });

  it('throws when no invoke response is enqueued', async () => {
    const mesh = new InMemoryMeshDispatch();
    await expect(mesh.invoke({ messages: [] })).rejects.toThrow(
      'no enqueued invoke response',
    );
  });

  it('yields enqueued stream events in order', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'a' } },
      { type: 'done', data: {} },
    ]);
    const collected: string[] = [];
    for await (const event of mesh.invokeStream({ messages: [] })) {
      collected.push(event.type);
    }
    expect(collected).toEqual(['content_delta', 'done']);
  });

  it('reset clears every queue and call log', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueInvoke({ raw: {} });
    mesh.enqueueStream([{ type: 'done', data: {} }]);
    await mesh.invoke({ messages: [] });
    mesh.reset();
    expect(mesh.invokeCalls).toEqual([]);
    expect(mesh.streamCalls).toEqual([]);
    await expect(mesh.invoke({ messages: [] })).rejects.toThrow();
  });
});

describe('InMemoryMessageStore', () => {
  it('returns next sequence and supports listForSession ordering', async () => {
    const store = new InMemoryMessageStore();
    store.seedSession('s1', 'u1');
    expect(await store.getNextSequence('s1')).toBe(1);
    await store.insertMany([
      {
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: 'b',
        sequence: 2,
        createdAt: new Date(),
      },
      {
        id: 'm1',
        sessionId: 's1',
        role: 'user',
        content: 'a',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    expect(await store.getNextSequence('s1')).toBe(3);
    const rows = await store.listForSession('s1');
    expect(rows.map((row) => row.id)).toEqual(['m1', 'm2']);
  });

  it('snapshot returns defensive copies, reset wipes state', async () => {
    const store = new InMemoryMessageStore();
    store.seedSession('s1', 'u1');
    await store.insertMany([
      {
        id: 'm1',
        sessionId: 's1',
        role: 'user',
        content: 'a',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    const snapshot = store.snapshot();
    snapshot[0].content = 'tampered';
    expect((await store.findById('m1'))?.content).toBe('a');
    store.reset();
    expect(await store.listForSession('s1')).toEqual([]);
  });
});
