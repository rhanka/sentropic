import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '@sentropic/auth-hono';
import { and, eq, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { db } from '../../db/client';
import { oauthConsents } from '../../db/schema';

interface CreateConsentStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

/**
 * Drizzle/Postgres adapter for the auth-hono `consentStore` port (consent persistence).
 *
 * ARCH-11 G1c (spec §4.2.5): grants gain a tenant leg. MODE-GATED on `TENANT_RESOLUTION_MODE`
 * (reused from G1b — no new flag):
 *  - `alias` / `shadow` (DEFAULT): the `tenantId` argument is IGNORED — reads key on
 *    `(user_id, client_id)` and writes OMIT `tenant_id` (so it takes the `'sentropic'` DEFAULT),
 *    exactly as before G1c. ZERO behavior change.
 *  - `strict` + a supplied `tenantId`: reads/writes key on `(user_id, client_id, tenant_id)`, so an
 *    org-A grant never satisfies an org-B authorize (the §1.5 cross-tenant consent bypass fix).
 *
 * `saveGrant` upserts and UNIONs the incoming scopes with any prior grant so a re-approval never
 * drops previously granted scopes.
 */
export const createConsentStoreAdapter = (
  options: CreateConsentStoreAdapterOptions = {}
): AuthHonoConsentStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());

  // Under strict with a supplied tenant, add the tenant leg to the lookup; otherwise legacy key.
  const enforceTenant = (tenantId: string | undefined): tenantId is string =>
    env.TENANT_RESOLUTION_MODE === 'strict' && typeof tenantId === 'string' && tenantId.length > 0;

  const grantFilter = (userId: string, clientId: string, tenantId: string | undefined): SQL => {
    const conditions = [eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)];
    if (enforceTenant(tenantId)) conditions.push(eq(oauthConsents.tenantId, tenantId));
    return and(...conditions) as SQL;
  };

  return {
    async getGrant(userId, clientId, tenantId): Promise<AuthHonoConsentGrant | null> {
      const [row] = await database
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenantId))
        .limit(1);
      return row ? { scopes: row.scopes } : null;
    },

    async saveGrant(userId, clientId, scopes, tenantId): Promise<void> {
      const timestamp = now();
      // Union with any prior grant so a narrower re-approval never shrinks it. The merge is done
      // in JS (read-then-upsert), NOT a raw-SQL array union: drizzle expands a JS array embedded in
      // a `sql` template as a record tuple `($1,$2,...)`, which Postgres rejects with "cannot cast
      // type record to text[]". Setting the column with a plain JS array lets drizzle bind it as a
      // proper text[]. Concurrent approvals for the same (user,client[,tenant]) are not a real
      // scenario (single user, single consent screen), so last-write-wins is safe here.
      const [existing] = await database
        .select({ scopes: oauthConsents.scopes })
        .from(oauthConsents)
        .where(grantFilter(userId, clientId, tenantId))
        .limit(1);
      const merged = Array.from(new Set([...(existing?.scopes ?? []), ...scopes]));
      await database
        .insert(oauthConsents)
        .values({
          clientId,
          createdAt: timestamp,
          scopes: merged,
          updatedAt: timestamp,
          userId,
          // ARCH-11 G1c: under strict, write the real tenant leg; otherwise omit so it takes the
          // DEFAULT ('sentropic'), byte-identical to the pre-G1c single-org behavior.
          ...(enforceTenant(tenantId) ? { tenantId } : {}),
        })
        .onConflictDoUpdate({
          set: { scopes: merged, updatedAt: timestamp },
          // The unique key is (user_id, client_id, tenant_id) (ARCH-11 G1a). When tenant_id is
          // omitted it takes the DEFAULT, so the ON CONFLICT target still matches the composite index.
          target: [oauthConsents.userId, oauthConsents.clientId, oauthConsents.tenantId],
        });
    },
  };
};
