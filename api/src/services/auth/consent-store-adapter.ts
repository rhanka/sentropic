import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1, oauthTenantStoreV1 } from '@sentropic/cluster-mesh';
import { randomUUID } from 'node:crypto';
import { and, eq, type SQL } from 'drizzle-orm';

import { oauthConsents } from '../../db/schema';
import { bindCmAppDatabase, type CmIdentityTransaction } from '../identity/cm-transaction';
import { issueCmOAuthTid, isCmTenantRefusal, requireCmOAuthTransaction } from '../identity/cm-oauth-tenancy';
import { cmOAuthConsentId } from '../identity/cm-import-tenancy';

interface CreateConsentStoreAdapterOptions {
  transaction?: CmIdentityTransaction;
  now?: () => Date;
}

/** CM owns consent authority; app protocol evidence joins the same transaction. */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const now = options.now ?? (() => new Date());
  /** CM consent authority through the P4 finder; a revoked row confers no authority. */
  const hasAuthority = async (tx: CmIdentityTransaction, userId: string, clientId: string, tenantId: string) => {
    const record = await oauthTenantStoreV1(tx).findConsent(cmOAuthConsentId(userId, clientId, tenantId));
    return record?.revokedAt === undefined;
  };

  const grantFilter = (userId: string, clientId: string, tenantId: string): SQL => {
    const conditions = [eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)];
    conditions.push(eq(oauthConsents.tenantId, tenantId));
    return and(...conditions) as SQL;
  };

  return {
    async getGrant(userId, clientId, tenantId): Promise<AuthHonoConsentGrant | null> {
      const tx = requireCmOAuthTransaction(options.transaction);
      if (!tenantId) return null;
      let claim;
      try { claim = await issueCmOAuthTid(tx, userId, tenantId); }
      catch (error) { if (isCmTenantRefusal(error)) return null; throw error; }
      if (!await hasAuthority(tx, userId, clientId, claim.tenantId)) return null;
      const [row] = await bindCmAppDatabase(tx)
        .select()
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, claim.tid))
        .limit(1);
      return row ?? null;
    },

    async saveGrant(userId, clientId, scopes, tenantId, offline): Promise<void> {
      const identity = requireCmOAuthTransaction(options.transaction);
      if (identity.mode !== 'write') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      if (!tenantId) throw new IdentityCustodyErrorV1('identity_material_invalid');
      await identity.lockSubject(userId);
      const claim = await issueCmOAuthTid(identity, userId, tenantId);
      const tenant = claim.tid;
      const tx = bindCmAppDatabase(identity);
      const timestamp = now();
      // Concurrent approvals serialize on the user row before reading the generic scope union.
      const [existing] = await tx
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenant))
        .limit(1);
      const live = await hasAuthority(identity, userId, clientId, claim.tenantId);
      const merged = Array.from(new Set([...(live ? existing?.scopes ?? [] : []), ...scopes]));
      // A new approval replaces the offline set and epoch; online unions confer no offline authority.
      const evidence = offline ? {
        offlineGrantId: randomUUID(), offlineIssuer: offline.issuer, offlineScopes: scopes,
        approvedResources: offline.resource ? [offline.resource] : [],
        defaultAudienceApproved: offline.resource === null, offlineConsentedAt: timestamp,
      } : live ? {} : {
        offlineGrantId: null, offlineIssuer: null, offlineScopes: [], approvedResources: [],
        defaultAudienceApproved: false, offlineConsentedAt: null,
      };
      await tx
        .insert(oauthConsents)
        .values({
          clientId,
          createdAt: timestamp,
          scopes: merged,
          updatedAt: timestamp,
          userId,
          ...evidence,
          tenantId: tenant,
        })
        .onConflictDoUpdate({
          set: { scopes: merged, updatedAt: timestamp, ...evidence },
          target: [oauthConsents.userId, oauthConsents.clientId, oauthConsents.tenantId],
        });
      await identity.stores.oauth.grantConsent({ consentId: cmOAuthConsentId(userId, clientId, claim.tenantId),
        userId, clientId, tenantId: claim.tenantId, grantedAt: timestamp.toISOString() });
    },
  };
};
