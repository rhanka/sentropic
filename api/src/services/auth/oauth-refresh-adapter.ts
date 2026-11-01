import type { AuthHonoPorts, OAuthRefreshLock, OAuthRefreshStorePort } from '@sentropic/auth-hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../../db/client';
import { oauthRefreshTokens } from '../../db/schema';
import { CM_IDENTITY_SCHEMA } from '../identity/cm-identity';

type Database = NodePgDatabase;
type Transaction = Database;
interface Options {
  database?: Database;
  portsForDatabase?: (database: Transaction) => AuthHonoPorts;
  transactionBound?: boolean;
}
interface Adapter extends OAuthRefreshStorePort {
  withLock<T>(lock: OAuthRefreshLock,
    work: (store: OAuthRefreshStorePort, tx: Transaction) => Promise<T>): Promise<T>;
}

// The account lock follows CM identity. A bound request borrows its current
// executor, so refresh and the auth binding commit or roll back together.

/** Client guard -> user -> durable anchor. All reads inside work see locked, current state. */
export const lockOAuthRefresh = async (database: Database, lock: OAuthRefreshLock): Promise<void> => {
  await database.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('oauth-refresh-client:' || ${lock.clientId}, 0))`);
  await database.execute(sql`SELECT "user_id" FROM ${sql.raw(CM_IDENTITY_SCHEMA)}.identity_user_accounts WHERE "user_id" = ${lock.userId} FOR UPDATE`);
  if (lock.familyId) {
    await database.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.id, lock.familyId)).for('update');
  }
};

export const createOAuthRefreshAdapter = (options: Options = {}): Adapter => {
  const database = options.database ?? db;
  const store: Omit<OAuthRefreshStorePort, 'transaction'> = {
    async findByHash(tokenHash) {
      const [row] = await database.select().from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, tokenHash)).limit(1);
      return row ?? null;
    },
    async findAnchor(familyId) {
      const [row] = await database.select().from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.id, familyId)).limit(1);
      return row ?? null;
    },
    async save(record) {
      await database.insert(oauthRefreshTokens).values(record);
    },
    async consume(id, childId, now) {
      const rows = await database.update(oauthRefreshTokens)
        .set({ consumedAt: now, replacedById: childId })
        .where(and(eq(oauthRefreshTokens.id, id), isNull(oauthRefreshTokens.consumedAt),
          isNull(oauthRefreshTokens.revokedAt))).returning({ id: oauthRefreshTokens.id });
      return rows.length === 1;
    },
    async revokeFamily(familyId, reason, now) {
      // Match public.oauth_refresh_revoke_family(): lock the anchor,
      // revoke the whole family, and tombstone still-valid access tokens.
      await database.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.id, familyId)).for('update');
      await database.execute(sql`UPDATE public.oauth_refresh_tokens SET
        revoked_at = COALESCE(revoked_at, ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
        revoked_reason = COALESCE(revoked_reason, ${reason})
        WHERE family_id = ${familyId}`);
      await database.execute(sql`INSERT INTO public.revoked_tokens (jti, client_id, user_id, tenant_id, expires_at, revoked_at)
        SELECT jti, client_id, user_id, tenant_id, expires_at, ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
        FROM public.oauth_tokens WHERE refresh_family_id = ${familyId} AND expires_at > ${now.toISOString()}::timestamptz
        ON CONFLICT (jti) DO NOTHING`);
    },
  };
  const withLock = async <T>(lock: OAuthRefreshLock,
    work: (store: OAuthRefreshStorePort, tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    if (options.transactionBound) {
      await lockOAuthRefresh(database, lock);
      return work(createOAuthRefreshAdapter({ ...options, database }), database);
    }
    return database.transaction(async (tx) => {
      await lockOAuthRefresh(tx, lock);
      return work(createOAuthRefreshAdapter({ ...options, database: tx, transactionBound: true }), tx);
    });
  };
  return {
    ...store,
    withLock,
    async transaction<T>(lock: OAuthRefreshLock, work: (ports: AuthHonoPorts) => Promise<T>): Promise<T> {
      if (!options.portsForDatabase) throw new Error('Transaction-bound OAuth ports are required.');
      return withLock(lock, (_store, tx) => work(options.portsForDatabase!(tx)));
    },
  };
};

export const purgeExpiredRefreshFamilies = async (database: Database, now: Date, transactionBound = false): Promise<number> => {
  const candidates = await database.select().from(oauthRefreshTokens)
    .where(and(eq(oauthRefreshTokens.generation, 0), sql`${oauthRefreshTokens.familyExpiresAt} < ${now}`));
  let removed = 0;
  for (const anchor of candidates) {
    removed += await createOAuthRefreshAdapter({ database, transactionBound }).withLock(anchor, async (_store, tx) => {
      const result = await tx.execute(sql`DELETE FROM public.oauth_refresh_tokens r
        WHERE r.family_id = ${anchor.id} AND r.family_expires_at < ${now}
          AND NOT EXISTS (SELECT 1 FROM public.oauth_tokens t
            WHERE t.refresh_family_id = r.family_id AND t.expires_at >= ${now}) RETURNING r.id`);
      return result.rowCount ?? 0;
    });
  }
  return removed;
};
