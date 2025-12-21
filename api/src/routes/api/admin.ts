import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { ADMIN_WORKSPACE_ID, companies, folders, useCases, userSessions, users, workspaces } from '../../db/schema';
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

async function assertWorkspaceReadableByAdmin(workspaceId: string): Promise<void> {
  if (workspaceId === ADMIN_WORKSPACE_ID) return;
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.shareWithAdmin, true)))
    .limit(1);
  if (!ws) throw new Error('Workspace not accessible');
}

adminRouter.get('/workspaces/:id', async (c) => {
  try {
    const workspaceId = c.req.param('id');
    await assertWorkspaceReadableByAdmin(workspaceId);
    const [ws] = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        shareWithAdmin: workspaces.shareWithAdmin,
        ownerUserId: workspaces.ownerUserId,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return c.json({ message: 'Not found' }, 404);
    return c.json({ workspace: ws });
  } catch (e) {
    return c.json({ message: 'Not found' }, 404);
  }
});

adminRouter.get('/workspaces/:id/companies', async (c) => {
  try {
    const workspaceId = c.req.param('id');
    await assertWorkspaceReadableByAdmin(workspaceId);
    const rows = await db.select().from(companies).where(eq(companies.workspaceId, workspaceId));
    return c.json({ items: rows });
  } catch (e) {
    return c.json({ message: 'Not found' }, 404);
  }
});

adminRouter.get('/workspaces/:id/folders', async (c) => {
  try {
    const workspaceId = c.req.param('id');
    await assertWorkspaceReadableByAdmin(workspaceId);
    const rows = await db.select().from(folders).where(eq(folders.workspaceId, workspaceId)).orderBy(desc(folders.createdAt));
    return c.json({ items: rows });
  } catch (e) {
    return c.json({ message: 'Not found' }, 404);
  }
});

adminRouter.get('/workspaces/:id/use-cases', async (c) => {
  try {
    const workspaceId = c.req.param('id');
    await assertWorkspaceReadableByAdmin(workspaceId);
    const folderId = c.req.query('folder_id');
    const where = folderId
      ? and(eq(useCases.workspaceId, workspaceId), eq(useCases.folderId, folderId))
      : eq(useCases.workspaceId, workspaceId);
    const rows = await db.select().from(useCases).where(where).orderBy(desc(useCases.createdAt));
    return c.json({ items: rows });
  } catch (e) {
    return c.json({ message: 'Not found' }, 404);
  }
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
