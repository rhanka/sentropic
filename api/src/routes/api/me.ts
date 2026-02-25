import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import {
  chatSessions,
  chatGenerationTraces,
  chatStreamEvents,
  organizations,
  contextModificationHistory,
  emailVerificationCodes,
  folders,
  magicLinks,
  useCases,
  userSessions,
  users,
  webauthnChallenges,
  webauthnCredentials,
  workspaces,
} from '../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { settingsService } from '../../services/settings';
import {
  getModelCatalogPayload,
  inferProviderFromModelId,
  resolveDefaultSelection,
} from '../../services/model-catalog';

export const meRouter = new Hono();

meRouter.get('/', async (c) => {
  const { userId, workspaceId, role } = c.get('user');

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      accountStatus: users.accountStatus,
      approvalDueAt: users.approvalDueAt,
      approvedAt: users.approvedAt,
      approvedByUserId: users.approvedByUserId,
      disabledAt: users.disabledAt,
      disabledReason: users.disabledReason,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerUserId: workspaces.ownerUserId,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return c.json({
    user,
    workspace: ws,
    // role can be dynamically downgraded (approval expired => guest)
    effectiveRole: role,
  });
});

const patchMeSchema = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
});

const patchMyAISettingsSchema = z
  .object({
    defaultProviderId: z.enum(['openai', 'gemini']).optional(),
    defaultModel: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.defaultProviderId !== undefined || value.defaultModel !== undefined,
    { message: 'At least one field is required' }
  );

meRouter.patch('/', zValidator('json', patchMeSchema), async (c) => {
  const { userId, workspaceId } = c.get('user');
  const { workspaceName } = c.req.valid('json');

  // Only allow updates for the caller's own workspace
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)))
    .limit(1);

  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  await db
    .update(workspaces)
    .set({
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return c.json({ success: true });
});

meRouter.get('/ai-settings', async (c) => {
  const { userId } = c.get('user');

  const [currentSettings, catalog] = await Promise.all([
    settingsService.getAISettings({ userId }),
    getModelCatalogPayload({ userId }),
  ]);

  const resolved = resolveDefaultSelection(
    {
      providerId: currentSettings.defaultProviderId,
      modelId: currentSettings.defaultModel,
    },
    catalog.models
  );

  return c.json({
    defaultProviderId: resolved.provider_id,
    defaultModel: resolved.model_id,
  });
});

meRouter.put(
  '/ai-settings',
  zValidator('json', patchMyAISettingsSchema),
  async (c) => {
    const { userId } = c.get('user');
    const body = c.req.valid('json');

    const [currentSettings, catalog] = await Promise.all([
      settingsService.getAISettings({ userId }),
      getModelCatalogPayload({ userId }),
    ]);
    const inferredProviderId = inferProviderFromModelId(
      catalog.models,
      body.defaultModel ?? null
    );

    const resolved = resolveDefaultSelection(
      {
        providerId:
          body.defaultProviderId ??
          inferredProviderId ??
          currentSettings.defaultProviderId,
        modelId: body.defaultModel ?? currentSettings.defaultModel,
      },
      catalog.models
    );

    await Promise.all([
      settingsService.set(
        'default_provider_id',
        resolved.provider_id,
        'User default AI provider',
        { userId }
      ),
      settingsService.set('default_model', resolved.model_id, 'User default AI model', {
        userId,
      }),
    ]);

    return c.json({
      success: true,
      settings: {
        defaultProviderId: resolved.provider_id,
        defaultModel: resolved.model_id,
      },
    });
  }
);

meRouter.post('/deactivate', async (c) => {
  const { userId } = c.get('user');
  const now = new Date();

  await db
    .update(users)
    .set({
      accountStatus: 'disabled_by_user',
      disabledAt: now,
      disabledReason: 'user_deactivated',
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  // Revoke sessions immediately
  await db.delete(userSessions).where(eq(userSessions.userId, userId));

  return c.json({ success: true });
});

/**
 * DELETE /me
 * Immediate account suppression: delete user + workspace + all owned data.
 */
meRouter.delete('/', async (c) => {
  const { userId, workspaceId } = c.get('user');

  await db.transaction(async (tx) => {
    // Collect object IDs for stream cleanup + history cleanup
    const organizationRows = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.workspaceId, workspaceId));
    const folderRows = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.workspaceId, workspaceId));
    const useCaseRows = await tx
      .select({ id: useCases.id })
      .from(useCases)
      .where(eq(useCases.workspaceId, workspaceId));

    const organizationIds = organizationRows.map((r) => r.id);
    const folderIds = folderRows.map((r) => r.id);
    const useCaseIds = useCaseRows.map((r) => r.id);

    // Stream events for structured generations (organization_/folder_/usecase_)
    const streamIds: string[] = [];
    for (const id of organizationIds) streamIds.push(`organization_${id}`);
    for (const id of folderIds) streamIds.push(`folder_${id}`);
    for (const id of useCaseIds) streamIds.push(`usecase_${id}`);
    if (streamIds.length) {
      await tx.delete(chatStreamEvents).where(inArray(chatStreamEvents.streamId, streamIds));
    }

    // Context modification history linked to these objects
    if (organizationIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(
          and(
            eq(contextModificationHistory.contextType, 'organization'),
            inArray(contextModificationHistory.contextId, organizationIds)
          )
        );
    }
    if (folderIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(and(eq(contextModificationHistory.contextType, 'folder'), inArray(contextModificationHistory.contextId, folderIds)));
    }
    if (useCaseIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(and(eq(contextModificationHistory.contextType, 'usecase'), inArray(contextModificationHistory.contextId, useCaseIds)));
    }

    // Delete business objects (workspace scoped)
    await tx.delete(useCases).where(eq(useCases.workspaceId, workspaceId));
    await tx.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await tx.delete(organizations).where(eq(organizations.workspaceId, workspaceId));

    // Auth artifacts
    await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, userId));

    // Email/magic link artifacts (best effort)
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.email) {
      await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.email, u.email));
      await tx.delete(magicLinks).where(eq(magicLinks.email, u.email));
    }

    // IMPORTANT: This workspace can be referenced by:
    // - chat_sessions.workspace_id (including admin-owned sessions scoped to this workspace)
    // - chat_generation_traces.workspace_id
    // The FK is NO ACTION, so we must detach these references before deleting the workspace.
    await tx.update(chatSessions).set({ workspaceId: null }).where(eq(chatSessions.workspaceId, workspaceId));
    await tx.update(chatGenerationTraces).set({ workspaceId: null }).where(eq(chatGenerationTraces.workspaceId, workspaceId));

    // Delete chat sessions owned by this user (cascade deletes chat_messages/contexts)
    await tx.delete(chatSessions).where(eq(chatSessions.userId, userId));

    // Delete workspace owned by this user
    await tx.delete(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)));

    // Finally delete user
    await tx.delete(users).where(eq(users.id, userId));
  });

  return c.json({ success: true });
});
