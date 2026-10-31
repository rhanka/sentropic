import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import { runControlMigrations, runMigrations } from '../../src/db/run-migrations';
import {
  artifactMigrationAssets,
  createArtifactHostKv,
  installArtifactPackageAssets,
} from '../../src/services/artifacts/host-storage';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let database: Pool;
let databaseName: string;
let connectionString: string;
let connectionEnds: Promise<void>[];

function createTrackedPool() {
  const pool = new Pool({ connectionString });
  pool.on('connect', client => {
    connectionEnds.push(new Promise<void>(resolve => client.once('end', resolve)));
  });
  return pool;
}

beforeEach(async () => {
  databaseName = `w1a_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  connectionString = url.toString();
  connectionEnds = [];
  database = createTrackedPool();
});

afterEach(async () => {
  await database.end();
  await Promise.all(connectionEnds);
  await admin.query(`DROP DATABASE "${databaseName}"`);
});

afterAll(() => admin.end());

async function journal() {
  return (await database.query(`SELECT asset_id, hash AS sha256 FROM public.__drizzle_control_migrations WHERE asset_id IS NOT NULL ORDER BY asset_id`)).rows;
}

function rejectQueries(client: PoolClient, failures: Map<string, Error>) {
  const query = client.query.bind(client);
  vi.spyOn(client, 'query').mockImplementation(((...args: unknown[]) => {
    const statement = typeof args[0] === 'string' ? args[0] : (args[0] as { text: string }).text;
    for (const [fragment, error] of failures) {
      if (statement.includes(fragment)) return Promise.reject(error);
    }
    return (query as (...values: unknown[]) => unknown)(...args);
  }) as typeof client.query);
}

describe('artifact host migrations', () => {
  it('should serialize concurrent first installations and package reruns', async () => {
    await Promise.all([runMigrations(database), runMigrations(database)]);
    await Promise.all([installArtifactPackageAssets(database), installArtifactPackageAssets(database)]);
    expect(await journal()).toHaveLength(4);
  });

  it('should leave a later reserved control migration eligible for installation', async () => {
    await runMigrations(database);
    const folder = mkdtempSync(join(tmpdir(), 'w1a-control-'));
    try {
      mkdirSync(join(folder, 'meta'));
      writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ version: '5', dialect: 'pg', entries: [
        { idx: 0, version: '7', when: 1793200000000, tag: '0013_reserved_witness', breakpoints: true },
      ] }));
      writeFileSync(join(folder, '0013_reserved_witness.sql'), 'CREATE TABLE control.reserved_slot_witness (id text PRIMARY KEY);');
      await runControlMigrations(drizzle(database), folder);
      expect((await database.query(`SELECT to_regclass('control.reserved_slot_witness')::text AS witness`)).rows[0].witness).toBe('control.reserved_slot_witness');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('should install the host slot on a database with a later control frontier', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'w1a-frontier-'));
    try {
      mkdirSync(join(folder, 'meta'));
      const metadata = JSON.parse(readFileSync('drizzle/control/meta/_journal.json', 'utf8'));
      metadata.entries = metadata.entries.filter((entry: { tag: string }) => entry.tag !== '0012_app_artifact_host');
      for (const entry of metadata.entries) writeFileSync(join(folder, `${entry.tag}.sql`), readFileSync(`drizzle/control/${entry.tag}.sql`));
      metadata.entries.push({ idx: 12, version: '7', when: 1793200000000, tag: '0019_frontier_witness', breakpoints: true });
      writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(metadata));
      writeFileSync(join(folder, '0019_frontier_witness.sql'), 'CREATE TABLE control.frontier_witness (id text PRIMARY KEY);');
      await migrate(drizzle(database), { migrationsFolder: './drizzle' });
      await migrate(drizzle(database), { migrationsFolder: folder, migrationsTable: '__drizzle_control_migrations', migrationsSchema: 'public' });
      // Reproduce the timestamp-only runner skipping the missing earlier host slot.
      await migrate(drizzle(database), { migrationsFolder: './drizzle/control', migrationsTable: '__drizzle_control_migrations', migrationsSchema: 'public' });
      expect((await database.query(`SELECT to_regclass('control.artifact_host_kv') AS kv`)).rows).toEqual([{ kv: null }]);
      await runMigrations(database);
      expect(await journal()).toHaveLength(4);
      expect((await database.query(`SELECT to_regclass('control.artifact_host_kv')::text AS kv`)).rows).toEqual([{ kv: 'control.artifact_host_kv' }]);
      await database.query(`UPDATE public.__drizzle_control_migrations SET hash = repeat('0', 64) WHERE created_at = 1793145600001`);
      await expect(runMigrations(database)).rejects.toThrow(/control migration journal hash mismatch/i);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('should install unchanged package schemas and durable host state on an empty database', async () => {
    await runMigrations(database);
    expect(await journal()).toEqual(artifactMigrationAssets.map(({ id, sha256 }) => ({ asset_id: id, sha256 })));
    const { rows } = await database.query(`SELECT to_regclass('artifacts.operation_receipts')::text AS receipts,
      to_regclass('artifacts.blob_ref_holders')::text AS refs,
      to_regclass('control.artifact_host_kv')::text AS kv`);
    expect(rows[0]).toEqual({ receipts: 'artifacts.operation_receipts', refs: 'artifacts.blob_ref_holders', kv: 'control.artifact_host_kv' });
    const hostHash = createHash('sha256').update(readFileSync('drizzle/control/0012_app_artifact_host.sql')).digest('hex');
    expect((await database.query(`SELECT hash FROM public.__drizzle_control_migrations
      WHERE asset_id IS NULL AND created_at = 1793145600001`)).rows).toEqual([{ hash: hostHash }]);
    expect((await database.query(`SELECT to_regclass('control.artifact_package_migrations') AS third`)).rows).toEqual([{ third: null }]);
  });

  it('should retain journal timestamps and rows on rerun', async () => {
    await runMigrations(database);
    const before = await database.query('SELECT * FROM public.__drizzle_control_migrations ORDER BY id');
    await createArtifactHostKv(database, 'scope-a').putIfAbsent('binding/a', 'original');
    await runMigrations(database);
    expect((await database.query('SELECT * FROM public.__drizzle_control_migrations ORDER BY id')).rows).toEqual(before.rows);
    expect(await createArtifactHostKv(database, 'scope-a').get('binding/a')).toBe('original');
  });

  it('should refuse a changed asset before executing any pending SQL', async () => {
    await runMigrations(database);
    await database.query('DELETE FROM public.__drizzle_control_migrations WHERE asset_id IS NOT NULL');
    const load = (id: string) => `${artifactMigrationAssets.find((asset) => asset.id === id)!.read()}\nSELECT 1;`;
    await expect(installArtifactPackageAssets(database, load)).rejects.toThrow(/asset hash mismatch/);
    expect(await journal()).toEqual([]);
  });

  it('should append assets in order on an installed database and verify without replaying DDL', async () => {
    await runMigrations(database);
    const before = await journal();
    const additions = [
      'CREATE TABLE control.additive_witness (id integer PRIMARY KEY);',
      'INSERT INTO control.additive_witness VALUES (1);',
    ].map((source, index) => ({
      id: `@sentropic/artifacts/migrations/000${index + 5}_witness.sql`,
      sha256: createHash('sha256').update(source).digest('hex'),
      read: () => source,
    }));
    const assets = [...artifactMigrationAssets, ...additions];
    await installArtifactPackageAssets(database, undefined, assets);
    expect(await journal()).toEqual([...before, ...additions.map(({ id, sha256 }) => ({ asset_id: id, sha256 }))]
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id)));
    const installed = await database.query('SELECT * FROM public.__drizzle_control_migrations ORDER BY id');
    await database.query(`CREATE FUNCTION reject_replay() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'unexpected boot DDL'; END $$;
      CREATE EVENT TRIGGER reject_replay ON ddl_command_start EXECUTE FUNCTION reject_replay();`);
    await installArtifactPackageAssets(database, undefined, assets);
    expect((await database.query('SELECT * FROM public.__drizzle_control_migrations ORDER BY id')).rows).toEqual(installed.rows);
    expect((await database.query('SELECT id FROM control.additive_witness')).rows).toEqual([{ id: 1 }]);
  });

  it('should refuse an installed journal hash mismatch without replacing its receipt', async () => {
    await runMigrations(database);
    await database.query(`UPDATE public.__drizzle_control_migrations SET hash = repeat('0', 64) WHERE asset_id = $1`, [artifactMigrationAssets[0].id]);
    const before = await journal();
    await expect(runMigrations(database)).rejects.toThrow(/journal hash mismatch/);
    expect(await journal()).toEqual(before);
  });

  it('should roll back all package DDL and receipts when the last asset fails', async () => {
    await database.query(`CREATE FUNCTION reject_receipts() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF to_regclass('artifacts.operation_receipts') IS NOT NULL THEN
        RAISE EXCEPTION 'injected asset failure'; END IF; END $$;
      CREATE EVENT TRIGGER reject_receipts ON ddl_command_end EXECUTE FUNCTION reject_receipts();`);
    await expect(runMigrations(database)).rejects.toThrow(/injected asset failure/);
    expect(await journal()).toEqual([]);
    expect((await database.query(`SELECT to_regnamespace('artifacts') AS schema`)).rows[0].schema).toBeNull();
    await database.query('DROP EVENT TRIGGER reject_receipts');
    await runMigrations(database);
    expect(await journal()).toHaveLength(4);
  });

  it('should refuse missing receipts when an installed package schema remains', async () => {
    await runMigrations(database);
    await database.query(`DELETE FROM public.__drizzle_control_migrations WHERE asset_id = $1`, [artifactMigrationAssets[1].id]);
    await database.query('ALTER TABLE artifacts.operation_receipts DROP COLUMN receipt');
    const before = await journal();
    await expect(installArtifactPackageAssets(database)).rejects.toThrow(/missing.*receipt/i);
    expect(await journal()).toEqual(before);
  });

  it('should refuse lost package receipts instead of re-attesting an existing artifact schema', async () => {
    await runMigrations(database);
    await database.query('DELETE FROM public.__drizzle_control_migrations WHERE asset_id IS NOT NULL');
    await database.query('ALTER TABLE artifacts.operation_receipts DROP COLUMN receipt');
    await expect(installArtifactPackageAssets(database)).rejects.toThrow(/untracked artifact schema/i);
    expect(await journal()).toEqual([]);
  });

  it('should refuse a missing required table even when every receipt survives', async () => {
    await runMigrations(database);
    await database.query('DROP TABLE artifacts.operation_receipts, control.artifact_host_kv');
    const before = await journal();
    await expect(installArtifactPackageAssets(database)).rejects.toThrow(/missing artifact relation/i);
    expect(await journal()).toEqual(before);
  });

  it('should fail startup and discard its client when unlocking fails', async () => {
    const client = await database.connect();
    const unlockFailure = new Error('injected unlock failure');
    rejectQueries(client, new Map([['pg_advisory_unlock', unlockFailure]]));
    const release = vi.spyOn(client, 'release');
    await expect(runMigrations({ connect: async () => client } as unknown as Pool)).rejects.toBe(unlockFailure);
    expect(release).toHaveBeenCalledWith(unlockFailure);
  });

  it('should preserve the migration error when its unlock also fails', async () => {
    const client = await database.connect();
    const migrationFailure = new Error('injected migration failure');
    const unlockFailure = new Error('injected unlock failure');
    rejectQueries(client, new Map([['CREATE SCHEMA IF NOT EXISTS "drizzle"', migrationFailure], ['pg_advisory_unlock', unlockFailure]]));
    await expect(runMigrations({ connect: async () => client } as unknown as Pool)).rejects.toMatchObject({ cause: migrationFailure });
  });

  it('should discard a standalone installer client and preserve both failures when rollback fails', async () => {
    const primary = new Error('injected query failure');
    const rollback = new Error('injected rollback failure');
    const release = vi.fn();
    const client = { release, query: vi.fn(async (statement: string) => {
      if (statement === 'ROLLBACK') throw rollback;
      if (statement.includes('SELECT asset_id')) throw primary;
      return { rows: [] };
    }) };
    await expect(installArtifactPackageAssets({ connect: async () => client } as unknown as Pool))
      .rejects.toMatchObject({ errors: [primary, rollback] });
    expect(release).toHaveBeenCalledWith(rollback);
  });

  it('should keep one immutable KV value across competing writers and a fresh process', async () => {
    await runMigrations(database);
    const kv = createArtifactHostKv(database, 'scope-a');
    expect(await kv.get('missing')).toBeUndefined();
    const wins = await Promise.all(['a', 'b', 'c'].map((value) => kv.putIfAbsent('scope/binding', value)));
    expect(wins.filter(Boolean)).toHaveLength(1);
    const value = await kv.get('scope/binding');
    expect(await createArtifactHostKv(database, 'scope-b').get('scope/binding')).toBeUndefined();
    await database.end();
    await Promise.all(connectionEnds);
    database = createTrackedPool();
    // A separate OS process has no access to a process-local KV or migration cache.
    const script = `const { Pool } = require('pg'); const pool = new Pool({connectionString: process.env.DATABASE_URL});
      (async () => {
        const { runMigrations } = await import('./src/db/run-migrations.ts');
        const { createArtifactHostKv } = await import('./src/services/artifacts/host-storage.ts');
        await runMigrations(pool);
        process.send(await createArtifactHostKv(pool, 'scope-a').get('scope/binding'));
      })().finally(() => pool.end());`;
    const observed = await new Promise((resolve, reject) => {
      const child = fork('-e', [script], { execArgv: ['--import', 'tsx'], env: { ...process.env, DATABASE_URL: connectionString }, silent: true });
      let message: unknown;
      child.on('message', (result) => { message = result; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve(message) : reject(new Error(`restart process exited ${code}`)));
    });
    expect(observed).toBe(value);
    await runMigrations(database);
    expect(await createArtifactHostKv(database, 'scope-a').putIfAbsent('scope/binding', 'replacement')).toBe(false);
    expect(await journal()).toHaveLength(4);
  });
});
