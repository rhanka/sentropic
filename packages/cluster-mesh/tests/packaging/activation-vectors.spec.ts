import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, tsc, TSC_CASES } from './helpers.js';
import { required } from './activation-environment.js';

// Ordinary cluster-mesh unit runs have no packed consumer; the dedicated target always requires this suite.
describe.skipIf(!required && !enabled)('installed activation conformance vectors', () => {
  it.each(['CLUSTER_MESH_PACKAGING_DIR', 'DATABASE_URL', 'ACTIVATION_DISPOSABLE'])
    ('should fail the required suite when %s is missing', key => {
      // Execute the suite's actual startup guard without booting a nested test runner.
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL('./activation-environment.ts', import.meta.url)),
      ], { encoding: 'utf8', env: { ...process.env, ACTIVATION_CONFORMANCE_REQUIRED: '1', [key]: undefined } });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout + result.stderr).toContain(key);
    });

  it.each([1, 4])('should run every shipped vector on a clean consumer PostgreSQL executor with pool max %d', max => {
    const result = nodeJson(fixtureDir('artifacts-consumer'), `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { createHash } from 'node:crypto';
      import { Pool } from 'pg';
      import { createPostgresActivationStore, ACTIVATION_SQL_ASSET, ACTIVATION_SQL_ASSET_SHA256 }
        from '@sentropic/artifacts/adapters/postgres-activation';
      import { POSTGRES_ACTIVATION_VECTOR_IDS, runPostgresActivationConformance }
        from '@sentropic/artifacts/adapters/postgres-activation/vectors';
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: ${max} });
      const bytes = readFileSync(new URL(import.meta.resolve(ACTIVATION_SQL_ASSET)));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), ACTIVATION_SQL_ASSET_SHA256);
      const passed = [];
      let stores = 0;
      const host = {
        disposable: { confirmed: true, databaseName: new URL(process.env.DATABASE_URL).pathname.slice(1) },
        createStore(namespace) { stores++; return createPostgresActivationStore({ pool, namespace }); },
        async inspectTicket(namespace, ticketId) {
          const { rows } = await pool.query(\`SELECT issued_ms, expires_ms,
            floor(extract(epoch FROM clock_timestamp()) * 1000) AS db_now
            FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2\`, [namespace, ticketId]);
          return { issuedAt: Number(rows[0].issued_ms), expiresAt: Number(rows[0].expires_ms), now: Number(rows[0].db_now) };
        },
        createStoreWithCommitAckLoss(namespace) {
          const uncertainPool = { async connect() {
            const client = await pool.connect();
            return {
              async query(sql, params) {
                const result = await client.query(sql, params);
                if (sql === 'COMMIT') throw new Error('injected acknowledgement loss');
                return result;
              },
              release(destroy) { client.release(destroy); },
            };
          } };
          return createPostgresActivationStore({ pool: uncertainPool, namespace });
        },
        wait: async (ms, client) => { await (client ?? pool).query('SELECT pg_sleep($1)', [ms / 1000]); },
        onPass: id => passed.push(id),
      };
      let disposableVerified = false;
      try {
        const { rows } = await pool.query('SELECT current_database() AS name');
        assert.equal(rows[0].name, host.disposable.databaseName);
        assert.match(rows[0].name, /^test[_-][a-z0-9_-]+$/i);
        disposableVerified = true;
        for (const disposable of [undefined, { confirmed: false, databaseName: rows[0].name },
          { confirmed: true, databaseName: 'serving' }]) {
          await assert.rejects(runPostgresActivationConformance({ ...host, disposable }));
        }
        assert.equal(stores, 0, 'unsafe hosts must be refused before any store is created');
        await pool.query('DROP SCHEMA IF EXISTS artifact_host CASCADE');
        await pool.query(bytes.toString('utf8'));
        const report = await runPostgresActivationConformance(host);
        assert.deepEqual(report, POSTGRES_ACTIVATION_VECTOR_IDS);
        assert.deepEqual(passed, report);
        assert.equal(new Set(report).size, report.length);
        assert.ok(stores > report.length, 'replica and namespace stores must use the host executor');
        // A host that cannot redeem anything must fail the suite, never report success.
        await assert.rejects(runPostgresActivationConformance({ ...host,
          createStore(namespace) { return { ...host.createStore(namespace), consume: async () => undefined }; },
        }));
        console.log(JSON.stringify({ passed: report, stores }));
      } finally {
        try { if (disposableVerified) await pool.query('DROP SCHEMA IF EXISTS artifact_host CASCADE'); }
        finally { await pool.end(); }
      }
    `);
    expect(result.passed).toEqual([
      'namespace-isolation', 'immutable-records', 'binding-mismatch', 'wrong-ids',
      'authority-denial', 'authority-outage', 'single-use', 'concurrent-consume',
      'expiry-without-cleanup', 'expiry-after-authority', 'bounded-cleanup',
      'invalidation-recovery', 'ttl-cap', 'flow-association',
      'db-time-skew', 'commit-unknown',
    ]);
  });

  it.each(TSC_CASES)('should expose installed vector types under $module with skipLibCheck=$skipLibCheck', options => {
    const result = tsc(fixtureDir('artifacts-consumer'), 'activation-vectors', `
      import { runPostgresActivationConformance, POSTGRES_ACTIVATION_VECTOR_IDS,
        type PostgresActivationConformanceHost, type PostgresActivationVectorId }
        from '@sentropic/artifacts/adapters/postgres-activation/vectors';
      export const run = (host: PostgresActivationConformanceHost): Promise<PostgresActivationVectorId[]> =>
        runPostgresActivationConformance(host);
      export const ids: readonly PostgresActivationVectorId[] = POSTGRES_ACTIVATION_VECTOR_IDS;
    `, options);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
