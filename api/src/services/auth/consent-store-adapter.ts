import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1, oauthTenantStoreV1 } from '@sentropic/cluster-mesh';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, type SQL } from 'drizzle-orm';

import { oauthClients, oauthConsents } from '../../db/schema';
import { bindCmAppDatabase, runCmIdentityWrite, type CmIdentityTransaction } from '../identity/cm-transaction';
import { lockOAuthRefresh } from './oauth-refresh-adapter';
import { issueCmOAuthTid, isCmTenantRefusal, requireCmOAuthTransaction } from '../identity/cm-oauth-tenancy';
import { cmOAuthConsentId } from '../identity/cm-import-tenancy';
import { cmTenantlessOAuthConsentId } from './oauth-consent-key';

interface CreateConsentStoreAdapterOptions {
  transaction?: CmIdentityTransaction;
  now?: () => Date;
}

/** Protocol key (`tid` slug or null), CM authority tenant (registry id) and CM consent id. */
interface ConsentKey { readonly tid: string | null; readonly tenantId: string; readonly consentId: string }

/** A tenant claim keys on the user's approved membership; a refusal propagates. */
async function tenantConsentKey(tx: CmIdentityTransaction, userId: string, clientId: string,
  tenantSlug: string): Promise<ConsentKey> {
  const claim = await issueCmOAuthTid(tx, userId, tenantSlug);
  return { tid: claim.tid, tenantId: claim.tenantId, consentId: cmOAuthConsentId(userId, clientId, claim.tenantId) };
}

/**
 * Without a tenant claim, only a tenant-optional client keys a consent, governed by the client's own
 * active registry tenant; any other client returns null: unkeyable, no authority is conferred.
 */
async function resolveConsentKey(tx: CmIdentityTransaction, userId: string, clientId: string,
  tenantSlug: string | undefined): Promise<ConsentKey | null> {
  if (tenantSlug) return tenantConsentKey(tx, userId, clientId, tenantSlug);
  const [client] = await bindCmAppDatabase(tx)
    .select({ requireTenant: oauthClients.requireTenant, tenantId: oauthClients.tenantId })
    .from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!client || client.requireTenant || !client.tenantId) return null;
  const tenant = await tx.stores.tenants.findTenantBySlug(client.tenantId);
  if (!tenant || tenant.status !== 'active') return null;
  return { tid: null, tenantId: tenant.tenantId, consentId: cmTenantlessOAuthConsentId(userId, clientId) };
}

const grantFilter = (userId: string, clientId: string, tid: string | null): SQL => and(
  eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId),
  tid === null ? isNull(oauthConsents.tenantId) : eq(oauthConsents.tenantId, tid)) as SQL;

/**
 * The subject comes from verified application authority; no request selects another owner. Without a
 * tenant, the tenant-less key is withdrawn whatever the client policy is now (withdrawal needs no authority).
 */
export const revokeCmOAuthConsent = (input: { userId: string; clientId: string; tenantId?: string }): Promise<boolean> =>
  runCmIdentityWrite(async tx => {
    await tx.lockSubject(input.userId);
    const database = bindCmAppDatabase(tx);
    await lockOAuthRefresh(database, input);
    const key = input.tenantId ? await tenantConsentKey(tx, input.userId, input.clientId, input.tenantId)
      : { tid: null, consentId: cmTenantlessOAuthConsentId(input.userId, input.clientId) };
    const at = new Date().toISOString();
    const changed = await tx.stores.oauth.revokeConsent(key.consentId, at);
    await database.delete(oauthConsents).where(grantFilter(input.userId, input.clientId, key.tid));
    await tx.advanceSubjectRevision(input.userId, at, false);
    return changed;
  });

/** CM owns consent authority; app protocol evidence joins the same transaction. */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const now = options.now ?? (() => new Date());
  /** CM consent authority through the P4 finder; a revoked or re-homed row confers no authority. */
  const hasAuthority = async (tx: CmIdentityTransaction, key: ConsentKey) => {
    const record = await oauthTenantStoreV1(tx).findConsent(key.consentId);
    return record !== null && record.revokedAt === undefined && record.tenantId === key.tenantId;
  };

  return {
    async getGrant(userId, clientId, tenantId): Promise<AuthHonoConsentGrant | null> {
      const tx = requireCmOAuthTransaction(options.transaction);
      let key;
      try { key = await resolveConsentKey(tx, userId, clientId, tenantId); }
      catch (error) { if (isCmTenantRefusal(error)) return null; throw error; }
      if (!key || !await hasAuthority(tx, key)) return null;
      const [row] = await bindCmAppDatabase(tx)
        .select()
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, key.tid))
        .limit(1);
      return row ?? null;
    },

    async saveGrant(userId, clientId, scopes, tenantId, offline): Promise<void> {
      const identity = requireCmOAuthTransaction(options.transaction);
      if (identity.mode !== 'write') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await identity.lockSubject(userId);
      const key = await resolveConsentKey(identity, userId, clientId, tenantId);
      // An unkeyable consent (tenant-bound client, no tenant claim) persists nothing: login
      // proceeds and consent is shown every time. No authority is conferred.
      if (!key) return;
      const tx = bindCmAppDatabase(identity);
      const timestamp = now();
      // Concurrent approvals serialize on the user row before reading the generic scope union.
      const [existing] = await tx
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, key.tid))
        .limit(1);
      const live = await hasAuthority(identity, key);
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
          tenantId: key.tid,
        })
        .onConflictDoUpdate({
          set: { scopes: merged, updatedAt: timestamp, ...evidence },
          target: [oauthConsents.userId, oauthConsents.clientId, oauthConsents.tenantId],
        });
      await identity.stores.oauth.grantConsent({ consentId: key.consentId,
        userId, clientId, tenantId: key.tenantId, grantedAt: timestamp.toISOString() });
    },
  };
};
