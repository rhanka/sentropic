import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { companies, folders, useCases, userSessions, users, workspaces } from '../../db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

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
    await db.delete(companies);
    
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
    const [companiesCount] = await db.select({ count: sql`count(*)` }).from(companies);
    const [foldersCount] = await db.select({ count: sql`count(*)` }).from(folders);
    const [useCasesCount] = await db.select({ count: sql`count(*)` }).from(useCases);
    
    return c.json({
      companies: companiesCount.count,
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

  const rows = await db
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
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      shareWithAdmin: workspaces.shareWithAdmin,
    })
    .from(users)
    .leftJoin(workspaces, eq(workspaces.ownerUserId, users.id))
    .where(parsedStatus.data ? eq(users.accountStatus, parsedStatus.data) : undefined)
    .orderBy(desc(users.createdAt));

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

  // Force re-login for immediate privilege update
  await db.delete(userSessions).where(eq(userSessions.userId, userId));

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

  await db.delete(userSessions).where(eq(userSessions.userId, userId));
  return c.json({ success: true });
});
