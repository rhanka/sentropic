import { describe, expect, it } from 'vitest';

import {
  CommentNotFoundError,
  InMemoryCommentStore,
  ThreadNotFoundError,
  type NewComment,
} from '../src/index.js';

const tenantA = { tenantId: 'tnt_A', workspaceId: 'wsp_A', userId: 'usr_A' };
const tenantB = { tenantId: 'tnt_B', workspaceId: 'wsp_B', userId: 'usr_B' };
// Same tenantId, different workspace — must still be isolated.
const tenantAOtherWorkspace = {
  tenantId: 'tnt_A',
  workspaceId: 'wsp_A2',
  userId: 'usr_A',
};

const input = (tenant: NewComment['tenant']): NewComment => ({
  tenant,
  target: { kind: 'message', id: 'msg_1' },
  author: { id: tenant.userId, kind: 'human' },
  body: 'scoped body',
});

describe('tenant scoping (cross-tenant isolation)', () => {
  it('does not leak a comment across tenants via get/list', async () => {
    const store = new InMemoryCommentStore();
    const created = await store.add(tenantA, input(tenantA));

    expect(await store.get(tenantB, created.id)).toBeNull();
    expect(
      await store.listByTarget(tenantB, { kind: 'message', id: 'msg_1' }),
    ).toHaveLength(0);
    expect(await store.listThread(tenantB, created.threadId)).toHaveLength(0);
    expect(
      await store.listThreadSummaries(tenantB, { kind: 'message', id: 'msg_1' }),
    ).toHaveLength(0);

    // Owner still sees it.
    expect(await store.get(tenantA, created.id)).not.toBeNull();
  });

  it('isolates workspaces that share a tenantId', async () => {
    const store = new InMemoryCommentStore();
    const created = await store.add(tenantA, input(tenantA));
    expect(await store.get(tenantAOtherWorkspace, created.id)).toBeNull();
    expect(
      await store.listByTarget(tenantAOtherWorkspace, {
        kind: 'message',
        id: 'msg_1',
      }),
    ).toHaveLength(0);
  });

  it('refuses cross-tenant mutation (edit/delete/cascade) as out-of-scope', async () => {
    const store = new InMemoryCommentStore();
    const created = await store.add(tenantA, input(tenantA));

    await expect(
      store.edit(tenantB, created.id, { body: 'hijack' }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
    await expect(store.delete(tenantB, created.id)).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
    await expect(
      store.setState(tenantB, created.threadId, 'resolved'),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
    await expect(
      store.assign(tenantB, created.threadId, 'usr_x'),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
    await expect(
      store.editThread(tenantB, created.threadId, { content: 'hijack', assignedTo: 'usr_x' }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);

    // The original row is untouched.
    const original = await store.get(tenantA, created.id);
    expect(original?.body).toBe('scoped body');
    expect(original?.state).toBe('open');
  });
});
