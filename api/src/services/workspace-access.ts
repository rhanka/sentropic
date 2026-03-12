import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { workspaceMemberships, workspaces } from '../db/schema';

export type WorkspaceRole = 'viewer' | 'commenter' | 'editor' | 'admin';

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

  const rank: Record<WorkspaceRole, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4 };
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

export async function requireWorkspaceCommenter(userId: string, workspaceId: string): Promise<void> {
  if (!(await hasWorkspaceRole(userId, workspaceId, 'commenter'))) {
    throw new Error('Workspace commenter role required');
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
    type: string;
    role: WorkspaceRole;
    isCodeWorkspace: boolean;
    hiddenAt: Date | null;
    createdAt: Date;
  }>
> {
  const vscodeWorkspaceStateRow = (await db.get(
    sql`SELECT value FROM settings WHERE key = 'vscode_project_workspace_state_v1' AND user_id = ${userId}`,
  )) as { value?: string | null } | undefined;
  let codeWorkspaceIds = new Set<string>();
  try {
    const parsed = JSON.parse(vscodeWorkspaceStateRow?.value ?? '{}') as {
      codeWorkspaceIds?: unknown;
    };
    const ids = Array.isArray(parsed?.codeWorkspaceIds)
      ? parsed.codeWorkspaceIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : [];
    codeWorkspaceIds = new Set(ids);
  } catch {
    codeWorkspaceIds = new Set();
  }

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      type: workspaces.type,
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
    type: r.type,
    isCodeWorkspace: codeWorkspaceIds.has(r.id),
    hiddenAt: r.hiddenAt,
    createdAt: r.createdAt,
    role: r.role as WorkspaceRole,
  }));
}
