import { desc, eq, isNull, or, and, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { workspaces } from '../db/schema';
import { findCmWorkspaceMember, listCmWorkspaceMembershipsForUser } from './identity/cm-tenancy';
import { bindCmAppDatabase, runCmIdentityRead } from './identity/cm-transaction';

// Lot A4: workspace membership lives in the CM store
// (cm_identity.cm_workspace_members); the legacy `workspace_memberships` table
// is dropped by control migration 0014. `public.workspaces` keeps the business
// columns only. No legacy fallback.

export type WorkspaceType = 'neutral' | 'ai-priorities' | 'opportunity' | 'code';

export type WorkspaceRole = 'viewer' | 'commenter' | 'editor' | 'admin';

/**
 * @deprecated kept for call-site compatibility: CM membership reads go through
 * the CM store, not a caller-supplied drizzle client.
 */
export type WorkspaceRoleClient = Pick<typeof db, 'select'>;

export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
  _client: WorkspaceRoleClient = db,
): Promise<WorkspaceRole | null> {
  const member = await findCmWorkspaceMember(workspaceId, userId);
  if (!member) return null;
  return member.role as WorkspaceRole;
}

export async function hasWorkspaceRole(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole,
  client: WorkspaceRoleClient = db,
): Promise<boolean> {
  const current = await getWorkspaceRole(userId, workspaceId, client);
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
 * Default workspace: most recently created non-hidden workspace among the
 * user's CM workspace memberships.
 */
export async function resolveDefaultWorkspaceId(userId: string): Promise<string | null> {
  return runCmIdentityRead(async tx => {
  const db = bindCmAppDatabase(tx);
  const memberships = await listCmWorkspaceMembershipsForUser(userId);
  if (memberships.length === 0) return null;
  const ids = memberships.map((m) => m.workspaceId);
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(isNull(workspaces.hiddenAt), sql`${workspaces.id} = ANY(${ids})`))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);

  return rows[0]?.id ?? null;
  });
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
  return runCmIdentityRead(async tx => {
  const db = bindCmAppDatabase(tx);
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

  const memberships = await listCmWorkspaceMembershipsForUser(userId);
  if (memberships.length === 0) return [];
  const byId = new Map(memberships.map((m) => [m.workspaceId, m.role] as const));
  const ids = [...byId.keys()];
  // Hidden workspaces are only visible to workspace admins.
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      type: workspaces.type,
      hiddenAt: workspaces.hiddenAt,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(and(sql`${workspaces.id} = ANY(${ids})`, or(isNull(workspaces.hiddenAt), sql`${workspaces.id} = ANY(${ids.filter((id) => byId.get(id) === 'admin')})`)))
    .orderBy(desc(workspaces.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    isCodeWorkspace: codeWorkspaceIds.has(r.id),
    hiddenAt: r.hiddenAt,
    createdAt: r.createdAt,
    role: (byId.get(r.id) ?? 'viewer') as WorkspaceRole,
  }));
  });
}

/**
 * Get workspace type by ID. Returns null if workspace not found.
 */
export async function getWorkspaceType(workspaceId: string): Promise<WorkspaceType | null> {
  const [ws] = await db
    .select({ type: workspaces.type })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return (ws?.type as WorkspaceType) ?? null;
}

/**
 * Returns true if the workspace is neutral.
 * Throws if the workspace is not found.
 */
export async function isNeutralWorkspace(workspaceId: string): Promise<boolean> {
  const type = await getWorkspaceType(workspaceId);
  return type === 'neutral';
}
