import type { AuthHonoPorts, OAuthRefreshLock, OAuthRefreshStorePort } from '@sentropic/auth-hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { oauthRefreshTokens, users } from '../../db/schema';

type Database = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface Options {
  database?: Database;
  portsForDatabase?: (database: Transaction) => AuthHonoPorts;
}
interface Adapter extends OAuthRefreshStorePort {
  withLock<T>(lock: OAuthRefreshLock,
    work: (store: OAuthRefreshStorePort, tx: Transaction) => Promise<T>): Promise<T>;
}

/** Client guard -> user -> durable anchor. All reads inside work see locked, current state. */
export const lockOAuthRefresh = async (database: Database, lock: OAuthRefreshLock): Promise<void> => {
  await database.execute(sql`SELECT public.oauth_refresh_client_guard(${lock.clientId})`);
  await database.select({ id: users.id }).from(users).where(eq(users.id, lock.userId)).for('update');
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
      await database.execute(sql`SELECT public.oauth_refresh_revoke_family(
        ${familyId}, ${reason}, ${now.toISOString()}::timestamp)`);
    },
  };
  const withLock = async <T>(lock: OAuthRefreshLock,
    work: (store: OAuthRefreshStorePort, tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    // A nested port is already inside the owning transaction; never open another connection.
    if (!('transaction' in database)) throw new Error('Refresh transaction must start at the root port.');
    return (database as typeof db).transaction(async (tx) => {
      await lockOAuthRefresh(tx, lock);
      return work(createOAuthRefreshAdapter({ ...options, database: tx }), tx);
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
