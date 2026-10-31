// Identity core lot A2.2: PostgreSQL profile specs. One schema per test, so
// every case starts from an empty durable store on the hosted profile.
// Skipped without `CM_PG_URL` (the dedicated PG lane always provides it).

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyPostgresIdentitySchema, createPostgresIdentityStores } from '../src/index.js';
import { pgEnabled } from './storage/pg-driver.js';
import {
  replayContractMembershipCycle,
  runGapSection1,
  runShadowStrictReplay,
  runUniquenessAliasTransition,
  type A22BackendStores,
} from './identity-a22-scenarios.js';

interface PgPool {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  end(): Promise<void>;
}

const requireModule = createRequire(import.meta.url);

async function setupPostgres(): Promise<{ stores: A22BackendStores; teardown(): Promise<void> }> {
  const pg = requireModule('pg') as { Pool: new (options: unknown) => PgPool };
  const pool = new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 4, connectionTimeoutMillis: 2000 });
  const schema = `a22_${randomBytes(6).toString('hex')}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await applyPostgresIdentitySchema({ query: (text, values) => pool.query(text, values) }, { schema });
  const stores = createPostgresIdentityStores(
    { query: (text, values) => pool.query(text, values) },
    { schema },
  );
  return {
    stores,
    teardown: async () => {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    },
  };
}

describe.skipIf(!pgEnabled)('A2.2 tenants, memberships and workspaces on PostgreSQL', () => {
  it('should replay the frozen contract cycle over durable stores', async () => {
    const fixture = await setupPostgres();
    try {
      await replayContractMembershipCycle(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });

  it('should enforce uniqueness, aliases and the transition table', async () => {
    const fixture = await setupPostgres();
    try {
      await runUniquenessAliasTransition(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });

  it('should replay shadow against strict with divergence metrics', async () => {
    const fixture = await setupPostgres();
    try {
      await runShadowStrictReplay(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });

  it('should separate account approval from membership approval end to end', async () => {
    const fixture = await setupPostgres();
    try {
      await runGapSection1(fixture.stores);
    } finally {
      await fixture.teardown();
    }
    expect(pgEnabled).toBe(true);
  });
});
