import { db } from '../db/client';
import { workspaceMemberships, workspaces, users, ADMIN_WORKSPACE_ID } from '../db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
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

export async function ensureWorkspaceForUser(
  userId: string,
  options?: { createIfMissing?: boolean }
): Promise<{ workspaceId: string | null }> {
  const createIfMissing = options?.createIfMissing !== false;
  await ensureAdminWorkspaceExists();

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.role === 'admin_app') {
    await claimAdminWorkspaceOwner();
    const now = new Date();
    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: ADMIN_WORKSPACE_ID,
        userId,
        role: 'admin',
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { role: 'admin' },
      });
    return { workspaceId: ADMIN_WORKSPACE_ID };
  }

  // Prefer the most recently created non-hidden workspace the user is a member of.
  const [active] = await db
    .select({ id: workspaces.id })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(and(eq(workspaceMemberships.userId, userId), isNull(workspaces.hiddenAt)))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);

  if (active) return { workspaceId: active.id };

  // If all workspaces are hidden, still return the most recently created one (UI will redirect to settings).
  const [anyWs] = await db
    .select({ id: workspaces.id })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);

  if (anyWs) return { workspaceId: anyWs.id };

  if (!createIfMissing) return { workspaceId: null };

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({
      id,
      ownerUserId: userId,
      name: 'My Workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await tx.insert(workspaceMemberships).values({
      workspaceId: id,
      userId,
      role: 'admin',
      createdAt: new Date(),
    });
  });

  return { workspaceId: id };
}


