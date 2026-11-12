import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/run-migrations';
import { prepareCmFixtureCutover } from '../utils/cm-fresh-database';
import { artifactMigrationAssets } from '../../src/services/artifacts/host-storage';
import { splitSql } from '../../../deploy/ci/preprod-a4/t3-window-driver.mjs';

const sql = splitSql(readFileSync(
  new URL('../../../deploy/ci/preprod-a4/t3-classify.sql', import.meta.url), 'utf8'));

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

  it('reads artifact relations and encrypted-store rows without touching secrets', async () => {
    const relations = await database.query(sql.Q5);
    expect(relations.rows.length).toBeGreaterThan(0);
    const stores = await database.query(sql.Q6);
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
