import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { app } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { chatSessions, documentConnectorAccounts, workspaces } from '../../src/db/schema';
import { putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';
import { cmDeleteWorkspaceMembers, cmQuery, cmTable } from '../utils/cm-identity-test-store';
import { createCmConnectorFixture, findConnectorFixture } from '../utils/cm-connector-fixture';

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
  const connectorIds: string[] = [];

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
    if (connectorIds.length) {
      await db.delete(documentConnectorAccounts).where(inArray(documentConnectorAccounts.id, connectorIds));
      connectorIds.length = 0;
    }
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

  it("captures other members' in-workspace connector rows with their own ids as subject", async () => {
    const wsId = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(wsId);
    const elsewhere = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(elsewhere);
    await putCmWorkspaceMember(wsId, member.id, 'editor');
    await putCmWorkspaceMember(elsewhere, member.id, 'editor');
    const inside = await createCmConnectorFixture({ ...member, workspaceId: wsId });
    const outside = await createCmConnectorFixture({ ...member, workspaceId: elsewhere });
    connectorIds.push(inside.accountId, outside.accountId);
    expect(await hide(wsId, admin.sessionToken)).toMatchObject({ status: 200 });
    const response = await remove(wsId, admin.sessionToken);
    expect(response.status).toBe(204);
    expect(await findConnectorFixture(inside.accountId)).toHaveLength(0);
    expect(await findConnectorFixture(outside.accountId)).toHaveLength(1);
    const deliveries = await cmQuery<{ delivery_id: string; subject_id: string; target_ref: string; state: string }>(
      `SELECT delivery_id, subject_id, target_ref, state FROM ${cmTable('identity_revocation_outbox')}
       WHERE target_ref = $1 AND step = 'connector_grants'`,
      [inside.accountId],
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ subject_id: member.id, state: 'pending' });
    const custody = await cmQuery(
      `SELECT 1 FROM control.connector_revocation_custody WHERE delivery_id = $1`,
      [deliveries[0]!.delivery_id],
    );
    expect(custody).toHaveLength(1);
  });

  it('deletes the workspace chats with the workspace (Q-WS1)', async () => {
    const wsId = await createWorkspace(admin.sessionToken);
    createdWorkspaceIds.push(wsId);
    const sessionId = `chat-${wsId}`;
    await db.insert(chatSessions).values({ id: sessionId, userId: member.id, workspaceId: wsId });
    expect(await hide(wsId, admin.sessionToken)).toMatchObject({ status: 200 });
    expect((await remove(wsId, admin.sessionToken)).status).toBe(204);
    expect(await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId))).toHaveLength(0);
  });

  it('notifies deleted only after commit', async () => {
    const seen: Array<{ channel: string; payload: string }> = [];
    const client = await pool.connect();
    const handler = (msg: { channel: string; payload?: string }) => {
      seen.push({ channel: msg.channel, payload: msg.payload ?? '' });
    };
    client.on('notification', handler);
    try {
      await client.query('LISTEN workspace_events');
      const wsId = await createWorkspace(admin.sessionToken);
      createdWorkspaceIds.push(wsId);
      await putCmWorkspaceMember(wsId, member.id, 'viewer');
      const premature = await remove(wsId, admin.sessionToken);
      expect(premature.status).toBe(400);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(seen.filter((s) => s.payload.includes(wsId) && s.payload.includes('deleted'))).toHaveLength(0);
      expect(await hide(wsId, admin.sessionToken)).toMatchObject({ status: 200 });
      expect((await remove(wsId, admin.sessionToken)).status).toBe(204);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (seen.some((s) => s.payload.includes(wsId) && s.payload.includes('deleted'))) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const deleted = seen.filter((s) => s.payload.includes(wsId) && s.payload.includes('deleted'));
      expect(deleted).toHaveLength(1);
      expect(deleted[0]!.payload).toContain(member.id);
    } finally {
      client.removeListener('notification', handler);
      await client.query('UNLISTEN *').catch(() => undefined);
      client.release();
    }
  });
});
