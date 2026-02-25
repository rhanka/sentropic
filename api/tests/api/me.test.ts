import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatGenerationTraces, chatMessages, chatSessions, organizations, folders, settings, useCases, workspaces } from '../../src/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';

describe('Me API', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should return current user + workspace', async () => {
    const user = await createAuthenticatedUser('editor');
    const res = await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBe(user.id);
    expect(data.workspace.id).toBeDefined();
  });

  it('should allow renaming workspace', async () => {
    const user = await createAuthenticatedUser('editor');
    const res = await authenticatedRequest(app, 'PATCH', '/api/v1/me', user.sessionToken!, { workspaceName: 'Workspace Renamed' });
    expect(res.status).toBe(200);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id)).limit(1);
    expect(ws.name).toBe('Workspace Renamed');
  });

  it('should read/write user-scoped AI defaults', async () => {
    const user = await createAuthenticatedUser('editor');

    const initial = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/me/ai-settings',
      user.sessionToken!
    );
    expect(initial.status).toBe(200);
    const initialData = await initial.json();
    expect(initialData.defaultProviderId).toBe('openai');
    expect(initialData.defaultModel).toBe('gpt-4.1-nano');

    const update = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/me/ai-settings',
      user.sessionToken!,
      { defaultModel: 'gemini-3.1-pro-preview-customtools' }
    );
    expect(update.status).toBe(200);
    const updateData = await update.json();
    expect(updateData.settings.defaultProviderId).toBe('gemini');
    expect(updateData.settings.defaultModel).toBe(
      'gemini-3.1-pro-preview-customtools'
    );

    const rows = await db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.userId, user.id),
          eq(settings.key, 'default_model')
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('gemini-3.1-pro-preview-customtools');

    const globalDefaultModelRows = await db
      .select()
      .from(settings)
      .where(and(isNull(settings.userId), eq(settings.key, 'default_model')));
    if (globalDefaultModelRows.length > 0) {
      expect(globalDefaultModelRows[0].value).toBe('gpt-4.1-nano');
    }

    const anotherUser = await createAuthenticatedUser('editor');
    const anotherSettings = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/me/ai-settings',
      anotherUser.sessionToken!
    );
    expect(anotherSettings.status).toBe(200);
    const anotherData = await anotherSettings.json();
    expect(anotherData.defaultProviderId).toBe('openai');
    expect(anotherData.defaultModel).toBe('gpt-4.1-nano');
  });

  it('should delete user workspace data on DELETE /me', async () => {
    const user = await createAuthenticatedUser('editor');

    // Trigger auth middleware which ensures workspace exists
    const meRes = await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    const wsId = meData.workspace.id as string;

    const organizationId = createTestId();
    const folderId = createTestId();
    const useCaseId = createTestId();

    await db.insert(organizations).values({ id: organizationId, workspaceId: wsId, name: `O ${createTestId()}` });
    await db.insert(folders).values({ id: folderId, workspaceId: wsId, name: `F ${createTestId()}`, status: 'completed' });
    await db.insert(useCases).values({ id: useCaseId, workspaceId: wsId, folderId, data: { name: 'UC' } as any, status: 'completed' });

    const del = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(del.status).toBe(200);

    const remainingOrgs = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    expect(remainingOrgs.length).toBe(0);
  });

  it('should delete /me even if an admin chat session + trace are scoped to the user workspace (no FK 500)', async () => {
    const suffix = createTestId();
    const admin = await createAuthenticatedUser('admin_app', `admin-delme-${suffix}@example.com`);
    const user = await createAuthenticatedUser('editor', `user-delme-${suffix}@example.com`);

    // Ensure workspace exists and capture its ID
    const meRes = await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    const wsId = meData.workspace.id as string;

    // Create an admin-owned chat session scoped to the user's workspace
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

    const del = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(del.status).toBe(200);

    // Workspace removed
    const remainingWs = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(remainingWs.length).toBe(0);

    // Admin session kept, but detached from deleted workspace
    const [s] = await db.select().from(chatSessions).where(eq(chatSessions.id, adminSessionId)).limit(1);
    expect(s).toBeTruthy();
    expect(s.workspaceId).toBeNull();

    // Trace kept, but detached from deleted workspace
    const [t] = await db.select().from(chatGenerationTraces).where(eq(chatGenerationTraces.id, traceId)).limit(1);
    expect(t).toBeTruthy();
    expect(t.workspaceId).toBeNull();
  });
});

