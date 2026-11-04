import { Pool, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertCmHostHealthy, createCmPortFailureFence, createCmScopedHostClient } from '../../../src/services/identity/cm-host-scope';
import { expectCustodyCode } from '../../utils/cm-custody-assertions';

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
    await expectCustodyCode(() => retainedQuery('SELECT 1'), 'identity_transaction_unbound');
  });

  it('should rethrow a SQL failure even when an unchanged handler catches it', async () => {
    let failure: unknown;
    await scope.client.query('SELECT * FROM a4_intentionally_absent_relation').catch(error => { failure = error; });
    expect(failure).toBeDefined();
    expect(() => assertCmHostHealthy(scope.client)).toThrow();
    try { scope.seal(); throw new Error('Failure escaped the host fence'); }
    catch (error) { expect(error).toBe(failure); }
  });

  it('should reject nested transaction control and poison the callback even when caught', async () => {
    await expectCustodyCode(() => scope.client.query('BEGIN'), 'identity_transaction_unbound');
    await expectCustodyCode(() => scope.seal(), 'identity_transaction_unbound');
  });

  it.each(['/* prefix */ COMMIT', '-- prefix\nROLLBACK', '-- prefix\rCOMMIT', '; END',
    '/* outer /* nested */ comment */ ABORT', 'SET /* gap */ LOCAL TRANSACTION READ ONLY',
    'PREPARE /* gap */ TRANSACTION \'nested\''])('rejects disguised transaction control: %s', async sql => {
    const original = await client.query('SELECT txid_current()::text AS xid');
    await expectCustodyCode(() => scope.client.query(sql), 'identity_transaction_unbound');
    expect((await client.query('SELECT txid_current()::text AS xid')).rows).toEqual(original.rows);
    await expectCustodyCode(() => scope.seal(), 'identity_transaction_unbound');
  });

  it('uses the PostgreSQL extended protocol to refuse multiple statements before any execution', async () => {
    await client.query('CREATE TEMP TABLE a4_scope_probe (value integer) ON COMMIT DROP');
    await expect(scope.client.query('INSERT INTO a4_scope_probe VALUES (1); COMMIT'))
      .rejects.toMatchObject({ code: '42601' });
    expect(() => scope.seal()).toThrow();
    // A committed insertion would survive in this connection; parse refusal aborts the transaction.
    await client.query('ROLLBACK');
    expect((await client.query("SELECT to_regclass('pg_temp.a4_scope_probe') AS name")).rows[0].name).toBeNull();
  });

  it('allows comments, quoted semicolons and a single terminating semicolon', async () => {
    expect((await scope.client.query("/* ordinary read */ SELECT '; COMMIT' AS value;")).rows[0].value).toBe('; COMMIT');
    expect(() => scope.seal()).not.toThrow();
  });

  it('retains a caught private adapter signal and refuses every subsequent query before the driver', async () => {
    const failure = Object.freeze(new Error('private-restart-signal'));
    const capture = createCmPortFailureFence(scope.client);
    const participant = Object.freeze({ async consume() { throw failure; } });
    const host = capture({ oauthStateStore: participant });
    const binding = capture({ ports: host });
    expect(binding.ports.oauthStateStore).toBe(host.oauthStateStore);
    await binding.ports.oauthStateStore.consume().catch(() => undefined);
    expect(() => scope.client.query('SELECT 1')).toThrow(failure);
    expect(() => assertCmHostHealthy(scope.client)).toThrow(failure);
    expect(() => scope.seal()).toThrow(failure);
    // The driver itself is healthy: the private signal, not a PostgreSQL abort, fences the callback.
    expect((await client.query('SELECT 42 AS answer')).rows[0].answer).toBe(42);
  });

  it('should refuse to commit while a submitted query has not been awaited', async () => {
    const pending = scope.client.query('SELECT 1');
    await expectCustodyCode(() => scope.seal(), 'identity_transaction_unbound');
    await pending;
    await expectCustodyCode(() => assertCmHostHealthy(scope.client), 'identity_transaction_unbound');
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
