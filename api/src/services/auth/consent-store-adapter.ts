import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthConsents } from '../../db/schema';

interface CreateConsentStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

/**
 * Drizzle/Postgres adapter for the auth-hono `consentStore` port (consent persistence).
 * Grants are bound to the exact `(user_id, client_id)`; `saveGrant` upserts and UNIONs the
 * incoming scopes with any prior grant so a re-approval never drops previously granted scopes.
 */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());

  return {
    async getGrant(userId, clientId): Promise<AuthHonoConsentGrant | null> {
      const [row] = await database
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
        .limit(1);
      return row ? { scopes: row.scopes } : null;
    },

    async saveGrant(userId, clientId, scopes): Promise<void> {
      const timestamp = now();
      // Upsert + union: on conflict, merge the existing scopes with the new ones (dedup), so a
      // narrower re-approval never shrinks the grant. ARRAY(... DISTINCT UNNEST) builds the union.
      await database
        .insert(oauthConsents)
        .values({ clientId, createdAt: timestamp, scopes, updatedAt: timestamp, userId })
        .onConflictDoUpdate({
          set: {
            scopes: sql`ARRAY(SELECT DISTINCT unnest(${oauthConsents.scopes} || ${scopes}::text[]))`,
            updatedAt: timestamp,
          },
          target: [oauthConsents.userId, oauthConsents.clientId],
        });
    },
  };
};
