import { describe, expect, it } from 'vitest';

import {
  CollectingCommentEventSink,
  InMemoryCommentStore,
  toEventEnvelope,
  type CommentEventType,
  type NewComment,
} from '../src/index.js';

const tenant = { tenantId: 'tnt_1', workspaceId: 'wsp_1', userId: 'usr_1' };

function makeStore() {
  const sink = new CollectingCommentEventSink();
  const store = new InMemoryCommentStore({ sink });
  return { store, sink };
}

const baseInput = (overrides: Partial<NewComment> = {}): NewComment => ({
  tenant,
  target: { kind: 'message', id: 'msg_1' },
  author: { id: 'usr_1', kind: 'human' },
  body: 'body',
  ...overrides,
});

describe('wire events', () => {
  it('emits the right CommentEvent type for every mutation', async () => {
    const { store, sink } = makeStore();

    const root = await store.add(tenant, baseInput());
    await store.edit(tenant, root.id, { body: 'edited' });
    await store.setState(tenant, root.threadId, 'resolved');
    await store.setState(tenant, root.threadId, 'open');
    await store.assign(tenant, root.threadId, 'usr_owner');
    await store.delete(tenant, root.id);

    const types = sink.events.map((event) => event.type);
    const expected: CommentEventType[] = [
      'created',
      'updated',
      'resolved',
      'reopened',
      'reassigned',
      'deleted',
    ];
    expect(types).toEqual(expected);

    for (const event of sink.events) {
      expect(event.commentId).toBeTruthy();
      expect(event.threadId).toBe(root.threadId);
      expect(event.target).toEqual({ kind: 'message', id: 'msg_1' });
      expect(event.tenant).toEqual(tenant);
    }
  });

  it('carries the assignee payload on reassigned events', async () => {
    const { store, sink } = makeStore();
    const root = await store.add(tenant, baseInput());
    sink.clear();

    await store.assign(tenant, root.threadId, 'usr_owner');
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0].type).toBe('reassigned');
    expect(sink.events[0].data).toMatchObject({
      assignee: 'usr_owner',
      threadId: root.threadId,
    });

    sink.clear();
    await store.assign(tenant, root.threadId, null);
    expect(sink.events[0].data).toMatchObject({ assignee: null });
  });

  it('emits no event on read operations', async () => {
    const { store, sink } = makeStore();
    const root = await store.add(tenant, baseInput());
    sink.clear();

    await store.get(tenant, root.id);
    await store.listByTarget(tenant, { kind: 'message', id: 'msg_1' });
    await store.listThread(tenant, root.threadId);
    await store.listThreadSummaries(tenant, { kind: 'message', id: 'msg_1' });

    expect(sink.events).toHaveLength(0);
  });

  it('emits one updated event per row for an atomic thread edit', async () => {
    const { store, sink } = makeStore();
    const root = await store.add(tenant, baseInput({ body: 'root' }));
    await store.add(tenant, baseInput({ threadId: root.threadId, body: 'reply' }));
    sink.clear();

    await store.editThread(tenant, root.threadId, {
      content: 'shared update',
      assignedTo: 'usr_owner',
    });
    expect(sink.events.map((event) => event.type)).toEqual(['updated', 'updated']);
    expect(sink.events.every((event) => event.threadId === root.threadId)).toBe(true);
  });

  it('wraps a CommentEvent into an EventEnvelope for transport uniformity', async () => {
    const { store, sink } = makeStore();
    await store.add(tenant, baseInput());
    const envelope = toEventEnvelope(sink.events[0], 1, '2026-06-02T10:00:00.000Z');
    expect(envelope.type).toBe('created');
    expect(envelope.seq).toBe(1);
    expect(envelope.ts).toBe('2026-06-02T10:00:00.000Z');
    expect(envelope.tenant).toEqual(tenant);
    expect(envelope.payload).toBe(sink.events[0]);
    expect(envelope.redactedFields).toBeUndefined();
  });
});
