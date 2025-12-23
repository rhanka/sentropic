import { db } from '../db/client';
import { workspaces, users, ADMIN_WORKSPACE_ID } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';

export const ADMIN_WORKSPACE_NAME = 'Admin Workspace';

export async function ensureAdminWorkspaceExists(): Promise<void> {
  try {
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, ADMIN_WORKSPACE_ID))
      .limit(1);

    if (ws) return;

    await db.insert(workspaces).values({
      id: ADMIN_WORKSPACE_ID,
      ownerUserId: null,
      name: ADMIN_WORKSPACE_NAME,
      shareWithAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to ensure admin workspace exists');
    throw error;
  }
}

/**
 * Try to assign the Admin Workspace to the current admin_app user (if any).
 * This is idempotent and safe to call at boot.
 */
export async function claimAdminWorkspaceOwner(): Promise<void> {
  try {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin_app'))
      .limit(1);

    if (!admin) return;

    await db
      .update(workspaces)
      .set({ ownerUserId: admin.id, updatedAt: new Date() })
      .where(eq(workspaces.id, ADMIN_WORKSPACE_ID));
  } catch (error) {
    logger.error({ err: error }, 'Failed to claim admin workspace owner');
    // non-critical
  }
}

export async function ensureWorkspaceForUser(userId: string): Promise<{ workspaceId: string }> {
  await ensureAdminWorkspaceExists();

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.role === 'admin_app') {
    await claimAdminWorkspaceOwner();
    return { workspaceId: ADMIN_WORKSPACE_ID };
  }

  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .limit(1);

  if (ws) return { workspaceId: ws.id };

  const id = crypto.randomUUID();
  await db.insert(workspaces).values({
    id,
    ownerUserId: userId,
    name: 'My Workspace',
    shareWithAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { workspaceId: id };
}


