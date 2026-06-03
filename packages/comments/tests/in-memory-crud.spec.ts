import { describe, expect, it } from 'vitest';

import {
  CommentNotFoundError,
  CollectingCommentEventSink,
  InMemoryCommentStore,
  type NewComment,
} from '../src/index.js';

const tenant = { tenantId: 'tnt_1', workspaceId: 'wsp_1', userId: 'usr_1' };

function makeStore() {
  const sink = new CollectingCommentEventSink();
  let counter = 0;
  let clock = 0;
  const store = new InMemoryCommentStore({
    sink,
    generateId: () => `id_${(++counter).toString().padStart(3, '0')}`,
    now: () => new Date(Date.UTC(2026, 5, 2, 10, 0, clock++)),
  });
  return { store, sink };
}

const baseInput = (overrides: Partial<NewComment> = {}): NewComment => ({
  tenant,
  target: { kind: 'message', id: 'msg_1' },
  author: { id: 'usr_1', kind: 'human' },
  body: 'root body',
  ...overrides,
});

describe('in-memory CRUD', () => {
  it('adds and gets a comment, minting id + threadId', async () => {
    const { store } = makeStore();
    const created = await store.add(tenant, baseInput());
    expect(created.id).toBeTruthy();
    expect(created.threadId).toBeTruthy();
    expect(created.state).toBe('open');

    const fetched = await store.get(tenant, created.id);
    expect(fetched).toEqual(created);
  });

  it('edits content per-row without touching siblings', async () => {
    const { store } = makeStore();
    const root = await store.add(tenant, baseInput());
    const reply = await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'reply body' }),
    );

    const edited = await store.edit(tenant, root.id, { body: 'edited root' });
    expect(edited.body).toBe('edited root');
    expect(edited.updatedAt).toBeTruthy();

    const replyAfter = await store.get(tenant, reply.id);
    expect(replyAfter?.body).toBe('reply body');
    expect(replyAfter?.updatedAt).toBeUndefined();
  });

  it('hard-deletes per row; deleting the root leaves surviving replies', async () => {
    const { store } = makeStore();
    const root = await store.add(tenant, baseInput());
    const reply = await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'reply body' }),
    );

    await store.delete(tenant, root.id);
    expect(await store.get(tenant, root.id)).toBeNull();

    const surviving = await store.listThread(tenant, root.threadId);
    expect(surviving.map((row) => row.id)).toEqual([reply.id]);
  });

  it('throws CommentNotFoundError on missing edit/delete targets', async () => {
    const { store } = makeStore();
    await expect(store.edit(tenant, 'nope', { body: 'x' })).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
    await expect(store.delete(tenant, 'nope')).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
  });

  it('lists by target filtering on kind + id + sectionKey + status', async () => {
    const { store } = makeStore();
    const a = await store.add(
      tenant,
      baseInput({ target: { kind: 'record', id: 'r1', sectionKey: 'desc' } }),
    );
    await store.add(
      tenant,
      baseInput({ target: { kind: 'record', id: 'r1', sectionKey: 'other' } }),
    );
    await store.add(
      tenant,
      baseInput({ target: { kind: 'record', id: 'r2', sectionKey: 'desc' } }),
    );

    const bySection = await store.listByTarget(tenant, {
      kind: 'record',
      id: 'r1',
      sectionKey: 'desc',
    });
    expect(bySection.map((row) => row.id)).toEqual([a.id]);

    await store.setState(tenant, a.threadId, 'resolved');
    const openOnly = await store.listByTarget(tenant, {
      kind: 'record',
      id: 'r1',
      sectionKey: 'desc',
      status: 'open',
    });
    expect(openOnly).toHaveLength(0);
  });
});
