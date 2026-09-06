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

describe('threading', () => {
  it('mints a threadId on the root and inherits it on replies', async () => {
    const store = new InMemoryCommentStore();
    const root = await store.add(tenant, baseInput({ body: 'root' }));
    const reply = await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'reply' }),
    );
    expect(reply.threadId).toBe(root.threadId);

    const thread = await store.listThread(tenant, root.threadId);
    expect(thread.map((row) => row.body)).toEqual(['root', 'reply']);
  });

  it('rejects a reply to an unknown thread (live "Thread not found")', async () => {
    const store = new InMemoryCommentStore();
    await expect(
      store.add(tenant, baseInput({ threadId: 'thr_missing' })),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it('rejects a reply when the thread exists on a different target', async () => {
    const store = new InMemoryCommentStore();
    const root = await store.add(
      tenant,
      baseInput({ target: { kind: 'message', id: 'msg_A' } }),
    );
    await expect(
      store.add(
        tenant,
        baseInput({
          threadId: root.threadId,
          target: { kind: 'message', id: 'msg_B' },
        }),
      ),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it('orders a thread deterministically by createdAt then id on timestamp ties', async () => {
    // Frozen clock => all rows share createdAt; id tiebreaker must decide.
    const frozen = new Date('2026-06-02T10:00:00.000Z');
    let counter = 0;
    const store = new InMemoryCommentStore({
      now: () => frozen,
      // Ids minted in reverse-lexical insertion order to prove id sorting.
      generateId: () => `id_${(9 - counter++).toString()}`,
    });

    const root = await store.add(tenant, baseInput({ body: 'root' }));
    const r1 = await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'r1' }),
    );
    const r2 = await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'r2' }),
    );

    const thread = await store.listThread(tenant, root.threadId);
    const sortedIds = [root.id, r1.id, r2.id].sort();
    expect(thread.map((row) => row.id)).toEqual(sortedIds);
    expect(thread.every((row) => row.createdAt === frozen.toISOString())).toBe(
      true,
    );
  });

  it('atomically edits content and assignment across a thread', async () => {
    const store = new InMemoryCommentStore();
    const root = await store.add(tenant, baseInput({ body: 'root' }));
    await store.add(tenant, baseInput({ threadId: root.threadId, body: 'reply' }));

    const updated = await store.editThread(tenant, root.threadId, {
      content: 'shared update',
      assignedTo: 'usr_2',
    });
    expect(updated).toHaveLength(2);
    expect(updated.every((row) => row.body === 'shared update')).toBe(true);
    expect(updated.every((row) => row.assignedTo === 'usr_2')).toBe(true);
  });
});
