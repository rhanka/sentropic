/**
 * CMF-S3 — placement migration both directions, never deletes the source.
 * Rehearsal on a copy: counts and digests equal, source intact, resume after
 * a crash mid-batch (simulated by stopping after one batch).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { createPostgresDbBlobStore } from '@sentropic/artifacts/adapters/db-blob';
import { migrateCmFixtureDatabase as runMigrations } from '../utils/cm-fresh-database';
import { createPlacementBlobStore } from '../../src/services/artifacts/blob-placement';
import { migratePlacement, parsePlacementMigrateArgs } from '../../src/scripts/cm-placement-migrate';

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
    expect(report.batches).toHaveLength(1);
    expect(report.batches[0]).toMatchObject({ copied: 1, alreadyPlaced: 0 });
    expect(await s3.getBlob(key)).toEqual(bytes);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'object' }]);
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
    expect(report.batches[0]).toMatchObject({ copied: 1 });
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'db' }]);
    expect(await composite.getBlob(key)).toEqual(bytes);
    expect(await s3.getBlob(key)).toEqual(bytes);
  });

  it('resumes after a crash mid-batch without losing or duplicating', async () => {
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
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.blob_bytes')).rows).toEqual([{ n: 3 }]);
  });
});
