import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/run-migrations';
import { prepareCmFixtureCutover } from '../utils/cm-fresh-database';
import { artifactMigrationAssets } from '../../src/services/artifacts/host-storage';

// Local `-- Qn:` section splitter (same contract as the driver splitSql in
// deploy/ci/preprod-a4/t3-window-driver.mjs, asserted there by
// t3-driver.test.mjs). Kept local so this test never reaches outside api/:
// the CI api image ships api/ but never deploy/.
function splitSql(text: string): Record<string, string> {
  const parts: Record<string, string> = {};
  let current: string | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^-- (Q[1-6]):/);
    if (m) { current = m[1]; parts[current] = ''; continue; }
    if (current && !line.startsWith('--')) parts[current] += `${line}\n`;
  }
  return parts;
}

const sql = splitSql(readFileSync(
  new URL('./t3-classify.sql', import.meta.url), 'utf8'));

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let database: Pool;
let databaseName: string;

beforeEach(async () => {
  databaseName = `t3_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  database = new Pool({ connectionString: url.toString() });
  const dispose = await prepareCmFixtureCutover(database, []);
  try {
    await runMigrations(database);
  } finally {
    await dispose();
  }
});

afterEach(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
});

afterAll(() => admin.end());

describe('t3 classify SQL against the migrated schema', () => {
  it('sees the control journal with no migration lock and the installed A4 marker', async () => {
    const { rows } = await database.query(sql.Q1);
    expect(rows[0].journal_present).toBe(true);
    expect(Number(rows[0].api_migration_locks)).toBe(0);
    // runMigrations installs control entry idx 15 (when=1793577600000), so the
    // A4 marker is present on every freshly migrated DB by construction.
    const committed = await database.query(sql.Q2);
    expect(committed.rows[0].identity_committed).toBe(true);
    await database.query(
      `DELETE FROM public.__drizzle_control_migrations WHERE created_at = 1793577600000`);
    const cleared = await database.query(sql.Q2);
    expect(cleared.rows[0].identity_committed).toBe(false);
  });

  it('tracks the real commit marker once it lands in the journal', async () => {
    await database.query(
      `INSERT INTO public.__drizzle_control_migrations (hash, created_at) VALUES ('t3-test', 1793577600000)`);
    const { rows } = await database.query(sql.Q2);
    expect(rows[0].identity_committed).toBe(true);
  });

  it('counts exactly the installed artifact receipts', async () => {
    const col = await database.query(sql.Q3);
    expect(col.rows[0].asset_column_present).toBe(true);
    const { rows } = await database.query(sql.Q4);
    expect(Number(rows[0].asset_receipts)).toBe(artifactMigrationAssets.length);
  });

  it('reads artifact relations as present on the migrated schema', async () => {
    const relations = await database.query(sql.Q5);
    // The four Q5 names are the installer-guarded set: installArtifactPackageAssets
    // refuses to commit unless every required relation exists (fail-closed).
    expect(relations.rows).toHaveLength(4);
    for (const row of relations.rows) {
      expect(typeof row.name).toBe('string');
      expect(row.present).toBe(true);
    }
    expect(relations.rows.map((row) => row.name).sort()).toEqual([
      'artifact_host.activation_namespaces',
      'artifacts.artifacts',
      'control.artifact_host_kv',
      'public.__drizzle_control_migrations',
    ]);
  });

  it('reads encrypted-store rows without touching secrets', async () => {
    // A fresh fixture may carry zero enc: rows, which would let the loop below
    // pass vacuously: plant our own row so the shape is always exercised.
    const key = `t3-q6-probe-${randomUUID()}`;
    await database.query(`INSERT INTO public.settings (key, user_id, value) VALUES ($1, NULL, 'enc:deadbeef')`, [key]);
    const stores = await database.query(sql.Q6);
    expect(stores.rows.length).toBeGreaterThan(0);
    const ours = stores.rows.find((row) => row.k === key);
    expect(ours).toBeDefined();
    expect(ours.u).toBeNull();
    expect(Number(ours.len)).toBe(12);
    for (const row of stores.rows) {
      expect(Object.keys(row).sort()).toEqual(['k', 'len', 'u']);
    }
  });

  it('rejects the superseded plan queries that named missing columns', async () => {
    await expect(database.query(
      `SELECT offline_grant_id FROM public.authorization_codes LIMIT 1`)).rejects.toThrow();
    await expect(database.query(`SELECT * FROM control.artifact_packages LIMIT 1`)).rejects.toThrow();
    await expect(database.query(`SELECT id FROM public.settings LIMIT 1`)).rejects.toThrow();
  });
});
