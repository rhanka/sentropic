import { createTenantMemberships, createTenantOAuth, IdentityCustodyErrorV1, SelfActionForbiddenError,
  type MembershipDecision, type TenantMembershipRecord } from '@sentropic/cluster-mesh';
import { CmIdentityForbiddenError } from './cm-deletion-authorization';
import { runCmIdentityRead, runCmIdentityWrite, type CmIdentityTransaction } from './cm-transaction';

export type MembershipStatus = TenantMembershipRecord['status'];
export type { MembershipDecision } from '@sentropic/cluster-mesh';
const domain = (tx: CmIdentityTransaction) => createTenantMemberships({
  tenants: tx.stores.tenants, memberships: tx.stores.memberships, audit: tx.stores.audit,
});
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

const assertAllowed = async (callerId: string, tenantId: string, tx: CmIdentityTransaction): Promise<void> => {
  const actor = await tx.stores.accounts.findAccount(callerId);
  if (!actor || actor.accountStatus !== 'active') throw new CmIdentityForbiddenError();
  if (!await tx.custody.profiles.find(callerId)) throw new IdentityCustodyErrorV1('identity_material_missing');
  if (actor.globalRole === 'admin_app') return;
  const membership = await tx.stores.memberships.findApprovedMembership(callerId, tenantId);
  if (membership?.tenantRole !== 'admin') throw new CmIdentityForbiddenError();
};
export const assertTenantAdmin = (callerId: string, tenantId: string, _callerRole?: string) =>
  runCmIdentityRead(tx => assertAllowed(callerId, tenantId, tx));

export const requestMembership = (userId: string, tenantId: string): Promise<{ status: 'pending' }> =>
  runCmIdentityWrite(async tx => {
    await tx.lockSubject(userId);
    const opaque = { status: 'pending' as const };
    const tenant = await tx.stores.tenants.findTenant(tenantId);
    if (!tenant || tenant.status !== 'active') return opaque;
    const existing = await tx.stores.memberships.findMembership(userId, tenantId);
    if (existing && existing.status !== 'rejected') return opaque;
    const userPending = (await tx.stores.memberships.listMembershipsForUser(userId)).filter(row => row.status === 'requested').length;
    const tenantPending = (await tx.stores.memberships.listMembershipsForTenant(tenantId)).filter(row => row.status === 'requested').length;
    if (userPending >= 20 || tenantPending >= 200) return opaque;
    await domain(tx).requestMembership({ userId, tenantId });
    return opaque;
  });

export const decideMembership = (callerId: string, _callerRole: string | undefined, tenantId: string,
  targetUserId: string, decision: MembershipDecision): Promise<{ status: MembershipStatus }> => runCmIdentityWrite(async tx => {
  for (const id of sorted([callerId, targetUserId])) await tx.lockSubject(id);
  await assertAllowed(callerId, tenantId, tx);
  if (callerId === targetUserId && decision !== 'suspend') throw new SelfActionForbiddenError('approve');
  const workspaces = await tx.stores.workspaces.listWorkspacesForTenant(tenantId);
  for (const id of sorted(workspaces.map(workspace => workspace.workspaceId))) await tx.lockWorkspace(id);
  const row = await domain(tx).decideMembership({ userId: targetUserId, tenantId, actorId: callerId, decision });
  await tx.advanceSubjectRevision(targetUserId, row.updatedAt, false);
  return { status: row.status };
});

export const listTenantMemberships = (callerId: string, _callerRole: string | undefined, tenantId: string, status?: MembershipStatus) =>
  runCmIdentityRead(async tx => {
    await assertAllowed(callerId, tenantId, tx);
    const rows = await domain(tx).listMembershipsForTenant(tenantId);
    return rows.filter(row => !status || row.status === status).map(row => ({ userId: row.userId, tenantId: row.tenantId,
      status: row.status, role: row.tenantRole, requestedAt: new Date(row.updatedAt), updatedAt: new Date(row.updatedAt),
      decidedBy: row.decidedBy ?? null, decidedAt: row.decidedAt ? new Date(row.decidedAt) : null }));
  });

export const listTenantClients = (callerId: string, _callerRole: string | undefined, tenantId: string) =>
  runCmIdentityRead(async tx => {
    await assertAllowed(callerId, tenantId, tx);
    const bindings = await createTenantOAuth({ oauth: tx.stores.oauth }).listTenantOAuthClients(tenantId);
    const result = await tx.hostTransaction.query<{
      client_id: string; name: string | null; redirect_uris: string[]; token_endpoint_auth_method: string;
    }>(`SELECT client_id, name, redirect_uris, token_endpoint_auth_method FROM public.oauth_clients
      WHERE client_id = ANY($1::text[]) ORDER BY client_id COLLATE "C"`, [bindings.map(row => row.clientId)]);
    return result.rows.map(row => ({ clientId: row.client_id, name: row.name, redirectUris: row.redirect_uris,
      tokenEndpointAuthMethod: row.token_endpoint_auth_method }));
  });
