import { describe, expect, it } from 'vitest';

import {
  InMemoryCommentStore,
  type CommentThreadSummary,
  type NewComment,
} from '../src/index.js';

const tenant = { tenantId: 'tnt_1', workspaceId: 'wsp_1', userId: 'usr_1' };

function makeStore() {
  let counter = 0;
  let clock = 0;
  return new InMemoryCommentStore({
    generateId: () => `id_${(++counter).toString().padStart(3, '0')}`,
    now: () => new Date(Date.UTC(2026, 5, 2, 10, 0, clock++)),
  });
}

const baseInput = (overrides: Partial<NewComment> = {}): NewComment => ({
  tenant,
  target: { kind: 'record', id: 'r1', recordType: 'folder', sectionKey: 'desc' },
  author: { id: 'usr_1', kind: 'human' },
  body: 'body',
  ...overrides,
});

describe('listThreadSummaries', () => {
  it('builds a summary with verbatim live field names', async () => {
    const store = makeStore();
    const root = await store.add(tenant, baseInput({ body: 'root msg' }));
    await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'middle msg' }),
    );
    await store.add(
      tenant,
      baseInput({ threadId: root.threadId, body: 'last msg' }),
    );
    await store.assign(tenant, root.threadId, 'usr_owner');

    const [summary] = await store.listThreadSummaries(tenant, {
      kind: 'record',
      id: 'r1',
    });

    const expected: CommentThreadSummary = {
      threadId: root.threadId,
      contextType: 'folder',
      target: { kind: 'record', id: 'r1', recordType: 'folder', sectionKey: 'desc' },
      sectionKey: 'desc',
      rootMessage: 'root msg',
      rootMessageAt: root.createdAt,
      lastMessage: 'last msg',
      lastMessageAt: summary.lastMessageAt,
      messageCount: 3,
      status: 'open',
      assignee: 'usr_owner',
    };
    expect(summary).toEqual(expected);
    expect(new Date(summary.lastMessageAt).getTime()).toBeGreaterThan(
      new Date(summary.rootMessageAt).getTime(),
    );
  });

  it('marks the thread resolved when any row is resolved', async () => {
    const store = makeStore();
    const root = await store.add(tenant, baseInput({ body: 'root' }));
    await store.add(tenant, baseInput({ threadId: root.threadId, body: 'reply' }));
    await store.setState(tenant, root.threadId, 'resolved');

    const [summary] = await store.listThreadSummaries(tenant, {
      kind: 'record',
      id: 'r1',
    });
    expect(summary.status).toBe('resolved');
  });

  it('takes the first non-null assignee across the thread rows', async () => {
    const store = makeStore();
    const root = await store.add(tenant, baseInput({ body: 'root' }));
    // Reply carries an explicit assignee; root has none.
    await store.add(
      tenant,
      baseInput({
        threadId: root.threadId,
        body: 'reply',
        assignedTo: 'usr_reply_owner',
      }),
    );

    const [summary] = await store.listThreadSummaries(tenant, {
      kind: 'record',
      id: 'r1',
    });
    expect(summary.assignee).toBe('usr_reply_owner');
  });

  it('filters summaries by status when requested', async () => {
    const store = makeStore();
    const open = await store.add(tenant, baseInput({ body: 'open thread' }));
    const closed = await store.add(
      tenant,
      baseInput({ body: 'closed thread' }),
    );
    await store.setState(tenant, closed.threadId, 'resolved');

    const resolvedOnly = await store.listThreadSummaries(tenant, {
      kind: 'record',
      id: 'r1',
      status: 'resolved',
    });
    expect(resolvedOnly.map((s) => s.threadId)).toEqual([closed.threadId]);

    const openOnly = await store.listThreadSummaries(tenant, {
      kind: 'record',
      id: 'r1',
      status: 'open',
    });
    expect(openOnly.map((s) => s.threadId)).toEqual([open.threadId]);
  });
});
