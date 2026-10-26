import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/run-migrations';
import {
  artifactMigrationAssets,
  createArtifactHostKv,
  installArtifactPackageAssets,
} from '../../src/services/artifacts/host-storage';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let database: Pool;
let databaseName: string;
let connectionString: string;

beforeEach(async () => {
  databaseName = `w1a_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  connectionString = url.toString();
  database = new Pool({ connectionString });
});

afterEach(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
});

afterAll(() => admin.end());

async function journal() {
  return (await database.query(`SELECT asset_id, sha256 FROM control.artifact_package_migrations ORDER BY asset_id`)).rows;
}

describe('artifact host migrations', () => {
  it('should install unchanged package schemas and durable host state on an empty database', async () => {
    await runMigrations(database);
    expect(await journal()).toEqual(artifactMigrationAssets.map(({ id, sha256 }) => ({ asset_id: id, sha256 })));
    const { rows } = await database.query(`SELECT to_regclass('artifacts.operation_receipts')::text AS receipts,
      to_regclass('artifacts.blob_ref_holders')::text AS refs,
      to_regclass('control.artifact_host_kv')::text AS kv`);
    expect(rows[0]).toEqual({ receipts: 'artifacts.operation_receipts', refs: 'artifacts.blob_ref_holders', kv: 'control.artifact_host_kv' });
  });

  it('should retain journal timestamps and rows on rerun', async () => {
    await runMigrations(database);
    const before = await database.query('SELECT * FROM control.artifact_package_migrations ORDER BY asset_id');
    await createArtifactHostKv(database, 'scope-a').putIfAbsent('binding/a', 'original');
    await runMigrations(database);
    expect((await database.query('SELECT * FROM control.artifact_package_migrations ORDER BY asset_id')).rows).toEqual(before.rows);
    expect(await createArtifactHostKv(database, 'scope-a').get('binding/a')).toBe('original');
  });

  it('should refuse a changed asset before executing any pending SQL', async () => {
    await runMigrations(database);
    await database.query('DELETE FROM control.artifact_package_migrations');
    const load = (id: string) => `${artifactMigrationAssets.find((asset) => asset.id === id)!.read()}\nSELECT 1;`;
    await expect(installArtifactPackageAssets(database, load)).rejects.toThrow(/asset hash mismatch/);
    expect(await journal()).toEqual([]);
  });

  it('should refuse an installed journal hash mismatch without replacing its receipt', async () => {
    await runMigrations(database);
    await database.query(`UPDATE control.artifact_package_migrations SET sha256 = repeat('0', 64) WHERE asset_id = $1`, [artifactMigrationAssets[0].id]);
    const before = await journal();
    await expect(runMigrations(database)).rejects.toThrow(/journal hash mismatch/);
    expect(await journal()).toEqual(before);
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
    // A separate OS process has no access to a process-local KV or migration cache.
    const script = `const { Pool } = require('pg'); const pool = new Pool({connectionString: process.env.DATABASE_URL});
      pool.query('SELECT value FROM control.artifact_host_kv WHERE storage_scope_id = $1 AND key = $2', ['scope-a', 'scope/binding'])
        .then(r => process.send(r.rows[0].value)).finally(() => pool.end());`;
    const observed = await new Promise((resolve, reject) => {
      const child = fork('-e', [script], { execArgv: [], env: { ...process.env, DATABASE_URL: connectionString }, silent: true });
      let message: unknown;
      child.on('message', (result) => { message = result; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve(message) : reject(new Error(`restart process exited ${code}`)));
    });
    database = new Pool({ connectionString });
    expect(observed).toBe(value);
    await runMigrations(database);
    expect(await createArtifactHostKv(database, 'scope-a').putIfAbsent('scope/binding', 'replacement')).toBe(false);
    expect(await journal()).toHaveLength(3);
  });
});
