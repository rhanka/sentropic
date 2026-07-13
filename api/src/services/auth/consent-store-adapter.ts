import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { and, eq } from 'drizzle-orm';

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
      // Union with any prior grant so a narrower re-approval never shrinks it. The merge is done
      // in JS (read-then-upsert), NOT a raw-SQL array union: drizzle expands a JS array embedded in
      // a `sql` template as a record tuple `($1,$2,...)`, which Postgres rejects with "cannot cast
      // type record to text[]". Setting the column with a plain JS array lets drizzle bind it as a
      // proper text[]. Concurrent approvals for the same (user,client) are not a real scenario
      // (single user, single consent screen), so last-write-wins is safe here.
      const [existing] = await database
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
        .limit(1);
      const merged = Array.from(new Set([...(existing?.scopes ?? []), ...scopes]));
      await database
        .insert(oauthConsents)
        .values({ clientId, createdAt: timestamp, scopes: merged, updatedAt: timestamp, userId })
        .onConflictDoUpdate({
          set: { scopes: merged, updatedAt: timestamp },
          // ARCH-11 G1a (§1.5): the unique key is now (user_id, client_id, tenant_id). The insert omits
          // tenant_id so it takes the DEFAULT ('sentropic'); the ON CONFLICT target must match the new
          // composite index. Single-org behavior is unchanged (tenant is always the default here); real
          // per-tenant threading of getGrant/saveGrant is G1c.
          target: [oauthConsents.userId, oauthConsents.clientId, oauthConsents.tenantId],
        });
    },
  };
};
