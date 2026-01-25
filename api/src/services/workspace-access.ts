import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { workspaceMemberships, workspaces } from '../db/schema';

export type WorkspaceRole = 'viewer' | 'editor' | 'admin';

export async function getWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const [membership] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
    .limit(1);

  if (!membership) return null;
  return membership.role as WorkspaceRole;
}

export async function hasWorkspaceRole(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole
): Promise<boolean> {
  const current = await getWorkspaceRole(userId, workspaceId);
  if (!current) return false;

  const rank: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3 };
  return rank[current] >= rank[role];
}

export async function requireWorkspaceAdmin(userId: string, workspaceId: string): Promise<void> {
  if (!(await hasWorkspaceRole(userId, workspaceId, 'admin'))) {
    throw new Error('Workspace admin role required');
  }
}

export async function requireWorkspaceEditor(userId: string, workspaceId: string): Promise<void> {
  if (!(await hasWorkspaceRole(userId, workspaceId, 'editor'))) {
    throw new Error('Workspace editor role required');
  }
}

export async function requireWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
  const role = await getWorkspaceRole(userId, workspaceId);
  if (!role) throw new Error('Workspace access required');
}

export async function isWorkspaceDeleted(workspaceId: string): Promise<boolean> {
  const [ws] = await db
    .select({ hiddenAt: workspaces.hiddenAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return !!ws?.hiddenAt;
}

/**
 * Default workspace: most recently created non-hidden workspace among memberships.
 */
export async function resolveDefaultWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(and(eq(workspaceMemberships.userId, userId), isNull(workspaces.hiddenAt)))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);

  return row?.id ?? null;
}

export async function getUserWorkspaces(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    role: WorkspaceRole;
    hiddenAt: Date | null;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      hiddenAt: workspaces.hiddenAt,
      createdAt: workspaces.createdAt,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    // Hidden workspaces are only visible to workspace admins.
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        or(isNull(workspaces.hiddenAt), eq(workspaceMemberships.role, 'admin'))
      )
    )
    .orderBy(desc(workspaces.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    hiddenAt: r.hiddenAt,
    createdAt: r.createdAt,
    role: r.role as WorkspaceRole,
  }));
}
