import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders, organizations, useCases, userSessions, users, workspaces } from '../../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  chatGenerationTraces,
  chatSessions,
  chatStreamEvents,
  contextModificationHistory,
  emailVerificationCodes,
  jobQueue,
  magicLinks,
  webauthnChallenges,
  webauthnCredentials
} from '../../db/schema';

export const adminRouter = new Hono();

const userRoleSchema = z.enum(['admin_app', 'admin_org', 'editor', 'guest']);
const userStatusSchema = z.enum([
  'active',
  'pending_admin_approval',
  'approval_expired_readonly',
  'disabled_by_user',
  'disabled_by_admin',
]);

adminRouter.post('/reset', async (c) => {
  try {
    // Supprimer toutes les données dans l'ordre inverse des dépendances
    await db.delete(useCases);
    await db.delete(folders);
    await db.delete(organizations);
    
    return c.json({ 
      message: 'All data has been reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting data:', error);
    return c.json(
      { 
        message: 'Failed to reset data', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

adminRouter.get('/stats', async (c) => {
  try {
    const [organizationsCount] = await db.select({ count: sql`count(*)` }).from(organizations);
    const [foldersCount] = await db.select({ count: sql`count(*)` }).from(folders);
    const [useCasesCount] = await db.select({ count: sql`count(*)` }).from(useCases);
    
    return c.json({
      organizations: organizationsCount.count,
      folders: foldersCount.count,
      useCases: useCasesCount.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return c.json(
      { 
        message: 'Failed to get statistics', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

adminRouter.get('/users', async (c) => {
  const status = c.req.query('status');
  const parsedStatus = status ? userStatusSchema.safeParse(status) : { success: true as const, data: undefined };
  if (!parsedStatus.success) return c.json({ error: 'Invalid status' }, 400);

  const usersRows = await db
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
    .where(parsedStatus.data ? eq(users.accountStatus, parsedStatus.data) : undefined)
    .orderBy(desc(users.createdAt));

  // Since workspaces are no longer 1:1 with owner_user_id, a join would duplicate users.
  // For admin UI display, attach the most recently created owned workspace (if any) without duplicating user rows.
  const ownerIds = usersRows.map((u) => u.id);
  const wsRows =
    ownerIds.length === 0
      ? []
      : await db
          .select({
            ownerUserId: workspaces.ownerUserId,
            id: workspaces.id,
            name: workspaces.name,
            createdAt: workspaces.createdAt,
          })
          .from(workspaces)
          .where(inArray(workspaces.ownerUserId, ownerIds))
          .orderBy(desc(workspaces.createdAt));

  const latestWsByOwner = new Map<string, { id: string; name: string | null }>();
  for (const row of wsRows) {
    const ownerId = row.ownerUserId;
    if (!ownerId) continue;
    if (!latestWsByOwner.has(ownerId)) {
      latestWsByOwner.set(ownerId, { id: row.id, name: row.name });
    }
  }

  const items = usersRows.map((u) => {
    const ws = latestWsByOwner.get(u.id);
    return {
      ...u,
      workspaceId: ws?.id ?? null,
      workspaceName: ws?.name ?? null,
    };
  });

  return c.json({ items });
});

adminRouter.get('/workspaces', async (c) => {
  // List all workspaces (admin_app can see all)
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerUserId: workspaces.ownerUserId,
      ownerEmail: users.email,
    })
    .from(workspaces)
    .leftJoin(users, eq(workspaces.ownerUserId, users.id))
    .orderBy(desc(workspaces.createdAt));

  return c.json({ items: rows });
});

const approveSchema = z.object({
  role: userRoleSchema.optional(),
});

adminRouter.post('/users/:id/approve', zValidator('json', approveSchema), async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');
  const { role } = c.req.valid('json');
  const now = new Date();

  if (userId === admin.userId) {
    return c.json({ error: 'Cannot approve self' }, 400);
  }

  // Approve: set active + audit fields, optionally adjust role
  await db
    .update(users)
    .set({
      ...(role ? { role } : {}),
      accountStatus: 'active',
      approvalDueAt: null,
      approvedAt: now,
      approvedByUserId: admin.userId,
      disabledAt: null,
      disabledReason: null,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return c.json({ success: true });
});

const disableSchema = z.object({
  reason: z.string().max(256).optional(),
});

adminRouter.post('/users/:id/disable', zValidator('json', disableSchema), async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');
  const { reason } = c.req.valid('json');
  const now = new Date();

  if (userId === admin.userId) {
    return c.json({ error: 'Cannot disable self' }, 400);
  }

  // Safety: never allow disabling platform/org admins.
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin_app' || target.role === 'admin_org') {
    return c.json({ error: 'Cannot disable admin users' }, 400);
  }

  await db
    .update(users)
    .set({
      accountStatus: 'disabled_by_admin',
      disabledAt: now,
      disabledReason: reason ?? 'disabled_by_admin',
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  await db.delete(userSessions).where(eq(userSessions.userId, userId));
  return c.json({ success: true });
});

adminRouter.post('/users/:id/reactivate', async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');
  const now = new Date();

  if (userId === admin.userId) {
    return c.json({ error: 'Cannot reactivate self' }, 400);
  }

  await db
    .update(users)
    .set({
      accountStatus: 'active',
      approvalDueAt: null,
      approvedAt: now,
      approvedByUserId: admin.userId,
      disabledAt: null,
      disabledReason: null,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  return c.json({ success: true });
});

/**
 * DELETE /admin/users/:id
 * Immediate suppression: delete user + workspace + all owned data.
 * Safety: user must be disabled first.
 */
adminRouter.delete('/users/:id', async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');

  if (userId === admin.userId) {
    return c.json({ error: 'Cannot delete self' }, 400);
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, email: users.email, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin_app' || target.role === 'admin_org') {
    return c.json({ error: 'Cannot delete admin users' }, 400);
  }
  if (target.accountStatus !== 'disabled_by_admin' && target.accountStatus !== 'disabled_by_user') {
    return c.json({ error: 'User must be disabled before deletion' }, 400);
  }

  // Workspace owned by the user (should be 1:1)
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .limit(1);
  const workspaceId = ws?.id ?? null;

  await db.transaction(async (tx) => {
    if (workspaceId) {
      // IMPORTANT: A workspace can be referenced by:
      // - chat_sessions.workspace_id (including admin-owned sessions scoped to this workspace)
      // - chat_generation_traces.workspace_id
      // The FK is NO ACTION, so we must detach these references before deleting the workspace.
      await tx.update(chatSessions).set({ workspaceId: null }).where(eq(chatSessions.workspaceId, workspaceId));
      await tx.update(chatGenerationTraces).set({ workspaceId: null }).where(eq(chatGenerationTraces.workspaceId, workspaceId));

      // Collect object IDs for stream cleanup + history cleanup
      const organizationRows = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.workspaceId, workspaceId));
      const folderRows = await tx.select({ id: folders.id }).from(folders).where(eq(folders.workspaceId, workspaceId));
      const useCaseRows = await tx.select({ id: useCases.id }).from(useCases).where(eq(useCases.workspaceId, workspaceId));

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
      await tx.delete(jobQueue).where(eq(jobQueue.workspaceId, workspaceId));

      // Delete workspace
      await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }

    // Auth artifacts
    await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, userId));

    // Email/magic link artifacts (best effort)
    if (target.email) {
      await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.email, target.email));
      await tx.delete(magicLinks).where(eq(magicLinks.email, target.email));
    }

    // Delete chat sessions (cascade deletes chat_messages/contexts; stream events with messageId also cascade)
    await tx.delete(chatSessions).where(eq(chatSessions.userId, userId));

    // Finally delete user
    await tx.delete(users).where(eq(users.id, userId));
  });

  return c.json({ success: true });
});
