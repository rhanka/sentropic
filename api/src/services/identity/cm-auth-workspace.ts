import { randomUUID } from 'node:crypto';
import { createWorkspaceDirectory, IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { drizzle } from 'drizzle-orm/node-postgres';
import { workspaces, ADMIN_WORKSPACE_ID } from '../../db/schema';
import type { CmIdentityTransaction } from './cm-transaction';

/** Business provisioning called only from the CM authentication transaction. */
export async function provisionCmAuthWorkspace(userId: string, tx: CmIdentityTransaction): Promise<void> {
  await tx.lockSubject(userId);
  const account = await tx.stores.accounts.findAccount(userId);
  if (!account) throw new IdentityCustodyErrorV1('identity_material_missing');
  const tenant = await tx.stores.tenants.findTenant('sentropic');
  if (!tenant || tenant.status !== 'active') throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  const isAdmin = account.globalRole === 'admin_app';
  const { rows } = await tx.hostTransaction.query<{ id: string }>(
    `SELECT w.id FROM public.workspaces w
     JOIN cm_identity.cm_workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1 AND m.role = 'admin' AND w.hidden_at IS NULL
       AND ($2::boolean AND w.id = $3 OR NOT $2::boolean AND w.type = 'neutral')
     ORDER BY w.created_at, w.id LIMIT 1`, [userId, isAdmin, ADMIN_WORKSPACE_ID]);
  if (rows.length) return;
  const workspaceId = isAdmin ? ADMIN_WORKSPACE_ID : randomUUID();
  await tx.lockWorkspace(workspaceId);
  await drizzle(tx.hostTransaction).insert(workspaces).values({
    id: workspaceId, ownerUserId: isAdmin ? null : userId,
    name: isAdmin ? 'Admin Workspace' : 'My Workspace', type: 'neutral',
  }).onConflictDoNothing();
  const directory = createWorkspaceDirectory({ workspaces: tx.stores.workspaces,
    members: tx.stores.workspaceMembers, audit: tx.stores.audit });
  const existing = await tx.stores.workspaces.findWorkspace(workspaceId);
  if (existing) {
    if (!isAdmin || existing.tenantId !== tenant.tenantId) throw new IdentityCustodyErrorV1('identity_record_conflict');
    await directory.addWorkspaceMember({ workspaceId, userId, role: 'admin', actorId: userId });
  } else {
    await directory.enrolWorkspace({ workspaceId, tenantId: tenant.tenantId, repoIdentity: null, creatorUserId: userId });
  }
}
