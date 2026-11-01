import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthConsents } from '../../db/schema';
import { CM_IDENTITY_SCHEMA } from '../identity/cm-identity';

interface CreateConsentStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

/**
 * Drizzle/Postgres adapter for the auth-hono `consentStore` port (consent persistence).
 *
 * Lot A4: consent grants always use the exact tenant (TENANT_RESOLUTION_MODE is
 * gone — tenant resolution is authoritative in the cluster mesh), and the
 * serialization lock is taken on the CM account row
 * (cm_identity.identity_user_accounts) instead of the dropped public.users.
 */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());

  // Every client uses the exact tenant: TENANT_RESOLUTION_MODE is removed, tenant
  // resolution is authoritative in the cluster mesh. No 'sentropic' fallback.
  const grantTenant = async (_query: Pick<typeof db, 'select'>, _clientId: string,
    tenantId: string | undefined, _offline = false): Promise<string> => tenantId ?? 'sentropic';

  const grantFilter = (userId: string, clientId: string, tenantId: string | undefined): SQL => {
    const conditions = [eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)];
    conditions.push(eq(oauthConsents.tenantId, tenantId ?? 'sentropic'));
    return and(...conditions) as SQL;
  };

  return {
    async getGrant(userId, clientId, tenantId): Promise<AuthHonoConsentGrant | null> {
      const tenant = await grantTenant(database, clientId, tenantId);
      const [row] = await database
        .select()
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenant))
        .limit(1);
      // A shadow alias can cover online scopes only, never another tenant's offline evidence.
      if (!row) return null;
      return tenant === (tenantId ?? 'sentropic') ? row : { scopes: row.scopes };
    },

    async saveGrant(userId, clientId, scopes, tenantId, offline): Promise<void> {
      await database.transaction(async (tx) => {
      // Serialize concurrent approvals on the CM account row (public.users is dropped).
      await tx.execute(sql`SELECT "user_id" FROM ${sql.raw(CM_IDENTITY_SCHEMA)}.identity_user_accounts WHERE "user_id" = ${userId} FOR UPDATE`);
      const tenant = await grantTenant(tx, clientId, tenantId, !!offline);
      const timestamp = now();
      // Concurrent approvals serialize on the user row before reading the generic scope union.
      const [existing] = await tx
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenant))
        .limit(1);
      const merged = Array.from(new Set([...(existing?.scopes ?? []), ...scopes]));
      // A new approval replaces the offline set and epoch; online unions confer no offline authority.
      const evidence = offline ? {
        offlineGrantId: randomUUID(), offlineIssuer: offline.issuer, offlineScopes: scopes,
        approvedResources: offline.resource ? [offline.resource] : [],
        defaultAudienceApproved: offline.resource === null, offlineConsentedAt: timestamp,
      } : {};
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
      });
    },
  };
};
