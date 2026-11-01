import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { randomUUID } from 'node:crypto';
import { and, eq, type SQL } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthConsents, users } from '../../db/schema';

interface CreateConsentStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

/**
 * Drizzle/Postgres adapter for the auth-hono `consentStore` port (consent persistence).
 *
 * Grants use the exact user/client/tenant key. Generic scopes union under the user lock;
 * offline approval replaces its explicit scope/resource set and creates a new local epoch.
 */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());

  const grantFilter = (userId: string, clientId: string, tenantId: string | undefined): SQL => {
    const conditions = [eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)];
    conditions.push(eq(oauthConsents.tenantId, tenantId ?? 'sentropic'));
    return and(...conditions) as SQL;
  };

  return {
    async getGrant(userId, clientId, tenantId): Promise<AuthHonoConsentGrant | null> {
      const [row] = await database
        .select()
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenantId))
        .limit(1);
      return row ?? null;
    },

    async saveGrant(userId, clientId, scopes, tenantId, offline): Promise<void> {
      await database.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const timestamp = now();
      // Concurrent approvals serialize on the user row before reading the generic scope union.
      const [existing] = await tx
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenantId))
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
          tenantId: tenantId ?? 'sentropic',
        })
        .onConflictDoUpdate({
          set: { scopes: merged, updatedAt: timestamp, ...evidence },
          target: [oauthConsents.userId, oauthConsents.clientId, oauthConsents.tenantId],
        });
      });
    },
  };
};
