import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { createPostgresIdentityUnitOfWorkV1, IdentityCustodyErrorV1, PostgresCustodyHandle,
  type CustodyOpHost, type IdentityTransactionV1, type PostgresIdentityBindingV1,
  type PostgresIdentityHostV1 } from '@sentropic/cluster-mesh';
import { pool, type db } from '../../db/client';
import { aliasCmHostScope, createCmScopedHostClient } from './cm-host-scope';

/** Request host: the pooled connection plus the custody stores/journal the CM V2 flows require. */
export type AppCustodyHost = PoolClient & CustodyOpHost;
export type CmIdentityTransaction = IdentityTransactionV1<AppCustodyHost>;

/** Assemble the CM V2 host over the request's own connection (same transaction, no new capability). */
export const createAppCustodyHost = (
  scopedClient: PoolClient,
  session: PostgresIdentityBindingV1<PoolClient>['session'],
): AppCustodyHost => {
  const handle = new PostgresCustodyHandle('cm_identity', session);
  const hybrid = Object.create(scopedClient) as AppCustodyHost;
  Object.assign(hybrid, { profile: handle.profile, stores: handle.stores,
    journal: handle.journal, raw: handle.raw, schema: 'cm_identity' });
  aliasCmHostScope(scopedClient, hybrid);
  return hybrid;
};
export const cmRequestWriteOptions = {
  mode: 'write', purpose: 'request', deadlineMs: 10_000, maxAttempts: 3,
} as const;
export const cmRequestReadOptions = {
  mode: 'read', purpose: 'request', deadlineMs: 10_000, maxAttempts: 3,
} as const;

/** r6 §6.4: every CM slice and app participant borrows this one connection. */
const host: PostgresIdentityHostV1<AppCustodyHost> = {
  async runSerializable(options, operation) {
    const client = await pool.connect();
    const scoped = createCmScopedHostClient(client);
    let committing = false;
    let failure: Error | undefined;
    try {
      await client.query(options.readOnly ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'
        : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(options.deadlineMs)]);
      const session: PostgresIdentityBindingV1<AppCustodyHost>['session'] = { async execute(statement) {
        const result = await scoped.client.query(statement.text, [...statement.values ?? []]);
        return { rows: result.rows, rowCount: result.rowCount };
      } };
      const result = await operation({
        transactionId: randomUUID(), hostTransaction: createAppCustodyHost(scoped.client, session),
        readOnly: options.readOnly, session,
      });
      scoped.seal();
      committing = true;
      const committed = await client.query('COMMIT');
      if (committed.command !== 'COMMIT') {
        committing = false; // PostgreSQL confirmed rollback of an aborted transaction.
        scoped.assertCommitted();
        throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      }
      scoped.assertCommitted();
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
    } finally { scoped.expire(); client.release(failure); }
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

/** Existing app adapters also use all/run/get; each method stays on this executor.
 *  The tx-bound drizzle instance satisfies the app-database contract: no caller
 *  reads `$client` (verified: no `$client` use in api/src) and every query goes
 *  through the same drizzle surface as the pool-bound instance. */
export const withAppDatabaseMethods = (database: NodePgDatabase): typeof db =>
  Object.assign(database, {
    all: async (query: SQL): Promise<unknown[]> => (await database.execute(query)).rows,
    run: async (query: SQL): Promise<unknown> => database.execute(query),
    get: async (query: SQL): Promise<unknown> => (await database.execute(query)).rows[0],
  }) as typeof db;
export const bindCmAppDatabase = (tx: CmIdentityTransaction): typeof db =>
  withAppDatabaseMethods(drizzle(tx.hostTransaction) as NodePgDatabase);
