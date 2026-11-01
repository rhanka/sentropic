import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { createPostgresIdentityUnitOfWorkV1, IdentityCustodyErrorV1,
  type IdentityTransactionV1, type PostgresIdentityHostV1 } from '@sentropic/cluster-mesh';
import { pool, type db } from '../../db/client';

export type CmIdentityTransaction = IdentityTransactionV1<PoolClient>;
export const cmRequestWriteOptions = {
  mode: 'write', purpose: 'request', deadlineMs: 10_000, maxAttempts: 3,
} as const;
export const cmRequestReadOptions = {
  mode: 'read', purpose: 'request', deadlineMs: 10_000, maxAttempts: 3,
} as const;

/** r6 §6.4: every CM slice and app participant borrows this one connection. */
const host: PostgresIdentityHostV1<PoolClient> = {
  async runSerializable(options, operation) {
    const client = await pool.connect();
    let committing = false;
    let failure: Error | undefined;
    try {
      await client.query(options.readOnly ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'
        : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(options.deadlineMs)]);
      const result = await operation({
        transactionId: randomUUID(), hostTransaction: client, readOnly: options.readOnly,
        session: { async execute(statement) {
          const result = await client.query(statement.text, [...statement.values ?? []]);
          return { rows: result.rows, rowCount: result.rowCount };
        } },
      });
      committing = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Identity transaction failed');
      try { await client.query('ROLLBACK'); } catch { /* Destroy the failed connection below. */ }
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      // A lost COMMIT acknowledgement cannot be retried as a confirmed rollback.
      if (committing && !/^(23|40)[A-Z0-9]{3}$/.test(code)) {
        throw new IdentityCustodyErrorV1('identity_transaction_indeterminate');
      }
      throw error;
    } finally { client.release(failure); }
  },
};

// Stack dependency: the approved r6 UOW implements run/options/combined stores.
// No app implementation of that CM contract is supplied here.
export const cmIdentityUnitOfWork = createPostgresIdentityUnitOfWorkV1({ schema: 'cm_identity', host });

const current = new AsyncLocalStorage<CmIdentityTransaction>();
export const currentCmIdentityTransaction = () => current.getStore();
export const withCmIdentityTransaction = <T>(tx: CmIdentityTransaction, operation: () => Promise<T>): Promise<T> =>
  current.run(tx, operation);

export const runCmIdentityWrite = <T>(operation: (tx: CmIdentityTransaction) => Promise<T>): Promise<T> => {
  const bound = current.getStore();
  if (bound) {
    if (bound.mode !== 'write') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
    return operation(bound);
  }
  return cmIdentityUnitOfWork.run(cmRequestWriteOptions, tx => current.run(tx, () => operation(tx)));
};
export const runCmIdentityRead = <T>(operation: (tx: CmIdentityTransaction) => Promise<T>): Promise<T> => {
  const bound = current.getStore();
  return bound ? operation(bound)
    : cmIdentityUnitOfWork.run(cmRequestReadOptions, tx => current.run(tx, () => operation(tx)));
};

/** Existing app adapters also use all/run/get; each method stays on this executor. */
export const withAppDatabaseMethods = (database: NodePgDatabase): typeof db => Object.assign(database, {
  all: async (query: SQL): Promise<unknown[]> => (await database.execute(query)).rows,
  run: async (query: SQL): Promise<unknown> => database.execute(query),
  get: async (query: SQL): Promise<unknown> => (await database.execute(query)).rows[0],
});
export const bindCmAppDatabase = (tx: CmIdentityTransaction): typeof db =>
  withAppDatabaseMethods(drizzle(tx.hostTransaction));
