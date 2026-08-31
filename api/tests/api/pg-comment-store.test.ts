import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { TenantContext } from '@sentropic/contracts';
import {
  CommentNotFoundError,
  ThreadNotFoundError,
  type CommentTarget,
} from '@sentropic/comments';

import { db } from '../../src/db/client';
import { comments, workspaceMemberships } from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import {
  createAuthenticatedUser,
  cleanupAuthData,
  type TestUser,
} from '../utils/auth-helper';

import { PgCommentStore } from '../../src/services/comments/pg-comment-store';

/**
 * BR-42d Lot 2 — canonical `PgCommentStore` adapter-parity tests on a REAL test DB.
 *
 * Reuses the in-memory adapter scenarios (CRUD, threading, thread cascade,
 * per-row edit, per-row hard delete, ordering tiebreaker, tenant scoping,
 * runId-drop) to prove `PgCommentStore` behaves IDENTICALLY to
 * `InMemoryCommentStore` for PERSISTENCE. Emission is NOT tested here — the
 * adapter is EMIT-FREE (SPEC §2/§4); the extracted comments namespace injects
 * this same canonical store while wire emission remains host-controlled.
 *
 * `created_by` / `assigned_to` carry FK to `users`; `workspace_id` to
 * `workspaces`. `context_type` / `context_id` are plain text (no FK), so a
 * synthetic context id is sufficient.
 */
describe('PgCommentStore adapter parity (BR-42d Lot 2)', () => {
  let owner: TestUser;
  let other: TestUser;
  let store: PgCommentStore;
  let tenant: TenantContext;
  let target: CommentTarget;

  /** Deterministic id sequence so ordering-tiebreaker tests are reproducible. */
  let idSeq: number;
  const seqId = () => `cmt-${String(++idSeq).padStart(6, '0')}`;

  beforeEach(async () => {
    idSeq = 0;
    owner = await createAuthenticatedUser('editor', `owner-${createId()}@example.com`);
    other = await createAuthenticatedUser('editor', `other-${createId()}@example.com`);

    // Make `other` a member of the owner's workspace (for assignment FK + scoping).
    await db
      .insert(workspaceMemberships)
      .values({ workspaceId: owner.workspaceId!, userId: other.id, role: 'editor', createdAt: new Date() })
      .onConflictDoNothing();

    tenant = {
      // Live convention: tenantId := workspaceId (catalog.ts:32). The adapter
      // ignores tenantId and scopes on workspaceId.
      tenantId: owner.workspaceId!,
      workspaceId: owner.workspaceId!,
      userId: owner.id,
    };
    target = { kind: 'record', id: `org-${createId()}`, recordType: 'organization' };
    store = new PgCommentStore({ createId: seqId });
  });

  afterEach(async () => {
    if (owner.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, owner.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, owner.workspaceId));
    }
    await cleanupAuthData();
  });

  const newComment = (overrides: Partial<{
    body: string;
    threadId: string;
    assignedTo: string;
    target: CommentTarget;
    provenance: { toolCallId?: string; runId?: string };
    authorId: string;
  }> = {}) => ({
    tenant,
    target: overrides.target ?? target,
    author: { id: overrides.authorId ?? owner.id },
    body: overrides.body ?? 'Comment body',
    threadId: overrides.threadId,
    assignedTo: overrides.assignedTo,
    provenance: overrides.provenance,
  });

  // --- CRUD ---

  it('add mints a thread id and persists an open root row', async () => {
    const created = await store.add(tenant, newComment({ body: 'Root' }));
    expect(created.id).toBeTruthy();
    expect(created.threadId).toBeTruthy();
    expect(created.state).toBe('open');
    expect(created.body).toBe('Root');
    expect(created.author.id).toBe(owner.id);
    expect(created.target).toMatchObject({ kind: 'record', id: target.id, recordType: 'organization' });
    expect(created.createdAt).toBeTruthy();

    // Round-trips through the real DB.
    const [row] = await db.select().from(comments).where(eq(comments.id, created.id));
    expect(row.status).toBe('open');
    expect(row.contextType).toBe('organization');
    expect(row.contextId).toBe(target.id);
    expect(row.threadId).toBe(created.threadId);
  });

  it('get returns the mapped row or null', async () => {
    const created = await store.add(tenant, newComment());
    const fetched = await store.get(tenant, created.id);
    expect(fetched).toMatchObject({ id: created.id, body: created.body, state: 'open' });
    expect(await store.get(tenant, 'missing-id')).toBeNull();
  });

  it('edit performs a PER-ROW content edit (no cascade) and bumps updatedAt', async () => {
    const root = await store.add(tenant, newComment({ body: 'Original root' }));
    const reply = await store.add(tenant, newComment({ body: 'Original reply', threadId: root.threadId }));

    const edited = await store.edit(tenant, root.id, { body: 'Edited root' });
    expect(edited.body).toBe('Edited root');
    expect(edited.updatedAt).toBeTruthy();

    const replyAfter = await store.get(tenant, reply.id);
    expect(replyAfter?.body).toBe('Original reply'); // sibling untouched
  });

  it('edit throws CommentNotFoundError for a missing row', async () => {
    await expect(store.edit(tenant, 'missing-id', { body: 'x' })).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
  });

  it('delete performs a PER-ROW HARD delete; replies survive', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root to delete' }));
    const reply = await store.add(tenant, newComment({ body: 'Reply survives', threadId: root.threadId }));

    await store.delete(tenant, root.id);

    expect(await store.get(tenant, root.id)).toBeNull();
    const survivors = await store.listThread(tenant, root.threadId);
    expect(survivors.map((c) => c.id)).toEqual([reply.id]);
  });

  it('delete throws CommentNotFoundError for a missing row', async () => {
    await expect(store.delete(tenant, 'missing-id')).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
  });

  // --- Threading ---

  it('add to an existing thread appends a reply sharing the threadId', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root' }));
    const reply = await store.add(tenant, newComment({ body: 'Reply', threadId: root.threadId }));
    expect(reply.threadId).toBe(root.threadId);
    expect(reply.id).not.toBe(root.id);

    const thread = await store.listThread(tenant, root.threadId);
    expect(thread.map((c) => c.id)).toEqual([root.id, reply.id]);
  });

  it('add to a non-existent thread throws ThreadNotFoundError', async () => {
    await expect(
      store.add(tenant, newComment({ body: 'Orphan', threadId: 'ghost-thread' })),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it('add validates the thread within the SAME target (cross-target reply rejected)', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root' }));
    const otherTarget: CommentTarget = { kind: 'record', id: `org-${createId()}`, recordType: 'organization' };
    // Same threadId, different target -> the (ws, ctxType, ctxId, threadId) lookup misses.
    await expect(
      store.add(tenant, newComment({ body: 'Wrong target', threadId: root.threadId, target: otherTarget })),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  // --- Thread cascade (setState / assign) ---

  it('setState cascades resolved (-> closed) across all rows of the thread', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root' }));
    await store.add(tenant, newComment({ body: 'Reply', threadId: root.threadId }));

    const result = await store.setState(tenant, root.threadId, 'resolved');
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.state === 'resolved')).toBe(true);

    // Live column mapped to 'closed'.
    const rows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(and(eq(comments.workspaceId, owner.workspaceId!), eq(comments.threadId, root.threadId)));
    expect(rows.every((r) => r.status === 'closed')).toBe(true);

    const reopened = await store.setState(tenant, root.threadId, 'open');
    expect(reopened.every((c) => c.state === 'open')).toBe(true);
  });

  it('setState on an empty thread throws ThreadNotFoundError', async () => {
    await expect(store.setState(tenant, 'ghost-thread', 'resolved')).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );
  });

  it('assign cascades the assignee across the whole thread; null unassigns', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root' }));
    await store.add(tenant, newComment({ body: 'Reply', threadId: root.threadId }));

    const assigned = await store.assign(tenant, root.threadId, other.id);
    expect(assigned).toHaveLength(2);
    expect(assigned.every((c) => c.assignedTo === other.id)).toBe(true);

    const unassigned = await store.assign(tenant, root.threadId, null);
    expect(unassigned.every((c) => c.assignedTo === undefined)).toBe(true);
    const rows = await db
      .select({ assignedTo: comments.assignedTo })
      .from(comments)
      .where(and(eq(comments.workspaceId, owner.workspaceId!), eq(comments.threadId, root.threadId)));
    expect(rows.every((r) => r.assignedTo === null)).toBe(true);
  });

  it('assign on an empty thread throws ThreadNotFoundError', async () => {
    await expect(store.assign(tenant, 'ghost-thread', other.id)).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );
  });

  // --- Combined thread edit (editThread: content + assignment in ONE atomic statement) ---

  it('editThread sets the SAME content + assignee on ALL rows thread-wide and bumps updatedAt', async () => {
    const root = await store.add(tenant, newComment({ body: 'Original root' }));
    await store.add(tenant, newComment({ body: 'Original mid', threadId: root.threadId }));
    await store.add(tenant, newComment({ body: 'Original last', threadId: root.threadId }));

    const result = await store.editThread(tenant, root.threadId, {
      content: 'Combined edit',
      assignedTo: other.id,
    });
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.body === 'Combined edit')).toBe(true); // content cascaded
    expect(result.every((c) => c.assignedTo === other.id)).toBe(true); // assignee cascaded
    expect(result.every((c) => c.updatedAt)).toBe(true); // updatedAt bumped

    // The single atomic UPDATE landed on every row of the thread.
    const rows = await db
      .select({ content: comments.content, assignedTo: comments.assignedTo })
      .from(comments)
      .where(and(eq(comments.workspaceId, owner.workspaceId!), eq(comments.threadId, root.threadId)));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.content === 'Combined edit')).toBe(true);
    expect(rows.every((r) => r.assignedTo === other.id)).toBe(true);
  });

  it('editThread accepts a null assignee (unassign) while cascading content', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root', assignedTo: other.id }));
    await store.add(tenant, newComment({ body: 'Reply', threadId: root.threadId, assignedTo: other.id }));

    const result = await store.editThread(tenant, root.threadId, {
      content: 'New body',
      assignedTo: null,
    });
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.body === 'New body')).toBe(true);
    expect(result.every((c) => c.assignedTo === undefined)).toBe(true);
  });

  it('editThread on an empty/unknown thread throws ThreadNotFoundError', async () => {
    await expect(
      store.editThread(tenant, 'ghost-thread', { content: 'x', assignedTo: other.id }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  // --- Listing / ordering ---

  it('listByTarget filters by target and status, ordered createdAt ASC then id ASC', async () => {
    const openRoot = await store.add(tenant, newComment({ body: 'open' }));
    const closedRoot = await store.add(tenant, newComment({ body: 'closed' }));
    await store.setState(tenant, closedRoot.threadId, 'resolved');

    const all = await store.listByTarget(tenant, { kind: 'record', id: target.id });
    expect(all.map((c) => c.id)).toContain(openRoot.id);
    expect(all.map((c) => c.id)).toContain(closedRoot.id);

    const openOnly = await store.listByTarget(tenant, { kind: 'record', id: target.id, status: 'open' });
    expect(openOnly.map((c) => c.id)).toContain(openRoot.id);
    expect(openOnly.map((c) => c.id)).not.toContain(closedRoot.id);

    const resolvedOnly = await store.listByTarget(tenant, { kind: 'record', id: target.id, status: 'resolved' });
    expect(resolvedOnly.map((c) => c.id)).toContain(closedRoot.id);
    expect(resolvedOnly.map((c) => c.id)).not.toContain(openRoot.id);
  });

  it('listByTarget id tiebreaker is deterministic when createdAt collides', async () => {
    // Insert rows with an identical createdAt directly so the timestamp collides;
    // ids are crafted out-of-order to prove the id ASC tiebreaker.
    const now = new Date();
    const ctxId = `org-${createId()}`;
    const ids = ['zzz', 'aaa', 'mmm'];
    for (const id of ids) {
      await db.insert(comments).values({
        id,
        workspaceId: owner.workspaceId!,
        contextType: 'organization',
        contextId: ctxId,
        sectionKey: null,
        createdBy: owner.id,
        assignedTo: null,
        status: 'open',
        threadId: `thread-${id}`,
        content: id,
        createdAt: now,
        updatedAt: now,
      });
    }
    const listed = await store.listByTarget(tenant, { kind: 'record', id: ctxId });
    expect(listed.map((c) => c.id)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('listByTarget matches sectionKey when provided', async () => {
    const withSection = await store.add(tenant, newComment({ target: { ...target, sectionKey: 'header' } }));
    const noSection = await store.add(tenant, newComment());

    const scoped = await store.listByTarget(tenant, { kind: 'record', id: target.id, sectionKey: 'header' });
    expect(scoped.map((c) => c.id)).toEqual([withSection.id]);
    expect(scoped.map((c) => c.id)).not.toContain(noSection.id);
  });

  // --- listThreadSummaries (group-by parity) ---

  it('listThreadSummaries groups by thread: root/last/count/status/assignee', async () => {
    const root = await store.add(tenant, newComment({ body: 'Root msg' }));
    await store.add(tenant, newComment({ body: 'Mid msg', threadId: root.threadId }));
    const last = await store.add(tenant, newComment({ body: 'Last msg', threadId: root.threadId }));
    await store.assign(tenant, root.threadId, other.id);

    // A second, separate, resolved thread.
    const closedRoot = await store.add(tenant, newComment({ body: 'Closed root' }));
    await store.setState(tenant, closedRoot.threadId, 'resolved');

    const summaries = await store.listThreadSummaries(tenant, { kind: 'record', id: target.id });
    const open = summaries.find((s) => s.threadId === root.threadId)!;
    expect(open).toBeTruthy();
    expect(open.rootMessage).toBe('Root msg');
    expect(open.lastMessage).toBe('Last msg');
    expect(open.messageCount).toBe(3);
    expect(open.status).toBe('open');
    expect(open.assignee).toBe(other.id);
    expect(open.contextType).toBe('organization');
    expect(open.lastMessageAt).toBe(last.createdAt);

    const closed = summaries.find((s) => s.threadId === closedRoot.threadId)!;
    expect(closed.status).toBe('resolved'); // any closed row -> resolved
  });

  it('listThreadSummaries respects a status filter', async () => {
    const openRoot = await store.add(tenant, newComment());
    const closedRoot = await store.add(tenant, newComment());
    await store.setState(tenant, closedRoot.threadId, 'resolved');

    const resolved = await store.listThreadSummaries(tenant, { kind: 'record', id: target.id, status: 'resolved' });
    expect(resolved.map((s) => s.threadId)).toContain(closedRoot.threadId);
    expect(resolved.map((s) => s.threadId)).not.toContain(openRoot.threadId);
  });

  // --- Tenant / workspace scoping ---

  it('scopes every read to the tenant workspace (cross-workspace rows invisible)', async () => {
    const created = await store.add(tenant, newComment({ body: 'In owner ws' }));

    // `other` has their own workspace; a tenant scoped to it must not see owner rows.
    const otherTenant: TenantContext = {
      tenantId: other.workspaceId!,
      workspaceId: other.workspaceId!,
      userId: other.id,
    };
    expect(await store.get(otherTenant, created.id)).toBeNull();
    const listed = await store.listByTarget(otherTenant, { kind: 'record', id: target.id });
    expect(listed).toHaveLength(0);
    const thread = await store.listThread(otherTenant, created.threadId);
    expect(thread).toHaveLength(0);
  });

  // --- Provenance: toolCallId persisted, runId dropped (must-fix #7) ---

  it('persists provenance.toolCallId', async () => {
    const created = await store.add(tenant, newComment({ provenance: { toolCallId: 'tool_abc' } }));
    expect(created.provenance).toEqual({ toolCallId: 'tool_abc' });

    const [row] = await db.select().from(comments).where(eq(comments.id, created.id));
    expect(row.toolCallId).toBe('tool_abc');

    const fetched = await store.get(tenant, created.id);
    expect(fetched?.provenance).toEqual({ toolCallId: 'tool_abc' });
  });

  it('DROPS provenance.runId (no column) while persisting toolCallId', async () => {
    const created = await store.add(tenant, newComment({ provenance: { toolCallId: 'tool_xyz', runId: 'run_should_vanish' } }));
    // The returned comment carries ONLY toolCallId (runId is not stored).
    expect(created.provenance).toEqual({ toolCallId: 'tool_xyz' });
    expect((created.provenance as { runId?: string }).runId).toBeUndefined();

    const fetched = await store.get(tenant, created.id);
    expect(fetched?.provenance).toEqual({ toolCallId: 'tool_xyz' });
  });

  it('persists no provenance when none is supplied', async () => {
    const created = await store.add(tenant, newComment());
    expect(created.provenance).toBeUndefined();
    const [row] = await db.select().from(comments).where(eq(comments.id, created.id));
    expect(row.toolCallId).toBeNull();
  });

  // --- add status arg (Lot 5 #3: trace-note born already-closed) ---

  it('add defaults to status open (live default preserved)', async () => {
    const created = await store.add(tenant, newComment({ body: 'Default open' }));
    expect(created.state).toBe('open');
    const [row] = await db.select().from(comments).where(eq(comments.id, created.id));
    expect(row.status).toBe('open');
  });

  it('add with explicit status closed persists the row already-closed (no setState)', async () => {
    // A trace-note minted onto a thread the same action just resolved: it is born
    // closed via the status arg, faithfully to the OLD live insert
    // `status: latestStatus`, without a thread-wide cascade.
    const root = await store.add(tenant, newComment({ body: 'Root' }));
    const note = await store.add(
      tenant,
      newComment({ body: 'Closed note', threadId: root.threadId }),
      'closed',
    );
    expect(note.state).toBe('resolved'); // live 'closed' -> package 'resolved'

    const [noteRow] = await db.select().from(comments).where(eq(comments.id, note.id));
    expect(noteRow.status).toBe('closed');

    // ONLY the new note row carries the closed status; the sibling root is
    // untouched (no thread-wide setState reconcile).
    const [rootRow] = await db.select().from(comments).where(eq(comments.id, root.id));
    expect(rootRow.status).toBe('open');
  });

  // --- setProvenance (Lot 5 #5: queue auto provenance routed through the store) ---

  it('setProvenance updates tool_call_id by id+workspace, bumps updatedAt, returns the row', async () => {
    const created = await store.add(tenant, newComment({ body: 'Auto seed' }));
    const [before] = await db
      .select({ updatedAt: comments.updatedAt, toolCallId: comments.toolCallId })
      .from(comments)
      .where(eq(comments.id, created.id));
    expect(before.toolCallId).toBeNull();

    const provenance = `auto_generation:${created.id}`;
    const updated = await store.setProvenance(tenant, created.id, provenance);
    expect(updated.id).toBe(created.id);
    expect(updated.provenance).toEqual({ toolCallId: provenance });

    const [after] = await db
      .select({ updatedAt: comments.updatedAt, toolCallId: comments.toolCallId })
      .from(comments)
      .where(eq(comments.id, created.id));
    expect(after.toolCallId).toBe(provenance);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt!.getTime());
  });

  it('setProvenance throws CommentNotFoundError for a missing id', async () => {
    await expect(
      store.setProvenance(tenant, 'missing-id', 'auto_generation:missing-id'),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });

  it('setProvenance throws CommentNotFoundError for a cross-workspace id', async () => {
    const created = await store.add(tenant, newComment({ body: 'In owner ws' }));
    const otherTenant: TenantContext = {
      tenantId: other.workspaceId!,
      workspaceId: other.workspaceId!,
      userId: other.id,
    };
    // The row exists, but not in `other`'s workspace -> not found in scope.
    await expect(
      store.setProvenance(otherTenant, created.id, 'auto_generation:x'),
    ).rejects.toBeInstanceOf(CommentNotFoundError);

    // The owner row is untouched.
    const [row] = await db.select().from(comments).where(eq(comments.id, created.id));
    expect(row.toolCallId).toBeNull();
  });
});
