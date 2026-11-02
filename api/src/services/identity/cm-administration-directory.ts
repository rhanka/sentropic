import { CmIdentityForbiddenError } from './cm-deletion-authorization';
import { runCmIdentityRead } from './cm-transaction';
import { listCmUsers } from './cm-users';

/** Current role, profiles and the business display projection share one read snapshot. */
export const listCmAdminUserViews = (actorId: string, status?: string) => runCmIdentityRead(async tx => {
  const actor = await tx.stores.accounts.findAccount(actorId);
  if (!actor || actor.accountStatus !== 'active' || actor.globalRole !== 'admin_app') throw new CmIdentityForbiddenError();
  const users = (await listCmUsers()).filter(user => !status || user.accountStatus === status)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const result = await tx.hostTransaction.query<{ user_id: string; workspace_id: string; name: string | null }>(`
    SELECT m.user_id, m.workspace_id, w.name FROM cm_identity.cm_workspace_members m
    JOIN public.workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ANY($1::text[]) AND m.role = 'admin' ORDER BY w.created_at DESC, w.id COLLATE "C"`,
  [users.map(user => user.id)]);
  // This is display membership, never the business destruction policy.
  const latest = new Map<string, { id: string; name: string | null }>();
  for (const row of result.rows) if (!latest.has(row.user_id)) latest.set(row.user_id, { id: row.workspace_id, name: row.name });
  return users.map(user => ({ ...user, workspaceId: latest.get(user.id)?.id ?? null,
    workspaceName: latest.get(user.id)?.name ?? null }));
});
