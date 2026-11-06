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
import { logger } from '../../logger';

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
const exclusiveWriter = new AsyncLocalStorage<boolean>();
// Cascades inspect references across tables: unrelated CM writers can form
// SSI predicate cycles even though their subject/workspace locks are disjoint.
// A shared/exclusive gate admits ordinary writers together, but drains them
// before a destructive snapshot. Acquire it outside BEGIN: waiting inside a
// serializable transaction would retain the stale snapshot we must avoid.
const writerGateKey = 'sentropic:cm_identity:destructive-writers';
const host: PostgresIdentityHostV1<AppCustodyHost> = {
  async runSerializable(options, operation) {
    const deadline = Date.now() + options.deadlineMs;
    const client = await pool.connect();
    const scoped = createCmScopedHostClient(client);
    const gate = !options.readOnly ? (exclusiveWriter.getStore() ? '' : '_shared') : null;
    let committing = false;
    let failure: Error | undefined;
    try {
      if (gate !== null) {
        await client.query("SELECT set_config('statement_timeout', $1, false)", [String(Math.max(1, deadline - Date.now()))]);
        await client.query(`SELECT pg_advisory_lock${gate}(hashtextextended($1, 0))`, [writerGateKey]);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await client.query(options.readOnly ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'
        : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(remaining)]);
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
      const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
      const diagnosticCode = code || (cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '');
      logger.warn({ readOnly: options.readOnly, committing,
        code: error instanceof IdentityCustodyErrorV1 ? error.code
          : /^[A-Z0-9]{5}$/.test(diagnosticCode) ? diagnosticCode : 'identity_host_failure',
        errorType: error instanceof Error ? error.name : 'unknown',
      }, 'CM host transaction rolled back');
      // A lost COMMIT acknowledgement cannot be retried as a confirmed rollback.
      if (committing && !/^(23|40)[A-Z0-9]{3}$/.test(code)) {
        throw new IdentityCustodyErrorV1('identity_transaction_indeterminate');
      }
      throw error;
    } finally {
      scoped.expire();
      if (gate !== null && !failure) {
        try {
          await client.query(`SELECT pg_advisory_unlock${gate}(hashtextextended($1, 0))`, [writerGateKey]);
          await client.query('RESET statement_timeout');
        } catch (error) { failure = error instanceof Error ? error : new Error('Identity writer gate release failed'); }
      }
      // Destroy failed connections: PostgreSQL releases their session locks.
      client.release(failure);
    }
  },
};

// Stack dependency: the approved r6 UOW implements run/options/combined stores.
// No app implementation of that CM contract is supplied here.
const unitOfWork = createPostgresIdentityUnitOfWorkV1({ schema: 'cm_identity', host });
export const cmIdentityUnitOfWork: typeof unitOfWork = {
  profile: unitOfWork.profile,
  run: (options, operation) => exclusiveWriter.run(options.purpose === 'delete' || exclusiveWriter.getStore() === true,
    () => unitOfWork.run(options, operation)),
};

const current = new AsyncLocalStorage<CmIdentityTransaction>();
export const currentCmIdentityTransaction = () => current.getStore();
export const withCmIdentityTransaction = <T>(tx: CmIdentityTransaction, operation: () => Promise<T>): Promise<T> =>
  current.run(tx, operation);

export const runCmIdentityWrite = <T>(operation: (tx: CmIdentityTransaction) => Promise<T>,
  options?: { readonly exclusive?: boolean }): Promise<T> => {
  const bound = current.getStore();
  if (bound) {
    if (bound.mode !== 'write') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
    return operation(bound);
  }
  const run = () => cmIdentityUnitOfWork.run(cmRequestWriteOptions, tx => current.run(tx, () => operation(tx)));
  return options?.exclusive ? exclusiveWriter.run(true, run) : run();
};
export const runCmIdentityRead = <T>(operation: (tx: CmIdentityTransaction) => Promise<T>): Promise<T> => {
  const bound = current.getStore();
  return bound ? operation(bound)
    : cmIdentityUnitOfWork.run(cmRequestReadOptions, tx => current.run(tx, () => operation(tx)));
};

/** Serializable transactions abort with 40001/40P01 when a concurrent write
 *  commits first. Postgres requires the caller to retry in a fresh
 *  transaction; the retry then observes the winner and maps the documented
 *  domain code. Retry is safe here because a serialization abort discards the
 *  whole attempt (external effects publish only after commit). */
const isSerializationFailure = (error: unknown): boolean => {
  const codes: string[] = [];
  if (typeof error === 'object' && error !== null && 'code' in error) codes.push(String((error as { code: unknown }).code));
  const cause = typeof error === 'object' && error !== null && 'cause' in error
    ? (error as { cause: unknown }).cause : undefined;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) codes.push(String((cause as { code: unknown }).code));
  return codes.some((code) => code === '40001' || code === '40P01');
};

export const withSerializationRetry = async <T>(operation: () => Promise<T>, attempts = 3): Promise<T> => {
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
      if (!isSerializationFailure(error)) throw error;
      // Jittered backoff between attempts: a serialization loser must wait out
      // the winner's commit instead of re-colliding immediately. Without it the
      // per-request session touch (same login row on every authenticated call)
      // aborts parallel losers faster than immediate retries converge (e2e
      // parallelism, 27 auth 500s on run 42024251267). Attempts stay bounded;
      // only 40001/40P01 aborts retry, so fail-closed semantics are unchanged.
      if (attempt + 1 < attempts) {
        const delayMs = 20 * (attempt + 1) + Math.floor(Math.random() * 30);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw failure;
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
  withAppDatabaseMethods(drizzle(tx.hostTransaction) as unknown as NodePgDatabase);
