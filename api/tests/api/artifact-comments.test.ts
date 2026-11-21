import { randomUUID } from 'node:crypto';
import type { Comment, CommentThreadSummary } from '@sentropic/comments';
import { ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH, PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE, SECTION_KEY_TOO_LONG_CODE } from '@sentropic/comments/artifact-hono';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { comments } from '../../src/db/schema';
import { createProductArtifactCommentsRouterOptions } from '../../src/routes/namespaces/artifact-comments-ports';
import { putCmWorkspaceMember, setCmMembershipState } from '../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../src/services/workspace-service';
import { createId } from '../../src/utils/id';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, unauthenticatedRequest, type TestUser } from '../utils/auth-helper';
import { cmDeleteWorkspaceMembers } from '../utils/cm-identity-test-store';

type NotifyPayload = { workspace_id: string; context_type: string; context_id: string; data: { action: string; comment_id?: string; thread_id?: string } };
const MISSING_UUID = '99999999-9999-4999-8999-999999999999';

function artifactCommentRoutes(artifactId: string) {
  const base = `/api/v1/artifacts/${artifactId}/comments`;
  return [
    ['GET', base],
    ['GET', `${base}/summaries`],
    ['GET', `${base}/threads/th-1`],
    ['POST', base, { content: 'Comment' }],
    ['POST', `${base}/threads/th-1/close`],
    ['POST', `${base}/threads/th-1/reopen`],
    ['PATCH', `${base}/threads/th-1/assignee`, { assigned_to: null }],
    ['PATCH', `${base}/c-1`, { content: 'Edit' }],
    ['DELETE', `${base}/c-1`],
  ] as const;
}

async function expectRefusal(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ code });
}

it('should emit comment events through the injected pool', async () => {
  const query = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const injectedPool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  const { events } = createProductArtifactCommentsRouterOptions({ pool: injectedPool });

  await events!.emit({
    workspaceId: 'workspace', contextType: 'artifact', contextId: 'artifact',
    action: 'created', key: 'comment_id', commentId: 'comment', threadId: 'thread', origin: 'rest',
  });

  expect(query).toHaveBeenCalledOnce();
  expect(parseNotify(query.mock.calls[0][0])).toEqual({
    workspace_id: 'workspace', context_type: 'artifact', context_id: 'artifact',
    data: { action: 'created', comment_id: 'comment' },
  });
  expect(release).toHaveBeenCalledOnce();
});

function parseNotify(sql: string): NotifyPayload | null {
  const m = sql.match(/^NOTIFY comment_events, '([\s\S]*)'$/);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/''/g, "'")) as NotifyPayload; } catch { return null; }
}

describe('artifact-comments namespace API (C2c, real PostgreSQL)', () => {
  let owner: TestUser, commenter: TestUser, viewer: TestUser, admin: TestUser, outsider: TestUser;
  let storageScopeId: string, outsiderScopeId: string, sharedId: string, privateId: string, otherId: string, deletedId: string;
  let captured: NotifyPayload[];
  let connectSpy: ReturnType<typeof vi.spyOn>;

  const reqAs = (u: TestUser, method: string, path: string, body?: unknown, headers?: Record<string, string>, workspaceId = owner.workspaceId) => {
    const sep = path.includes('?') ? '&' : '?';
    return authenticatedRequest(app, method, `${path}${sep}workspace_id=${workspaceId}`, u.sessionToken!, body, headers);
  };

  beforeEach(async () => {
    captured = [];
    const realConnect = pool.connect.bind(pool);
    const WRAPPED = Symbol.for('artifact-comments-notify-wrapped');
    connectSpy = vi.spyOn(pool, 'connect').mockImplementation(async (...args: unknown[]) => {
      const client = (await (realConnect as (...a: unknown[]) => Promise<unknown>)(...args)) as { query: (...a: unknown[]) => unknown; [WRAPPED]?: boolean };
      if (!client[WRAPPED]) {
        const realQuery = client.query.bind(client);
        client.query = (...qargs: unknown[]) => {
          const sql = typeof qargs[0] === 'string' ? qargs[0] : (qargs[0] as { text?: string } | undefined)?.text;
          if (typeof sql === 'string' && sql.startsWith('NOTIFY comment_events')) {
            const p = parseNotify(sql);
            if (p) captured.push(p);
          }
          return realQuery(...qargs);
        };
        client[WRAPPED] = true;
      }
      return client as never;
    });

    owner = await createAuthenticatedUser('editor');
    commenter = await createAuthenticatedUser('guest');
    viewer = await createAuthenticatedUser('guest');
    admin = await createAuthenticatedUser('editor');
    outsider = await createAuthenticatedUser('editor');
    await putCmWorkspaceMember(owner.workspaceId!, commenter.id, 'commenter');
    await putCmWorkspaceMember(owner.workspaceId!, viewer.id, 'viewer');
    await putCmWorkspaceMember(owner.workspaceId!, admin.id, 'admin');
    storageScopeId = randomUUID();
    outsiderScopeId = randomUUID();
    for (const [user, scopeId] of [[owner, storageScopeId], [outsider, outsiderScopeId]] as const) {
      await pool.query(`INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ('app-artifact-scopes/v1', $1, $2)`, [JSON.stringify([PLATFORM_TENANT_ID, user.workspaceId]), scopeId]);
      await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2)`, [scopeId, PLATFORM_TENANT_ID]);
    }
    [sharedId, privateId, otherId, deletedId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [id, name, mode, pub, state] of [
      [sharedId, 'shared', 'platform', true, 'active'],
      [privateId, 'private', 'restricted', false, 'active'],
      [otherId, 'other', 'platform', true, 'active'],
      [deletedId, 'deleted', 'restricted', false, 'deleted'],
    ] as const) {
      await pool.query(
        `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, access_mode, is_public, lifecycle_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, storageScopeId, owner.id, name, mode, pub, state],
      );
    }
    await db.insert(comments).values({
      id: createId(), workspaceId: owner.workspaceId!, contextType: 'initiative', contextId: sharedId,
      sectionKey: 'a1:non-artifact', createdBy: owner.id, assignedTo: null, status: 'open',
      threadId: createId(), content: 'Non-artifact collision row', createdAt: new Date(), updatedAt: new Date(),
    });
    captured = [];
  });

  afterEach(async () => {
    connectSpy.mockRestore();
    if (owner?.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, owner.workspaceId));
      await cmDeleteWorkspaceMembers(owner.workspaceId);
    }
    if (storageScopeId) {
      await pool.query(`DELETE FROM control.artifact_host_kv WHERE storage_scope_id = 'app-artifact-scopes/v1' AND value IN ($1, $2)`, [storageScopeId, outsiderScopeId]);
      await pool.query('DELETE FROM artifacts.storage_scopes WHERE id = $1', [outsiderScopeId]);
    }
    await cleanupAuthData();
  });

  it('should enforce 401 auth, 404 unknown/non-visible, and 403 viewer comment refusals without gating health', async () => {
    expect((await app.request('/api/v1/health')).status).toBe(200);
    for (const [method, path, body] of artifactCommentRoutes(sharedId)) {
      expect((await unauthenticatedRequest(app, method, path, body)).status).toBe(401);
    }
    for (const [u, id] of [[owner, MISSING_UUID], [owner, 'not-a-uuid'], [commenter, privateId], [viewer, privateId], [owner, deletedId]] as const) {
      const res = await reqAs(u, 'GET', `/api/v1/artifacts/${id}/comments`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'artifact_not_found' });
    }
    expect((await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments`)).status).toBe(200);
    expect((await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments/summaries`)).status).toBe(200);
    for (const [method, path, body] of artifactCommentRoutes(sharedId)) {
      if (method !== 'GET') await expectRefusal(await reqAs(viewer, method, path, body), 403, 'comment_forbidden');
    }
    for (const id of [MISSING_UUID, 'not-a-uuid', privateId, deletedId]) {
      for (const [method, path, body] of artifactCommentRoutes(id)) {
        const res = await reqAs(viewer, method, path, body);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ code: 'artifact_not_found', error: 'Not found' });
      }
    }
  });

  it('should hide foreign artifacts from an outsider in either workspace', async () => {
    for (const id of [sharedId, MISSING_UUID]) {
      for (const [method, path, body] of artifactCommentRoutes(id)) {
        const foreignWorkspace = await reqAs(outsider, method, path, body);
        expect(foreignWorkspace.status).toBe(404);
        expect(await foreignWorkspace.json()).toEqual({ message: 'Not found' });
        const ownWorkspace = await reqAs(outsider, method, path, body, undefined, outsider.workspaceId);
        expect(ownWorkspace.status).toBe(404);
        expect(await ownWorkspace.json()).toEqual({ code: 'artifact_not_found', error: 'Not found' });
      }
    }
  });

  it('should hide artifacts after tenant membership is suspended', async () => {
    const path = `/api/v1/artifacts/${sharedId}/comments`;
    expect((await reqAs(commenter, 'GET', path)).status).toBe(200);
    await setCmMembershipState(commenter.id, PLATFORM_TENANT_ID, { status: 'suspended', decidedBy: owner.id });
    await expectRefusal(await reqAs(commenter, 'GET', path), 404, 'artifact_not_found');
    await expectRefusal(await reqAs(commenter, 'POST', path, { content: 'Suspended' }), 404, 'artifact_not_found');
  });

  it('should execute all verbs with reply section_key inheritance, null unassign, moderation, and NOTIFY events', async () => {
    const createRes = await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Root', section_key: 'a1:keep' });
    expect(createRes.status).toBe(201);
    const { comment: root } = (await createRes.json()) as { comment: Comment };
    expect(root).toMatchObject({ target: { kind: 'artifact', id: sharedId, sectionKey: 'a1:keep' }, state: 'open', body: 'Root' });
    expect(root.assignedTo).toBeUndefined();
    expect(captured).toEqual([{ workspace_id: owner.workspaceId, context_type: 'artifact', context_id: sharedId, data: { action: 'created', comment_id: root.id } }]);
    captured = [];

    const r1Res = await reqAs(commenter, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Reply 1', thread_id: root.threadId });
    expect(r1Res.status).toBe(201);
    const { comment: r1 } = (await r1Res.json()) as { comment: Comment };
    expect(r1.target.sectionKey).toBe('a1:keep');
    const [r1Row] = await db.select().from(comments).where(eq(comments.id, r1.id));
    expect(r1Row.sectionKey).toBe('a1:keep');
    expect(r1Row.assignedTo).toBeNull();
    expect(captured).toEqual([{ workspace_id: owner.workspaceId, context_type: 'artifact', context_id: sharedId, data: { action: 'created', comment_id: r1.id } }]);

    const listBody = (await (await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments?status=open&section_key=a1:keep`)).json()) as { items: Comment[] };
    expect(listBody.items.map((c) => c.id)).toEqual([root.id, r1.id]);
    expect(listBody.items.every((c) => c.target.kind === 'artifact' && c.target.recordType === undefined)).toBe(true);
    await expectRefusal(await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments?status=resolved`), 400, 'invalid_query');
    const sumBody = (await (await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments/summaries?status=open`)).json()) as { items: CommentThreadSummary[] };
    expect(sumBody.items).toHaveLength(1);
    expect(sumBody.items[0]).toMatchObject({ threadId: root.threadId, contextType: 'artifact', messageCount: 2, status: 'open' });
    expect((await (await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}`)).json() as { items: Comment[] }).items).toHaveLength(2);
    await expectRefusal(await reqAs(viewer, 'GET', `/api/v1/artifacts/${otherId}/comments/threads/${root.threadId}`), 404, 'thread_not_found');

    captured = [];
    const base = `/api/v1/artifacts/${sharedId}/comments`;
    const otherBase = `/api/v1/artifacts/${otherId}/comments`;
    for (const [method, path, body] of [
      ['POST', base, { content: 'Missing thread', thread_id: MISSING_UUID }],
      ['POST', otherBase, { content: 'Foreign thread', thread_id: root.threadId }],
      ['POST', `${base}/threads/${root.id}/close`],
      ['POST', `${base}/threads/${root.id}/reopen`],
      ['PATCH', `${base}/threads/${root.id}/assignee`, { assigned_to: null }],
    ] as const) {
      await expectRefusal(await reqAs(commenter, method, path, body), 404, 'thread_not_found');
    }
    const closeRes = await reqAs(commenter, 'POST', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}/close`);
    expect(closeRes.status).toBe(200);
    expect(((await closeRes.json()) as { items: Comment[] }).items.map((c) => c.state)).toEqual(['closed', 'closed']);
    const reopenRes = await reqAs(commenter, 'POST', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}/reopen`);
    expect(reopenRes.status).toBe(200);
    expect(((await reopenRes.json()) as { items: Comment[] }).items.map((c) => c.state)).toEqual(['open', 'open']);
    expect((await reqAs(commenter, 'PATCH', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}/assignee`, { assigned_to: outsider.id })).status).toBe(400);
    const assignRes = await reqAs(commenter, 'PATCH', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}/assignee`, { assigned_to: commenter.id });
    expect(((await assignRes.json()) as { items: Comment[] }).items.every((c) => c.assignedTo === commenter.id)).toBe(true);
    const unassignRes = await reqAs(commenter, 'PATCH', `/api/v1/artifacts/${sharedId}/comments/threads/${root.threadId}/assignee`, { assigned_to: null });
    expect(((await unassignRes.json()) as { items: Comment[] }).items.every((c) => c.assignedTo === undefined)).toBe(true);
    const dbThread = await db.select({ assignedTo: comments.assignedTo }).from(comments).where(eq(comments.threadId, root.threadId));
    expect(dbThread.every((r) => r.assignedTo === null)).toBe(true);
    expect(captured.map((e) => e.data)).toEqual([
      { action: 'closed', thread_id: root.threadId }, { action: 'reopened', thread_id: root.threadId },
      { action: 'reassigned', thread_id: root.threadId }, { action: 'reassigned', thread_id: root.threadId },
    ]);

    captured = [];
    expect((await reqAs(commenter, 'PATCH', `/api/v1/artifacts/${sharedId}/comments/${root.id}`, { content: 'No' })).status).toBe(403);
    expect((await reqAs(commenter, 'DELETE', `/api/v1/artifacts/${sharedId}/comments/${root.id}`)).status).toBe(403);
    for (const [method, body] of [['PATCH', { content: 'Edit reply' }], ['DELETE', undefined]] as const) {
      await expectRefusal(await reqAs(owner, method, `${base}/${r1.id}`, body), 403, 'comment_forbidden');
      await expectRefusal(await reqAs(owner, method, `${otherBase}/${r1.id}`, body), 404, 'comment_not_found');
    }
    const editRes = await reqAs(owner, 'PATCH', `/api/v1/artifacts/${sharedId}/comments/${root.id}`, { content: 'Edited root' });
    expect(((await editRes.json()) as { comment: Comment }).comment.body).toBe('Edited root');
    const moderateRes = await reqAs(admin, 'PATCH', `${base}/${r1.id}`, { content: 'Moderated reply' });
    expect(moderateRes.status).toBe(200);
    expect(((await moderateRes.json()) as { comment: Comment }).comment.body).toBe('Moderated reply');
    const delRes = await reqAs(admin, 'DELETE', `/api/v1/artifacts/${sharedId}/comments/${root.id}`);
    expect(delRes.status).toBe(200);
    expect(captured.map((e) => e.data)).toEqual([
      { action: 'updated', comment_id: root.id },
      { action: 'updated', comment_id: r1.id },
      { action: 'deleted', comment_id: root.id },
    ]);

    const r2Res = await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Reply after root delete', thread_id: root.threadId });
    expect(r2Res.status).toBe(201);
    const { comment: r2 } = (await r2Res.json()) as { comment: Comment };
    expect(r2.target.sectionKey).toBe('a1:keep');
  });

  it('should return 400 for sectionKey cap violations and empty or missing provenance toolCallId', async () => {
    const atCap = 'a'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH);
    const overCap = 'a'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH + 1);
    const okCap = await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'At cap', section_key: atCap });
    expect(okCap.status).toBe(201);
    const { comment: root } = (await okCap.json()) as { comment: Comment };
    for (const res of [
      await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Over', section_key: overCap }),
      await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Over reply', thread_id: root.threadId, section_key: overCap }),
      await reqAs(owner, 'GET', `/api/v1/artifacts/${sharedId}/comments?section_key=${overCap}`),
      await reqAs(owner, 'GET', `/api/v1/artifacts/${sharedId}/comments/summaries?section_key=${overCap}`),
    ]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: SECTION_KEY_TOO_LONG_CODE, maxLength: 2048 });
    }
    for (const [body, headers] of [
      [{ content: 'Empty', provenance: { toolCallId: '' } }],
      [{ content: 'Spaces', provenance: { toolCallId: '   ' } }],
      [{ content: 'Run only', provenance: { runId: 'run-1' } }],
      [{ content: 'Agent', actor_kind: 'agent' }],
      [{ content: 'NHI header' }, { 'x-sentropic-actor-kind': 'nhi' }],
    ] as const) {
      const res = await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, body, headers);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE });
    }
    const provOk = await reqAs(owner, 'POST', `/api/v1/artifacts/${sharedId}/comments`, {
      content: 'Agent reply', thread_id: root.threadId, actor_kind: 'agent', provenance: { toolCallId: 'agent:s1:1', runId: 'r1' },
    });
    expect(provOk.status).toBe(201);
    const { comment: agentComment } = (await provOk.json()) as { comment: Comment };
    expect(agentComment.provenance).toEqual({ toolCallId: 'agent:s1:1' });
  });
});
