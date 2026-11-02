import { db } from '../db/client';
import { workspaces, ADMIN_WORKSPACE_ID } from '../db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { logger } from '../logger';
import { findCmUserById, listCmUsers } from './identity/cm-users';
import {
  enrolCmWorkspace,
  listCmWorkspaceMembershipsForUser,
  putCmWorkspaceMember,
} from './identity/cm-tenancy';

// Lot A4: workspace membership and the workspace->tenant edge live in the CM
// stores (cm_identity.cm_workspace_members / cm_workspaces). `public.workspaces`
// keeps business rows and the destruction-policy owner reference; the legacy
// `workspace_memberships` table is dropped by control migration 0014.

export const ADMIN_WORKSPACE_NAME = 'Admin Workspace';

/** Tenant that hosts platform-level workspaces (migrated from public.tenants). */
export const PLATFORM_TENANT_ID = 'sentropic';

export async function ensureAdminWorkspaceExists(): Promise<void> {
  try {
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, ADMIN_WORKSPACE_ID))
      .limit(1);

    if (!ws) {
      await db.insert(workspaces).values({
        id: ADMIN_WORKSPACE_ID,
        name: ADMIN_WORKSPACE_NAME,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await enrolCmWorkspace({ workspaceId: ADMIN_WORKSPACE_ID, tenantId: PLATFORM_TENANT_ID });
  } catch (error) {
    logger.error({ err: error }, 'Failed to ensure admin workspace exists');
    throw error;
  }
}

/**
 * Try to assign the Admin Workspace to the current admin_app user (if any).
 * Ownership is now a CM workspace membership (role 'admin'); idempotent.
 */
export async function claimAdminWorkspaceOwner(): Promise<void> {
  try {
    const admins = (await listCmUsers()).filter((u) => u.role === 'admin_app');
    const admin = admins[0];
    if (!admin) return;

    await putCmWorkspaceMember(ADMIN_WORKSPACE_ID, admin.id, 'admin');
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

  const user = await findCmUserById(userId);

  if (user?.role === 'admin_app') {
    await claimAdminWorkspaceOwner();
    await putCmWorkspaceMember(ADMIN_WORKSPACE_ID, userId, 'admin');
    return { workspaceId: ADMIN_WORKSPACE_ID };
  }

  // Prefer the most recently created non-hidden workspace the user is a member of.
  const memberships = await listCmWorkspaceMembershipsForUser(userId);
  if (memberships.length > 0) {
    const ids = memberships.map((m) => m.workspaceId);
    const [active] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(sql`${workspaces.id} = ANY(${ids})`, isNull(workspaces.hiddenAt)))
      .orderBy(desc(workspaces.createdAt))
      .limit(1);
    if (active) return { workspaceId: active.id };

    // If all workspaces are hidden, still return the most recently created one (UI redirects to settings).
    const [anyWs] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`${workspaces.id} = ANY(${ids})`)
      .orderBy(desc(workspaces.createdAt))
      .limit(1);
    if (anyWs) return { workspaceId: anyWs.id };
  }

  if (!createIfMissing) return { workspaceId: null };

  // Auto-create a neutral workspace for the user (personal home).
  const neutralId = await ensureNeutralWorkspace(userId);
  return { workspaceId: neutralId };
}

/**
 * Ensure the user has exactly one neutral workspace.
 * Creates it (with admin membership) if missing. Returns the workspace ID.
 */
export async function ensureNeutralWorkspace(userId: string): Promise<string> {
  // A neutral workspace the user admins (CM membership + business row type).
  const memberships = await listCmWorkspaceMembershipsForUser(userId);
  if (memberships.length > 0) {
    const ids = memberships.map((m) => m.workspaceId);
    const [existing] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(sql`${workspaces.id} = ANY(${ids})`, eq(workspaces.type, 'neutral')))
      .orderBy(desc(workspaces.createdAt))
      .limit(1);

    if (existing) {
      // Ensure membership exists (idempotent)
      await putCmWorkspaceMember(existing.id, userId, 'admin');
      return existing.id;
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(workspaces).values({
    id,
    ownerUserId: userId,
    name: 'My Workspace',
    type: 'neutral',
    createdAt: now,
    updatedAt: now,
  });
  await enrolCmWorkspace({ workspaceId: id, tenantId: PLATFORM_TENANT_ID });
  await putCmWorkspaceMember(id, userId, 'admin');

  logger.info({ userId, workspaceId: id }, 'Auto-created neutral workspace for user');
  return id;
}
