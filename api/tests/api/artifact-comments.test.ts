import { randomUUID } from 'node:crypto';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import type { Comment, CommentThreadSummary } from '@sentropic/comments';
import { ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH, PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE, SECTION_KEY_TOO_LONG_CODE } from '@sentropic/comments/artifact-hono';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { comments } from '../../src/db/schema';
import { putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../src/services/workspace-service';
import { createId } from '../../src/utils/id';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, unauthenticatedRequest, type TestUser } from '../utils/auth-helper';
import { cmDeleteWorkspaceMembers } from '../utils/cm-identity-test-store';

type NotifyPayload = { workspace_id: string; context_type: string; context_id: string; data: { action: string; comment_id?: string; thread_id?: string } };
const MISSING_UUID = '99999999-9999-4999-8999-999999999999';

function parseNotify(sql: string): NotifyPayload | null {
  const m = sql.match(/^NOTIFY comment_events, '([\s\S]*)'$/);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/''/g, "'")) as NotifyPayload; } catch { return null; }
}

describe('artifact-comments namespace API (C2c, real PostgreSQL)', () => {
  let owner: TestUser, commenter: TestUser, viewer: TestUser, admin: TestUser, outsider: TestUser;
  let storageScopeId: string, sharedId: string, privateId: string, otherId: string, deletedId: string;
  let captured: NotifyPayload[];
  let connectSpy: ReturnType<typeof vi.spyOn>;

  const reqAs = (u: TestUser, method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const sep = path.includes('?') ? '&' : '?';
    return authenticatedRequest(app, method, `${path}${sep}workspace_id=${owner.workspaceId}`, u.sessionToken!, body, headers);
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

    [owner, commenter, viewer, admin, outsider] = await Promise.all([
      createAuthenticatedUser('editor'), createAuthenticatedUser('guest'),
      createAuthenticatedUser('guest'), createAuthenticatedUser('editor'), createAuthenticatedUser('editor'),
    ]);
    await Promise.all([
      putCmWorkspaceMember(owner.workspaceId!, commenter.id, 'commenter'),
      putCmWorkspaceMember(owner.workspaceId!, viewer.id, 'viewer'),
      putCmWorkspaceMember(owner.workspaceId!, admin.id, 'admin'),
    ]);
    storageScopeId = randomUUID();
    await pool.query(`INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ('app-artifact-scopes/v1', $1, $2)`, [JSON.stringify([PLATFORM_TENANT_ID, owner.workspaceId!]), storageScopeId]);
    await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2)`, [storageScopeId, PLATFORM_TENANT_ID]);
    [sharedId, privateId, otherId, deletedId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [id, name] of [[sharedId, 'shared'], [privateId, 'private'], [otherId, 'other'], [deletedId, 'deleted']] as const) {
      await pool.query(`INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name) VALUES ($1, $2, $3, $4)`, [id, storageScopeId, owner.id, name]);
    }
    const store = createPostgresArtifactStore(pool);
    await store.putArtifactAcl(sharedId, { ownerId: owner.id, storageScopeId, isPublic: true, withdrawn: false, accessMode: 'platform', grants: [] });
    await store.putArtifactAcl(otherId, { ownerId: owner.id, storageScopeId, isPublic: true, withdrawn: false, accessMode: 'platform', grants: [] });
    await store.setArtifactState(deletedId, 'deleted');
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
      await pool.query(`DELETE FROM artifacts.artifacts WHERE storage_scope_id = $1`, [storageScopeId]);
      await pool.query(`DELETE FROM artifacts.storage_scopes WHERE id = $1`, [storageScopeId]);
      await pool.query(`DELETE FROM control.artifact_host_kv WHERE storage_scope_id = 'app-artifact-scopes/v1' AND value = $1`, [storageScopeId]);
    }
    await cleanupAuthData();
  });

  it('should enforce 401 auth, 404 unknown/non-visible, and 403 viewer comment refusals without gating health', async () => {
    expect((await app.request('/api/v1/health')).status).toBe(200);
    for (const [method, path, body] of [
      ['GET', `/api/v1/artifacts/${sharedId}/comments`],
      ['GET', `/api/v1/artifacts/${sharedId}/comments/summaries`],
      ['GET', `/api/v1/artifacts/${sharedId}/comments/threads/th-1`],
      ['POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'No auth' }],
      ['POST', `/api/v1/artifacts/${sharedId}/comments/threads/th-1/close`],
      ['PATCH', `/api/v1/artifacts/${sharedId}/comments/threads/th-1/assignee`, { assigned_to: null }],
      ['PATCH', `/api/v1/artifacts/${sharedId}/comments/c-1`, { content: 'No auth' }],
      ['DELETE', `/api/v1/artifacts/${sharedId}/comments/c-1`],
    ] as const) {
      expect((await unauthenticatedRequest(app, method, path, body)).status).toBe(401);
    }
    for (const [u, id] of [[owner, MISSING_UUID], [owner, 'not-a-uuid'], [commenter, privateId], [viewer, privateId], [owner, deletedId]] as const) {
      const res = await reqAs(u, 'GET', `/api/v1/artifacts/${id}/comments`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'artifact_not_found' });
    }
    expect((await reqAs(outsider, 'GET', `/api/v1/artifacts/${sharedId}/comments`)).status).toBe(404);
    expect((await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments`)).status).toBe(200);
    expect((await reqAs(viewer, 'GET', `/api/v1/artifacts/${sharedId}/comments/summaries`)).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', `/api/v1/artifacts/${sharedId}/comments`, { content: 'Blocked' }],
      ['POST', `/api/v1/artifacts/${sharedId}/comments/threads/th-1/close`],
      ['POST', `/api/v1/artifacts/${sharedId}/comments/threads/th-1/reopen`],
      ['PATCH', `/api/v1/artifacts/${sharedId}/comments/threads/th-1/assignee`, { assigned_to: null }],
      ['PATCH', `/api/v1/artifacts/${sharedId}/comments/c-1`, { content: 'Blocked' }],
      ['DELETE', `/api/v1/artifacts/${sharedId}/comments/c-1`],
    ] as const) {
      const res = await reqAs(viewer, method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'comment_forbidden' });
    }
  });
});
