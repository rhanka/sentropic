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
import { prepareCmFixtureCutover } from '../utils/cm-fresh-database';
import { installArtifactPackageAssets as installPreviousImage } from './artifacts-rollback-runner.fixture';
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
let disposeCutover: (() => Promise<void>) | undefined;

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
  // Keep the artifact host slot pending while preparing the identity source/checkpoint.
  disposeCutover = await prepareCmFixtureCutover(database, ['0012_app_artifact_host']);
});

afterEach(async () => {
  await disposeCutover?.();
  disposeCutover = undefined;
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
  it('bounds the real 0014 ALTER lock wait and preserves receipts under contention', async () => {
    await runMigrations(database);
    await database.query('DELETE FROM public.__drizzle_control_migrations WHERE asset_id = $1', [artifactMigrationAssets.at(-1)!.id]);
    const receipts = await journal();
    const blocker = await database.connect();
    const runner = await database.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE artifacts.blobs IN ACCESS SHARE MODE');
      await runner.query("SET statement_timeout = '1000ms'");
      await expect(installArtifactPackageAssets(runner, undefined, undefined,
        { lockTimeoutMs: 100, statementTimeoutMs: 500 })).rejects.toMatchObject({ code: '55P03' });
      expect(await journal()).toEqual(receipts);
      await blocker.query('ROLLBACK');
      await installArtifactPackageAssets(runner);
      expect((await runner.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('1s');
      expect(await journal()).toHaveLength(artifactMigrationAssets.length);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); runner.release(); }
  });

  it('bounds migration statements and rolls back a timed out upgrade', async () => {
    await runMigrations(database);
    const source = 'SELECT pg_sleep(0.5);';
    const assets = [...artifactMigrationAssets, { id: 'qualification-slow-upgrade',
      sha256: createHash('sha256').update(source).digest('hex'), read: () => source }];
    const receipts = await journal();
    await expect(installArtifactPackageAssets(database, undefined, assets,
      { lockTimeoutMs: 100, statementTimeoutMs: 100 })).rejects.toMatchObject({ code: '57014' });
    expect(await journal()).toEqual(receipts);
  });

  it('restarts the previous image after installed 0009-0014 receipts without losing data', async () => {
    await runMigrations(database);
    await createArtifactHostKv(database, 'rollback-scope').putIfAbsent('witness', 'preserved');
    const content = new TextEncoder().encode('rollback bytes');
    const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    await database.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('rollback-scope', 'tenant-a');
    `);
    await database.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size, placement)
      VALUES ('rollback-scope', $1, $2, 'db')`, [digest, content.length]);
    const { createPostgresDbBlobStore } = await import('@sentropic/artifacts/adapters/db-blob');
    const { createMemoryBlobStore } = await import('@sentropic/artifacts/server/publication');
    const { createPlacementBlobStore } = await import('../../src/services/artifacts/blob-placement');
    const { migratePlacement } = await import('../../src/scripts/cm-placement-migrate');
    const db = createPostgresDbBlobStore(database);
    const s3 = createMemoryBlobStore();
    const key = `artifacts/rollback-scope/blobs/sha256/${digest.slice(7)}`;
    await db.putBlob(key, content);
    const sql = readFileSync(new URL('../../src/services/artifacts/image-rollback.sql', import.meta.url), 'utf8');
    const blocked = await database.connect();
    try { await expect(blocked.query(sql)).rejects.toThrow(/verified object placement/); }
    finally { await blocked.query('ROLLBACK'); blocked.release(); }
    const composite = createPlacementBlobStore({ pool: database, s3, mode: 'db', inlineMaxBytes: 64 });
    expect((await migratePlacement({ pool: database, composite, db, s3, scope: 'rollback-scope', to: 'object' })).done).toBe(true);
    expect(await s3.getBlob(key)).toEqual(content);
    const receipts = await journal();
    const blobs = (await database.query('SELECT * FROM artifacts.blobs')).rows;
    const bytes = (await database.query('SELECT * FROM artifacts.blob_bytes')).rows;
    await expect(installPreviousImage(database)).rejects.toThrow(/journal hash mismatch.*0009/);
    const client = await database.connect();
    try {
      await client.query(sql);
    } finally { await client.query('ROLLBACK'); client.release(); }
    await installPreviousImage(database);
    expect(await journal()).toEqual(receipts.filter(row => !/\/00(?:09|1[0-4])_/.test(row.asset_id)));
    expect(await createArtifactHostKv(database, 'rollback-scope').get('witness')).toBe('preserved');
    expect((await database.query('SELECT * FROM artifacts.blobs')).rows).toEqual(blobs);
    expect((await database.query('SELECT * FROM artifacts.blob_bytes')).rows).toEqual(bytes);
    const resume = await database.connect();
    try { await resume.query(readFileSync(new URL('../../src/services/artifacts/image-resume.sql', import.meta.url), 'utf8')); }
    finally { await resume.query('ROLLBACK'); resume.release(); }
    await runMigrations(database);
    expect(await journal()).toEqual(receipts);
    expect((await database.query('SELECT * FROM artifacts.blob_bytes')).rows).toEqual(bytes);
  });

  it('should serialize concurrent first installations and package reruns', async () => {
    await Promise.all([runMigrations(database), runMigrations(database)]);
    await Promise.all([installArtifactPackageAssets(database), installArtifactPackageAssets(database)]);
    expect(await journal()).toHaveLength(artifactMigrationAssets.length);
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
      const frontierAt = Math.max(...metadata.entries.map((entry: { when: number }) => entry.when)) + 1;
      metadata.entries = metadata.entries.filter((entry: { tag: string }) =>
        !['0012_app_artifact_host', '0015_app_cm_identity_cutover'].includes(entry.tag));
      for (const entry of metadata.entries) writeFileSync(join(folder, `${entry.tag}.sql`), readFileSync(`drizzle/control/${entry.tag}.sql`));
      metadata.entries.push({ idx: 12, version: '7', when: frontierAt, tag: '0019_frontier_witness', breakpoints: true });
      writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(metadata));
      writeFileSync(join(folder, '0019_frontier_witness.sql'), 'CREATE TABLE control.frontier_witness (id text PRIMARY KEY);');
      await migrate(drizzle(database), { migrationsFolder: './drizzle' });
      await migrate(drizzle(database), { migrationsFolder: folder, migrationsTable: '__drizzle_control_migrations', migrationsSchema: 'public' });
      // Reproduce the timestamp-only runner skipping the missing earlier host slot.
      await migrate(drizzle(database), { migrationsFolder: './drizzle/control', migrationsTable: '__drizzle_control_migrations', migrationsSchema: 'public' });
      expect((await database.query(`SELECT to_regclass('control.artifact_host_kv') AS kv`)).rows).toEqual([{ kv: null }]);
      await runMigrations(database);
      expect(await journal()).toHaveLength(artifactMigrationAssets.length);
      expect((await database.query(`SELECT to_regclass('control.artifact_host_kv')::text AS kv`)).rows).toEqual([{ kv: 'control.artifact_host_kv' }]);
      await database.query(`UPDATE public.__drizzle_control_migrations SET hash = repeat('0', 64) WHERE created_at = 1793145600001`);
      await expect(runMigrations(database)).rejects.toThrow(/control migration journal hash mismatch/i);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('should install package schemas 0009-0013 with all relations on an empty database', async () => {
    await runMigrations(database);
    expect(artifactMigrationAssets.map(({ id }) => id)).toEqual([
      '@sentropic/artifacts/migrations/0001_artifacts.sql',
      '@sentropic/artifacts/migrations/0002_lifecycle.sql',
      '@sentropic/artifacts/migrations/0003_coordinator.sql',
      '@sentropic/artifacts/sql/0001_activation.sql',
      '@sentropic/artifacts/migrations/0004_terminal_controls.sql',
      '@sentropic/artifacts/migrations/0005_metadata.sql',
      '@sentropic/artifacts/migrations/0006_sharing.sql',
      '@sentropic/artifacts/migrations/0007_uploads.sql',
      '@sentropic/artifacts/migrations/0008_reader_consent.sql',
      '@sentropic/artifacts/migrations/0009_upload_pages.sql',
      '@sentropic/artifacts/migrations/0010_git_bindings.sql',
      '@sentropic/artifacts/migrations/0011_live_drafts.sql',
      '@sentropic/artifacts/migrations/0012_git_attach_intents.sql',
      '@sentropic/artifacts/migrations/0013_live_invitations.sql',
      '@sentropic/artifacts/migrations/0014_db_blob_placement.sql',
    ]);
    const { rows } = await database.query<{ name: string | null }>(`SELECT to_regclass(name)::text AS name
      FROM unnest(ARRAY['artifacts.upload_pages', 'artifacts.git_bindings', 'artifacts.git_binding_events',
        'artifacts.git_release_index', 'artifacts.live_drafts', 'artifacts.live_draft_objects',
        'artifacts.live_commands', 'artifacts.live_commit_quota', 'artifacts.git_attach_intents',
        'artifacts.live_invitations', 'artifacts.live_invitation_epochs']) AS name`);
    expect(rows.map((row) => row.name).sort()).toEqual(['artifacts.git_attach_intents',
      'artifacts.git_binding_events', 'artifacts.git_bindings', 'artifacts.git_release_index',
      'artifacts.live_commands', 'artifacts.live_commit_quota', 'artifacts.live_draft_objects',
      'artifacts.live_drafts', 'artifacts.live_invitation_epochs', 'artifacts.live_invitations',
      'artifacts.upload_pages'].sort());
  });

  it('should default existing blob rows to object placement with DB tables present', async () => {
    // True migration path: a row that predates 0014 has no placement value;
    // 0014's ADD COLUMN with DEFAULT 'object' backfills it. Simulate by
    // dropping the column, inserting without it, then re-applying the 0014
    // DDL directly (IF NOT EXISTS makes the re-apply safe).
    await runMigrations(database);
    await database.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-p', 'tenant-a')`);
    await database.query(`ALTER TABLE artifacts.blobs DROP COLUMN placement`);
    await database.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size)
      VALUES ('scope-p', 'sha256:${'ab'.repeat(32)}', 3)`);
    const migration0014 = artifactMigrationAssets.find(
      (asset) => asset.id === '@sentropic/artifacts/migrations/0014_db_blob_placement.sql')!;
    await database.query(migration0014.read());
    expect((await database.query(`SELECT placement FROM artifacts.blobs WHERE storage_scope_id = 'scope-p'`)).rows)
      .toEqual([{ placement: 'object' }]);
    expect((await database.query(`SELECT to_regclass('artifacts.blob_bytes')::text AS bytes,
      to_regclass('artifacts.upload_staging_bytes')::text AS staging`)).rows)
      .toEqual([{ bytes: 'artifacts.blob_bytes', staging: 'artifacts.upload_staging_bytes' }]);
  });

  it('should rerun 0009-0013 idempotently without changing existing rows', async () => {
    await runMigrations(database);
    await database.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-kept', 'tenant-a')`);
    const before = await journal();
    await runMigrations(database);
    expect(await journal()).toEqual(before);
    expect((await database.query(`SELECT org_id FROM artifacts.storage_scopes WHERE id = 'scope-kept'`)).rows)
      .toEqual([{ org_id: 'tenant-a' }]);
  });

  it('should install unchanged package schemas and durable host state on an empty database', async () => {
    await runMigrations(database);
    expect(await journal()).toEqual(artifactMigrationAssets.map(({ id, sha256 }) => ({ asset_id: id, sha256 }))
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id)));
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
    expect(await journal()).toHaveLength(artifactMigrationAssets.length);
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
    expect(await journal()).toHaveLength(artifactMigrationAssets.length);
  });
});
