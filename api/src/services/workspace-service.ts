import { workspaces, ADMIN_WORKSPACE_ID } from '../db/schema';
import { and, desc, isNull, sql } from 'drizzle-orm';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { findCmUserById } from './identity/cm-users';
import { listCmWorkspaceMembershipsForUser } from './identity/cm-tenancy';
import { bindCmAppDatabase, runCmIdentityRead } from './identity/cm-transaction';

// Lot A4: workspace membership and the workspace->tenant edge live in the CM
// stores (cm_identity.cm_workspace_members / cm_workspaces). `public.workspaces`
// keeps business rows and the destruction-policy owner reference; the legacy
// `workspace_memberships` table is dropped by control migration 0014.

export const ADMIN_WORKSPACE_NAME = 'Admin Workspace';

/** Tenant that hosts platform-level workspaces (migrated from public.tenants). */
export const PLATFORM_TENANT_ID = 'sentropic';

const findExistingWorkspace = (userId: string): Promise<{ workspaceId: string | null }> => runCmIdentityRead(async tx => {
  const db = bindCmAppDatabase(tx);
  const user = await findCmUserById(userId);

  const memberships = await listCmWorkspaceMembershipsForUser(userId);
  if (user?.role === 'admin_app' && memberships.some(row => row.workspaceId === ADMIN_WORKSPACE_ID && row.role === 'admin')) {
    return { workspaceId: ADMIN_WORKSPACE_ID };
  }

  // Prefer the most recently created non-hidden workspace the user is a member of.
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

  return { workspaceId: null };
});

/** Request middleware passes createIfMissing:false and performs no identity writes. */
export async function ensureWorkspaceForUser(userId: string, options?: { createIfMissing?: boolean }) {
  const existing = await findExistingWorkspace(userId);
  if (existing.workspaceId || options?.createIfMissing === false) return existing;
  return { workspaceId: await ensureNeutralWorkspace(userId) };
}

/**
 * Ensure the user has exactly one neutral workspace.
 * Creates it (with admin membership) if missing. Returns the workspace ID.
 */
export async function ensureNeutralWorkspace(userId: string): Promise<string> {
  const { withAppCmAuth } = await import('./identity/cm-auth-runtime');
  const { provisionCmAuthWorkspace } = await import('./identity/cm-auth-workspace');
  return withAppCmAuth(runner => runner.request(async (_binding, tx) => {
    await provisionCmAuthWorkspace(userId, tx);
    const account = await tx.stores.accounts.findAccount(userId);
    const { rows } = await tx.hostTransaction.query<{ id: string }>(`SELECT w.id FROM public.workspaces w
      JOIN cm_identity.cm_workspace_members m ON m.workspace_id = w.id
      WHERE m.user_id = $1 AND m.role = 'admin' AND w.hidden_at IS NULL
        AND ($2::boolean AND w.id = $3 OR NOT $2::boolean AND w.type = 'neutral')
      ORDER BY w.created_at, w.id LIMIT 1`, [userId, account?.globalRole === 'admin_app', ADMIN_WORKSPACE_ID]);
    if (!rows[0]) throw new IdentityCustodyErrorV1('identity_material_missing');
    return rows[0].id;
  }));
}
