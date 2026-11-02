import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../utils/zod-validator';
import { db } from '../../db/client';
import { folders, organizations, initiatives, workspaces } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { getTenantResolutionMetrics } from '../../services/tenancy/tenant-resolution-metrics';
import { revokeAllSessions } from '../../services/session-manager';
import { remoteRevocationError } from '../../services/auth/remote-revocation-error';
import { findCmUserById, listCmUsers, updateCmUser } from '../../services/identity/cm-users';
import { cmStoreClient } from '../../services/identity/cm-identity';
import { deleteCmAccountAsAdmin } from '../../services/identity/cm-account-deletion';
import { runCmAccountDeletionHttp } from './auth/cm-deletion-http';

// Lot A4: the identity parts of this router run over the CM stores — user
// listing/approval/disable read and write cm_identity via the cm-users facade,
// and account deletion goes through the A2.3 atomic cascade. The legacy
// public.users / user_sessions / webauthn_* / magic_links tables are dropped
// by control migration 0014. Business-data endpoints (/reset, /stats) are
// unchanged.

export const adminRouter = new Hono();
adminRouter.onError(remoteRevocationError);
export const tenantResolutionMetricsRouter = new Hono();

tenantResolutionMetricsRouter.get('/', (c) => c.json(getTenantResolutionMetrics()));

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
    await db.delete(initiatives);
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
    const [initiativesCount] = await db.select({ count: sql`count(*)` }).from(initiatives);

    return c.json({
      organizations: organizationsCount.count,
      folders: foldersCount.count,
      initiatives: initiativesCount.count,
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

  const usersRows = (await listCmUsers())
    .filter((u) => !parsedStatus.data || u.accountStatus === parsedStatus.data)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Workspace ownership now lives in the CM workspace directory
  // (cm_workspace_members); attach each user's first admin workspace without
  // duplicating user rows.
  const ownerIds = usersRows.map((u) => u.id);
  const wsRows =
    ownerIds.length === 0
      ? []
      : (
          await cmStoreClient.query(
            `SELECT m.user_id, m.workspace_id, w.name, w.created_at
             FROM "cm_identity"."cm_workspace_members" m
             JOIN public.workspaces w ON w.id = m.workspace_id
             WHERE m.user_id = ANY($1) AND m.role = 'admin'
             ORDER BY w.created_at DESC`,
            [ownerIds],
          )
        ).rows;

  const latestWsByOwner = new Map<string, { id: string; name: string | null }>();
  for (const row of wsRows) {
    const ownerId = String(row.user_id);
    if (!latestWsByOwner.has(ownerId)) {
      latestWsByOwner.set(ownerId, { id: String(row.workspace_id), name: (row.name as string | null) ?? null });
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
  const updated = await updateCmUser(userId, {
    ...(role ? { role } : {}),
    accountStatus: 'active',
    approvalDueAt: null,
    approvedAt: now,
    approvedByUserId: admin.userId,
    disabledAt: null,
    disabledReason: null,
    updatedAt: now,
  });
  if (!updated) return c.json({ error: 'User not found' }, 404);

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
  const target = await findCmUserById(userId);
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin_app' || target.role === 'admin_org') {
    return c.json({ error: 'Cannot disable admin users' }, 400);
  }

  await updateCmUser(userId, {
    accountStatus: 'disabled_by_admin',
    disabledAt: now,
    disabledReason: reason ?? 'disabled_by_admin',
    updatedAt: now,
  });

  await revokeAllSessions(userId);
  return c.json({ success: true });
});

adminRouter.post('/users/:id/reactivate', async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');
  const now = new Date();

  if (userId === admin.userId) {
    return c.json({ error: 'Cannot reactivate self' }, 400);
  }

  const updated = await updateCmUser(userId, {
    accountStatus: 'active',
    approvalDueAt: null,
    approvedAt: now,
    approvedByUserId: admin.userId,
    disabledAt: null,
    disabledReason: null,
    updatedAt: now,
  });
  if (!updated) return c.json({ error: 'User not found' }, 404);
  return c.json({ success: true });
});

/**
 * DELETE /admin/users/:id
 * Immediate suppression through the A2.3 atomic cascade: identity AND business
 * rows are removed in one transaction; a failure rolls back everything.
 * Safety: user must be disabled first and must not be a platform/org admin.
 */
adminRouter.delete('/users/:id', async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');

  return runCmAccountDeletionHttp(c, operationId => deleteCmAccountAsAdmin({
    userId,
    actorId: admin.userId,
  }, operationId));
});
