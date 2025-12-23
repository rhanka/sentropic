import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatGenerationTraces, chatMessages, chatSessions, userSessions, users, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

describe('Admin users API (approval + disable/reactivate + delete)', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should handle the full admin users flow (list/approve/disable/reactivate/delete) without tenancy leaks', async () => {
    const suffix = createTestId();
    const admin = await createAuthenticatedUser('admin_app', `admin-users-${suffix}@example.com`);

    // --- List + approve (must not revoke sessions) ---
    const editor = await createAuthenticatedUser('editor', `editor-users-${suffix}@example.com`);

    // mark editor as pending approval
    await db
      .update(users)
      .set({
        accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(users.id, editor.id));

    const listRes = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/admin/users?status=pending_admin_approval',
      admin.sessionToken!
    );
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(Array.isArray(listData.items)).toBe(true);

    const approveRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${editor.id}/approve`,
      admin.sessionToken!,
      { role: 'editor' }
    );
    expect(approveRes.status).toBe(200);

    const [approved] = await db.select().from(users).where(eq(users.id, editor.id)).limit(1);
    expect(approved.accountStatus).toBe('active');
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(approved.approvedByUserId).toBe(admin.id);

    const editorSessions = await db.select().from(userSessions).where(eq(userSessions.userId, editor.id));
    expect(editorSessions.length).toBeGreaterThan(0);

    // --- Disable + reactivate ---
    const disableRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${editor.id}/disable`,
      admin.sessionToken!,
      { reason: 'test' }
    );
    expect(disableRes.status).toBe(200);

    const [disabled] = await db.select().from(users).where(eq(users.id, editor.id)).limit(1);
    expect(disabled.accountStatus).toBe('disabled_by_admin');
    expect(disabled.disabledAt).toBeInstanceOf(Date);
    expect(disabled.disabledReason).toBe('test');

    const reactivateRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${editor.id}/reactivate`,
      admin.sessionToken!
    );
    expect(reactivateRes.status).toBe(200);

    const [reactivated] = await db.select().from(users).where(eq(users.id, editor.id)).limit(1);
    expect(reactivated.accountStatus).toBe('active');

    // --- Delete: must require disabled, and must not 500 if admin chat sessions/traces are scoped to the user's workspace ---
    const delUser = await createAuthenticatedUser('editor', `delete-users-${suffix}@example.com`);
    await ensureWorkspaceForUser(delUser.id);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, delUser.id)).limit(1);
    expect(ws?.id).toBeTruthy();
    const wsId = ws!.id;

    // Refuse deletion if not disabled
    const refuseRes = await authenticatedRequest(app, 'DELETE', `/api/v1/admin/users/${delUser.id}`, admin.sessionToken!);
    expect(refuseRes.status).toBe(400);

    // Create admin-owned chat session scoped to that workspace + one trace referencing workspace_id
    const adminSessionId = createTestId();
    await db.insert(chatSessions).values({
      id: adminSessionId,
      userId: admin.id,
      workspaceId: wsId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const assistantMessageId = createTestId();
    await db.insert(chatMessages).values({
      id: assistantMessageId,
      sessionId: adminSessionId,
      role: 'assistant',
      content: 'placeholder',
      sequence: 1,
      createdAt: new Date(),
    });

    const traceId = createTestId();
    await db.insert(chatGenerationTraces).values({
      id: traceId,
      sessionId: adminSessionId,
      assistantMessageId,
      userId: admin.id,
      workspaceId: wsId,
      phase: 'pass1',
      iteration: 0,
      model: 'test',
      toolChoice: 'auto',
      tools: null,
      openaiMessages: [{ type: 'message', role: 'system', content: 'test' }] as any,
      toolCalls: null,
      meta: null,
      createdAt: new Date(),
    });

    // Disable user (required before deletion)
    await db
      .update(users)
      .set({ accountStatus: 'disabled_by_admin', disabledAt: new Date(), disabledReason: 'test', updatedAt: new Date() })
      .where(eq(users.id, delUser.id));

    const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/admin/users/${delUser.id}`, admin.sessionToken!);
    expect(deleteRes.status).toBe(200);

    // User + workspace deleted
    const u2 = await db.select().from(users).where(eq(users.id, delUser.id));
    expect(u2.length).toBe(0);
    const ws2 = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws2.length).toBe(0);

    // Admin session + trace are kept but detached (workspace_id NULL)
    const [s] = await db.select().from(chatSessions).where(eq(chatSessions.id, adminSessionId)).limit(1);
    expect(s).toBeTruthy();
    expect(s.workspaceId).toBeNull();

    const [t] = await db.select().from(chatGenerationTraces).where(eq(chatGenerationTraces.id, traceId)).limit(1);
    expect(t).toBeTruthy();
    expect(t.workspaceId).toBeNull();
  });
});


