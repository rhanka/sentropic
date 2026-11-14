/**
 * CMF-S3 — placement migration both directions, never deletes the source.
 * Rehearsal on a copy: counts and digests equal, source intact, resume after
 * a crash mid-batch (simulated by stopping after one batch).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { Pool } from 'pg';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { createPostgresDbBlobStore } from '@sentropic/artifacts/adapters/db-blob';
import { migrateCmFixtureDatabase as runMigrations } from '../utils/cm-fresh-database';
import { createPlacementBlobStore } from '../../src/services/artifacts/blob-placement';
import { migratePlacement, parsePlacementMigrateArgs, runPlacementMigrateCli } from '../../src/scripts/cm-placement-migrate';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let pool: Pool;
let databaseName: string;
const SCOPE = 'scope-m';

function keyFor(bytes: Uint8Array): string {
  return `artifacts/${SCOPE}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

async function seedDbBlob(bytes: Uint8Array, placement: 'db' | 'object' = 'db'): Promise<string> {
  const key = keyFor(bytes);
  const digest = `sha256:${key.split('/').pop()}`;
  await pool.query(`INSERT INTO artifacts.blob_bytes (storage_scope_id, digest, bytes) VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING`, [SCOPE, digest, Buffer.from(bytes)]);
  await pool.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size, placement) VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING`, [SCOPE, digest, bytes.length, placement]);
  return key;
}

beforeEach(async () => {
  databaseName = `cmfs3_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await runMigrations(pool);
  await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, 'tenant-a')`, [SCOPE]);
});

afterEach(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
});

afterAll(() => admin.end());

describe('placement migration', () => {
  it.each(['unproven', 'referenced', 'pinned'] as const)('refuses a missing %s blob instead of certifying collection', async protection => {
    const bytes = new TextEncoder().encode(`missing ${protection}`);
    const key = await seedDbBlob(bytes);
    const digest = `sha256:${key.split('/').pop()}`;
    const db = createPostgresDbBlobStore(pool);
    await db.deleteBlob(key);
    if (protection !== 'unproven') {
      await pool.query(`INSERT INTO artifacts.object_intents (id, kind, state, payload)
        VALUES ($1, 'delete-blob', 'done', $2::jsonb)`, [randomUUID(), JSON.stringify({ deletionClaim: true, digest, blobKey: key })]);
      if (protection === 'referenced') await pool.query(
        'INSERT INTO artifacts.blob_ref_holders (digest, holder) VALUES ($1, $2)', [digest, 'release']);
      else await pool.query('INSERT INTO artifacts.blob_pins (digest, reason) VALUES ($1, $2)', [digest, 'upload']);
    }
    const s3 = createMemoryBlobStore();
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    await expect(migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'object' }))
      .rejects.toThrow(/blob missing/);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'db' }]);
  });

  it.each(['db', 'object'] as const)('migrates collected %s registry rows and completes image rollback/resume', async placement => {
    const bytes = new TextEncoder().encode(`collected ${placement}`);
    const key = await seedDbBlob(bytes, placement);
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    if (placement === 'object') await s3.putBlob(key, bytes);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    const { createArtifactHostJobs } = await import('../../src/services/artifacts/lifecycle');
    const jobs = createArtifactHostJobs({ pool, blobs: composite, authorize: async () => true,
      page: async () => ({ keys: [] }) });
    expect((await jobs.collect(SCOPE)).deleted).toEqual([key]);
    for (const to of ['db', 'object'] as const) {
      expect((await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to })).done).toBe(true);
    }
    const { readFileSync } = await import('node:fs');
    const client = await pool.connect();
    try {
      await client.query(readFileSync(new URL('../../src/services/artifacts/image-rollback.sql', import.meta.url), 'utf8'));
      const { installArtifactPackageAssets: previous } = await import('./artifacts-rollback-runner.fixture');
      await previous(pool);
      await client.query(readFileSync(new URL('../../src/services/artifacts/image-resume.sql', import.meta.url), 'utf8'));
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'object' }]);
    expect(await composite.getBlob(key)).toBeUndefined();
  });

  it('parses args with fail-closed bounds', () => {
    expect(parsePlacementMigrateArgs(['--scope', SCOPE, '--to', 'db'])).toMatchObject({ scope: SCOPE, to: 'db', batchSize: 100 });
    expect(() => parsePlacementMigrateArgs(['--scope', SCOPE, '--to', 'tape'])).toThrow(/--to db\|object/);
    expect(() => parsePlacementMigrateArgs(['--to', 'db'])).toThrow(/--scope/);
    expect(() => parsePlacementMigrateArgs(['--scope', SCOPE, '--to', 'db', '--batch-size', '0'])).toThrow(/1\.\.1000/);
    expect(() => parsePlacementMigrateArgs(['--scope', SCOPE, '--to', 'db', '--resume-from', 'nope'])).toThrow(/--resume-from/);
  });

  it('copies db to object and leaves the source intact', async () => {
    const bytes = new TextEncoder().encode('migrate me to object');
    const key = await seedDbBlob(bytes, 'db');
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    const report = await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'object' });
    expect(report.done).toBe(true);
    expect(report.totalBefore).toBe(1);
    expect(report.totalAfter).toBe(1);
    expect(report.beforeByPlacement).toEqual({ db: 1 });
    expect(report.afterByPlacement).toEqual({ object: 1 });
    expect(report.nextCursor).toBeUndefined();
    expect(report.batches).toHaveLength(1);
    expect(report.batches[0]).toMatchObject({ copied: 1, alreadyPlaced: 0 });
    expect(await s3.getBlob(key)).toEqual(bytes);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'object' }]);
    // Complete migration verifies every row reached the target placement.
    expect((await pool.query(`SELECT count(*)::int AS n FROM artifacts.blobs WHERE placement <> 'object'`)).rows)
      .toEqual([{ n: 0 }]);
    // Never deletes the source: the DB bytes survive the switch.
    expect((await pool.query('SELECT digest FROM artifacts.blob_bytes')).rows).toHaveLength(1);
  });

  it('copies object to db and leaves the source intact', async () => {
    const bytes = new TextEncoder().encode('migrate me to db');
    const key = keyFor(bytes);
    const digest = `sha256:${key.split('/').pop()}`;
    const s3 = createMemoryBlobStore();
    await s3.putBlob(key, bytes);
    await pool.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size, placement) VALUES ($1, $2, $3, 'object')`,
      [SCOPE, digest, bytes.length]);
    const db = createPostgresDbBlobStore(pool);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db+s3', inlineMaxBytes: 8 });
    const report = await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'db' });
    expect(report.done).toBe(true);
    expect(report.totalBefore).toBe(1);
    expect(report.totalAfter).toBe(1);
    expect(report.beforeByPlacement).toEqual({ object: 1 });
    expect(report.afterByPlacement).toEqual({ db: 1 });
    expect(report.batches[0]).toMatchObject({ copied: 1 });
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'db' }]);
    expect(await composite.getBlob(key)).toEqual(bytes);
    expect(await s3.getBlob(key)).toEqual(bytes);
  });

  it('resumes after a completed batch without losing or duplicating', async () => {
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    const keys: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      keys.push(await seedDbBlob(new TextEncoder().encode(`resume blob ${index}`), 'db'));
    }
    const first = await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'object', batchSize: 1, maxBatches: 1 });
    expect(first.done).toBe(false);
    expect(first.nextCursor).toBeDefined();
    expect(first.batches).toHaveLength(1);
    expect(first.batches[0]).toMatchObject({ copied: 1 });
    const second = await migratePlacement({ pool, composite, db, s3, scope: SCOPE,
      to: 'object', resumeFrom: first.nextCursor });
    expect(second.done).toBe(true);
    expect(second.totalBefore).toBe(3);
    expect(second.totalAfter).toBe(3);
    expect((await pool.query(`SELECT count(*)::int AS n FROM artifacts.blobs WHERE placement = 'object'`)).rows)
      .toEqual([{ n: 3 }]);
    for (const key of keys) {
      const bytes = await s3.getBlob(key);
      expect(bytes).toBeDefined();
    }
    // Re-running is a verified no-op: counts equal, digests equal, source intact.
    const third = await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'object' });
    expect(third.batches[0]).toMatchObject({ copied: 0, alreadyPlaced: 3 });
    expect(third.done).toBe(true);
    expect(third.beforeByPlacement).toEqual({ object: 3 });
    expect(third.afterByPlacement).toEqual({ object: 3 });
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.blob_bytes')).rows).toEqual([{ n: 3 }]);
  });

  it('resumes after SIGKILL between verified copies and the placement switch', async () => {
    const source = ['crash first', 'crash second'].map(text => new TextEncoder().encode(text));
    const keys = source.map(bytes => keyFor(bytes));
    for (const [index, key] of keys.entries()) {
      await seedDbBlob(source[index]!, 'object');
      await pool.query('DELETE FROM artifacts.blob_bytes WHERE digest = $1', [`sha256:${key.split('/').pop()}`]);
    }
    const script = `
      const { Pool } = require('pg');
      (async () => {
        const { migratePlacement } = await import('./src/scripts/cm-placement-migrate.ts');
        const { createPlacementBlobStore } = await import('./src/services/artifacts/blob-placement.ts');
        const { createMemoryBlobStore } = await import('@sentropic/artifacts/server/publication');
        const { createPostgresDbBlobStore } = await import('@sentropic/artifacts/adapters/db-blob');
        const pool = new Pool({connectionString: process.env.DATABASE_URL});
        try {
          const s3 = createMemoryBlobStore();
          for (const [key, bytes] of ${JSON.stringify(keys.map((key, i) => [key, [...source[i]!]]))}) {
            await s3.putBlob(key, new Uint8Array(bytes));
          }
          const db = createPostgresDbBlobStore(pool);
          const composite = createPlacementBlobStore({pool, s3, mode: 's3', inlineMaxBytes: 8});
          await migratePlacement({pool, s3, db, composite, scope: '${SCOPE}', to: 'db',
            beforePlacementSwitch: async () => {
              process.send('verified');
              await new Promise(() => {});
            }});
          process.send('completed');
        } finally { await pool.end(); }
      })().catch(() => { process.exitCode = 1; });`;
    const child = fork('-e', [script], { execArgv: ['--import', 'tsx'],
      env: { ...process.env, DATABASE_URL: pool.options.connectionString }, silent: true });
    const exit = await new Promise((resolve, reject) => {
      let message: unknown;
      child.on('message', value => { message = value; if (value === 'verified') child.kill('SIGKILL'); });
      child.on('error', reject);
      child.on('exit', (code, signal) => resolve({ message, code, signal }));
    });
    expect(exit).toEqual({ message: 'verified', code: null, signal: 'SIGKILL' });
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual(source.map(() => ({ placement: 'object' })));
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    for (const [i, key] of keys.entries()) {
      expect(await db.getBlob(key)).toEqual(source[i]);
      await s3.putBlob(key, source[i]!);
    }
    const composite = createPlacementBlobStore({ pool, s3, mode: 's3', inlineMaxBytes: 8 });
    expect((await migratePlacement({ pool, composite, db, s3, scope: SCOPE, to: 'db' })).done).toBe(true);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual(source.map(() => ({ placement: 'db' })));
    for (const [i, key] of keys.entries()) expect(await s3.getBlob(key)).toEqual(source[i]);
  });

  it('requires an extra resume when batches exactly fill maxBatches', async () => {
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    for (let index = 0; index < 2; index += 1) {
      await seedDbBlob(new TextEncoder().encode(`exact batch ${index}`), 'db');
    }
    const first = await migratePlacement({ pool, composite, db, s3, scope: SCOPE,
      to: 'object', batchSize: 1, maxBatches: 2 });
    expect(first.done).toBe(false);
    expect(first.nextCursor).toBeDefined();
    expect(first.batches).toHaveLength(2);
    const second = await migratePlacement({ pool, composite, db, s3, scope: SCOPE,
      to: 'object', resumeFrom: first.nextCursor });
    expect(second.done).toBe(true);
    expect(second.totalBefore).toBe(2);
    expect(second.totalAfter).toBe(2);
    expect((await pool.query(`SELECT count(*)::int AS n FROM artifacts.blobs WHERE placement = 'object'`)).rows)
      .toEqual([{ n: 2 }]);
  });

  it('exposes an executable CLI that reports per-placement counts', async () => {
    const bytes = new TextEncoder().encode('cli migrate me');
    await seedDbBlob(bytes, 'db');
    const s3 = createMemoryBlobStore();
    const logs: string[] = [];
    const errors: string[] = [];
    const stdout = console.log;
    const stderr = console.error;
    console.log = (line: string) => { logs.push(String(line)); };
    console.error = (line: string) => { errors.push(String(line)); };
    const exitCode = process.exitCode;
    try {
      await runPlacementMigrateCli({ argv: ['node', 'api', '--placement-migrate', '--scope', SCOPE, '--to', 'object'], pool, s3 });
      expect(process.exitCode).toBe(exitCode);
      expect(errors).toEqual([]);
      const report = JSON.parse(logs[logs.length - 1]!);
      expect(report.status).toBe('done');
      expect(report.scope).toBe(SCOPE);
      expect(report.to).toBe('object');
      expect(report.beforeByPlacement).toEqual({ db: 1 });
      expect(report.afterByPlacement).toEqual({ object: 1 });
      expect(report.done).toBe(true);
    } finally {
      console.log = stdout;
      console.error = stderr;
      process.exitCode = exitCode;
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM artifacts.blobs WHERE placement = 'object'`)).rows)
      .toEqual([{ n: 1 }]);
  });

  it('refuses CLI execution without a scope', async () => {
    const s3 = createMemoryBlobStore();
    const errors: string[] = [];
    const stderr = console.error;
    console.error = (line: string) => { errors.push(String(line)); };
    const exitCode = process.exitCode;
    try {
      await runPlacementMigrateCli({ argv: ['node', 'api', '--placement-migrate', '--to', 'object'], pool, s3 });
      expect(process.exitCode).toBe(1);
      const report = JSON.parse(errors[errors.length - 1]!);
      expect(report.status).toBe('failed');
    } finally {
      console.error = stderr;
      process.exitCode = exitCode;
    }
  });
});
