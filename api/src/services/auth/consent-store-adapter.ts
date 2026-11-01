import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { randomUUID } from 'node:crypto';
import { and, eq, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { db } from '../../db/client';
import { oauthClients, oauthConsents, users } from '../../db/schema';

interface CreateConsentStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

/**
 * Drizzle/Postgres adapter for the auth-hono `consentStore` port (consent persistence).
 *
 * Refresh clients always use the exact tenant; other clients retain the configured tenant mode.
 * Offline approval replaces its explicit scope/resource set and creates a new local epoch.
 */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());

  const grantTenant = async (query: Pick<typeof db, 'select'>, clientId: string,
    tenantId: string | undefined, offline = false): Promise<string> => {
    if (offline || env.TENANT_RESOLUTION_MODE === 'strict') return tenantId ?? 'sentropic';
    const [client] = await query.select({ grantTypes: oauthClients.grantTypes }).from(oauthClients)
      .where(eq(oauthClients.clientId, clientId)).limit(1);
    return client?.grantTypes.includes('refresh_token') ? tenantId ?? 'sentropic' : 'sentropic';
  };

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
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
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
