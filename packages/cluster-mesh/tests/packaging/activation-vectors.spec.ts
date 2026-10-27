import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson } from './helpers.js';

describe.skipIf(!enabled || !process.env.DATABASE_URL)('installed activation conformance vectors', () => {
  it('should run every shipped vector on a clean consumer PostgreSQL executor', () => {
    const result = nodeJson(fixtureDir('artifacts-consumer'), `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { createHash } from 'node:crypto';
      import { Pool } from 'pg';
      import { createPostgresActivationStore, ACTIVATION_SQL_ASSET, ACTIVATION_SQL_ASSET_SHA256 }
        from '@sentropic/artifacts/adapters/postgres-activation';
      import { POSTGRES_ACTIVATION_VECTOR_IDS, runPostgresActivationConformance }
        from '@sentropic/artifacts/adapters/postgres-activation/vectors';
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const bytes = readFileSync(new URL(import.meta.resolve(ACTIVATION_SQL_ASSET)));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), ACTIVATION_SQL_ASSET_SHA256);
      const passed = [];
      let stores = 0;
      const host = {
        createStore(namespace) { stores++; return createPostgresActivationStore({ pool, namespace }); },
        wait: async ms => { await pool.query('SELECT pg_sleep($1)', [ms / 1000]); },
        onPass: id => passed.push(id),
      };
      try {
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
      } finally { await pool.end(); }
    `);
    expect(result.passed).toEqual([
      'namespace-isolation', 'immutable-records', 'binding-mismatch', 'wrong-ids',
      'authority-denial', 'authority-outage', 'single-use', 'concurrent-consume',
      'expiry-without-cleanup', 'expiry-after-authority', 'bounded-cleanup',
      'invalidation-recovery', 'ttl-cap', 'flow-association',
    ]);
  });
});
