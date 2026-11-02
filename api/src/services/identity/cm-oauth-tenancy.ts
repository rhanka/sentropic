import type { AuthHonoTenantPort } from '@sentropic/auth-hono';
import { createTidIssuer, IdentityCustodyErrorV1, IdentityNotFoundError,
  TenantBoundaryError, TenantNotActiveError } from '@sentropic/cluster-mesh';
import { currentCmIdentityTransaction, type CmIdentityTransaction } from './cm-transaction';

/** Protocol participants may only borrow the current request's CM transaction. */
export function requireCmOAuthTransaction(transaction?: CmIdentityTransaction): CmIdentityTransaction {
  if (!transaction || currentCmIdentityTransaction() !== transaction) {
    throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
  return transaction;
}

export const isCmTenantRefusal = (error: unknown) => error instanceof TenantBoundaryError
  || error instanceof IdentityNotFoundError || error instanceof TenantNotActiveError;

/** OAuth carries the immutable slug; CM membership records carry the registry id. */
export async function issueCmOAuthTid(transaction: CmIdentityTransaction, userId: string, slug: string) {
  const tx = requireCmOAuthTransaction(transaction);
  const tenant = await tx.stores.tenants.findTenantBySlug(slug);
  if (!tenant) throw new TenantBoundaryError();
  return createTidIssuer({ tenants: tx.stores.tenants, memberships: tx.stores.memberships })
    .issueTid({ userId, tenantId: tenant.tenantId }, new Date().toISOString());
}

export const createCmOAuthTenantPort = (transaction?: CmIdentityTransaction): AuthHonoTenantPort => ({
  async listApprovedTenantIds(userId) {
    const tx = requireCmOAuthTransaction(transaction);
    const issuer = createTidIssuer({ tenants: tx.stores.tenants, memberships: tx.stores.memberships });
    const claims: string[] = [];
    for (const member of await tx.stores.memberships.listMembershipsForUser(userId)) {
      if (member.status !== 'approved') continue;
      try {
        const claim = await issuer.issueTid({ userId, tenantId: member.tenantId }, new Date().toISOString());
        claims.push(claim.tid);
      } catch (error) {
        if (!isCmTenantRefusal(error)) throw error;
      }
    }
    return [...new Set(claims)].sort();
  },
  async isApprovedMember(userId, slug) {
    const tx = requireCmOAuthTransaction(transaction);
    try { await issueCmOAuthTid(tx, userId, slug); return true; }
    catch (error) {
      if (isCmTenantRefusal(error)) return false;
      throw error;
    }
  },
});
