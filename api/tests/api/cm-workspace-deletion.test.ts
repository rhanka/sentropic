import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { workspaces } from '../../src/db/schema';
import { putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';
import { cmDeleteWorkspaceMembers } from '../utils/cm-identity-test-store';

/**
 * a4-cm-gaps-r2 §10.7 series 4 (P5), app side, part 1: the workspace DELETE
 * route is bound to `createAtomicWorkspaceDeletionV1`. Route mapping cases —
 * 400 before any CM call, 403, 204 then second-DELETE 404. Capture, Q-WS1
 * and notification cases follow in part 2.
 */

const budget = { deadlineMs: 10_000, maxAttempts: 1 };

async function createWorkspace(token: string, name = `WS ${Date.now()}`): Promise<string> {
  const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', token, { name });
  expect(res.status).toBe(201);
  return String((await res.json())?.id ?? '');
}

const hide = (id: string, token: string) =>
  authenticatedRequest(app, 'POST', `/api/v1/workspaces/${id}/hide`, token, {});

const remove = (id: string, token: string) =>
  authenticatedRequest(app, 'DELETE', `/api/v1/workspaces/${id}`, token);

describe('CM workspace hard deletion (P5 route binding)', () => {
  let admin: TestUser;
  let member: TestUser;
  const createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', JSON.stringify({
      reservation: budget, deletion: budget, diagnostic: budget, read: budget,
      workspace: budget,
      qualificationReceiptRef: 'synthetic-test-only-not-a-rehearsal-receipt',
    }));
    admin = await createAuthenticatedUser('editor');
    member = await createAuthenticatedUser('editor');
    if (admin.workspaceId) createdWorkspaceIds.push(admin.workspaceId);
    if (member.workspaceId) createdWorkspaceIds.push(member.workspaceId);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of createdWorkspaceIds) {
      await cmDeleteWorkspaceMembers(id);
      await db.delete(workspaces).where(eq(workspaces.id, id)).catch(() => undefined);
    }
    createdWorkspaceIds.length = 0;
    await cleanupAuthData();
  });

  it('returns 400 when the workspace is not hidden, with zero mutation', async () => {
    const wsId = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(wsId);
    const response = await remove(wsId, admin.sessionToken);
    expect(response.status).toBe(400);
    const rows = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wsId));
    expect(rows).toHaveLength(1);
  });

  it('returns 403 for a non-admin member', async () => {
    const wsId = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(wsId);
    await putCmWorkspaceMember(wsId, member.id, 'viewer');
    expect(await hide(wsId, admin.sessionToken)).toMatchObject({ status: 200 });
    const response = await remove(wsId, member.sessionToken);
    expect(response.status).toBe(403);
    const rows = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wsId));
    expect(rows).toHaveLength(1);
  });

  it('deletes on 204 and maps the second DELETE to 404', async () => {
    const wsId = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(wsId);
    await putCmWorkspaceMember(wsId, member.id, 'viewer');
    expect(await hide(wsId, admin.sessionToken)).toMatchObject({ status: 200 });
    expect((await remove(wsId, admin.sessionToken)).status).toBe(204);
    const gone = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wsId));
    expect(gone).toHaveLength(0);
    const again = await remove(wsId, admin.sessionToken);
    expect(again.status).toBe(404);
  });
});
