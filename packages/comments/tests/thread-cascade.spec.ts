import { describe, expect, it } from 'vitest';

import {
  InMemoryCommentStore,
  ThreadNotFoundError,
  type NewComment,
} from '../src/index.js';

const tenant = { tenantId: 'tnt_1', workspaceId: 'wsp_1', userId: 'usr_1' };

const baseInput = (overrides: Partial<NewComment> = {}): NewComment => ({
  tenant,
  target: { kind: 'message', id: 'msg_1' },
  author: { id: 'usr_1', kind: 'human' },
  body: 'body',
  ...overrides,
});

async function seedThread(store: InMemoryCommentStore) {
  const root = await store.add(tenant, baseInput({ body: 'root' }));
  const reply = await store.add(
    tenant,
    baseInput({ threadId: root.threadId, body: 'reply' }),
  );
  return { root, reply };
}

describe('thread-level cascade', () => {
  it('setState resolves and reopens every row of the thread', async () => {
    const store = new InMemoryCommentStore();
    const { root } = await seedThread(store);

    const resolved = await store.setState(tenant, root.threadId, 'resolved');
    expect(resolved.every((row) => row.state === 'resolved')).toBe(true);
    expect(resolved.every((row) => row.updatedAt !== undefined)).toBe(true);

    const reopened = await store.setState(tenant, root.threadId, 'open');
    expect(reopened.every((row) => row.state === 'open')).toBe(true);
  });

  it('assign cascades the assignee across the thread and unassigns on null', async () => {
    const store = new InMemoryCommentStore();
    const { root } = await seedThread(store);

    const assigned = await store.assign(tenant, root.threadId, 'usr_assignee');
    expect(assigned.every((row) => row.assignedTo === 'usr_assignee')).toBe(true);

    const unassigned = await store.assign(tenant, root.threadId, null);
    expect(unassigned.every((row) => row.assignedTo === undefined)).toBe(true);
  });

  it('content edit is row-level and does NOT cascade state/assignment', async () => {
    const store = new InMemoryCommentStore();
    const { root, reply } = await seedThread(store);
    await store.assign(tenant, root.threadId, 'usr_assignee');

    await store.edit(tenant, root.id, { body: 'edited root only' });

    const rootAfter = await store.get(tenant, root.id);
    const replyAfter = await store.get(tenant, reply.id);
    expect(rootAfter?.body).toBe('edited root only');
    expect(replyAfter?.body).toBe('reply');
    // Assignment still present on both (edit did not disturb the cascade).
    expect(rootAfter?.assignedTo).toBe('usr_assignee');
    expect(replyAfter?.assignedTo).toBe('usr_assignee');
  });

  it('cascade on an unknown thread throws ThreadNotFoundError', async () => {
    const store = new InMemoryCommentStore();
    await expect(
      store.setState(tenant, 'thr_missing', 'resolved'),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
    await expect(
      store.assign(tenant, 'thr_missing', 'usr_x'),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });
});
