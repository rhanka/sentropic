import { Pool, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertCmHostHealthy, createCmScopedHostClient } from '../../../src/services/identity/cm-host-scope';

let pool: Pool, client: PoolClient;
let scope: ReturnType<typeof createCmScopedHostClient>;
beforeEach(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  scope = createCmScopedHostClient(client);
});
afterEach(async () => {
  scope?.expire();
  if (client) { await client.query('ROLLBACK'); client.release(); }
  await pool?.end();
});

describe('A4 host capability over the real PostgreSQL driver', () => {
  it('should use the exact backend and refuse a retained executor after callback exit', async () => {
    const original = await client.query('SELECT pg_backend_pid() AS pid, txid_current()::text AS xid');
    const bound = await scope.client.query('SELECT pg_backend_pid() AS pid, txid_current()::text AS xid');
    expect(bound.rows).toEqual(original.rows);
    const retainedQuery = scope.client.query;
    scope.seal(); scope.expire();
    expect(() => retainedQuery('SELECT 1')).toThrow('identity_transaction_unbound');
  });

  it('should rethrow a SQL failure even when an unchanged handler catches it', async () => {
    let failure: unknown;
    await scope.client.query('SELECT * FROM a4_intentionally_absent_relation').catch(error => { failure = error; });
    expect(failure).toBeDefined();
    expect(() => assertCmHostHealthy(scope.client)).toThrow();
    try { scope.seal(); throw new Error('Failure escaped the host fence'); }
    catch (error) { expect(error).toBe(failure); }
  });

  it('should reject nested transaction control and poison the callback even when caught', () => {
    expect(() => scope.client.query('BEGIN')).toThrow('identity_transaction_unbound');
    expect(() => scope.seal()).toThrow('identity_transaction_unbound');
  });

  it('should refuse to commit while a submitted query has not been awaited', async () => {
    const pending = scope.client.query('SELECT 1');
    expect(() => scope.seal()).toThrow('identity_transaction_unbound');
    await pending;
    expect(() => assertCmHostHealthy(scope.client)).toThrow('identity_transaction_unbound');
  });

  it('should preserve the real callback-style driver API and finish it before sealing', async () => {
    const value = await new Promise<number>((resolve, reject) => {
      scope.client.query('SELECT 42 AS answer', (error, result) => {
        if (error) reject(error); else resolve(result.rows[0].answer);
      });
    });
    expect(value).toBe(42);
    expect(() => scope.seal()).not.toThrow();
  });
});
