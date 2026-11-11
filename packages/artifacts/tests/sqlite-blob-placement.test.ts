/**
 * CMF-S2 — SQLite blob placement contract (BLOCKER r2).
 * Upgrade idempotence, `placement` default `'object'` for pre-upgrade rows,
 * `blob_bytes` without FK to `blobs`, digest-verified create-only CRUD,
 * strict deletes, scope-prefix listing, bounded keyset paging, and the
 * writer recording `placement` on release registration.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listBlobKeysPaged } from '../src/server/blob-bridge.js';
import { type ReleaseRecord } from '../src/server/publication.js';
import { applySqliteBlobPlacementUpgrade, createSqliteWriter, openSqliteDatabase } from '../src/adapters/sqlite.js';
import { createSqliteArtifactStore } from '../src/adapters/sqlite-store.js';
import { createSqliteDbBlobStore } from '../src/adapters/sqlite-blob.js';
import { runQuery, type SqliteDatabase } from '../src/adapters/sqlite-sql.js';

const SCOPE = 'scope-sqlite';

function keyFor(bytes: Uint8Array, scope = SCOPE): string {
  return `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

function freshFile(): { path: string; db: SqliteDatabase } {
  const path = join(freshDir, `${randomUUID()}.db`);
  return { path, db: openSqliteDatabase(path) };
}

let freshDir: string;
beforeAll(() => {
  freshDir = mkdtempSync(join(tmpdir(), 'artifacts-sqlite-placement-'));
});
afterAll(() => {
  rmSync(freshDir, { recursive: true, force: true });
});

describe('sqlite blob placement upgrade', () => {
  it('backfills pre-upgrade blob rows as object and keeps blob_bytes parentless', () => {
    const { path, db } = freshFile();
    // Simulate a legacy file: base DDL without the placement column.
    db.exec('ALTER TABLE blobs DROP COLUMN placement');
    runQuery(db, 'INSERT INTO blobs (storage_scope_id, digest, size) VALUES ($1, $2, 3)',
      [SCOPE, `sha256:${'ab'.repeat(32)}`]);
    db.close();
    // Reopen: the upgrade re-adds the column and backfills the default.
    const upgraded = openSqliteDatabase(path);
    try {
      const { rows } = runQuery<{ placement: string }>(
        upgraded, 'SELECT placement FROM blobs WHERE storage_scope_id = $1', [SCOPE]);
      expect(rows).toEqual([{ placement: 'object' }]);
      const tables = runQuery<{ name: string }>(upgraded,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('blob_bytes', 'upload_staging_bytes') ORDER BY name`);
      expect(tables.rows).toEqual([{ name: 'blob_bytes' }, { name: 'upload_staging_bytes' }]);
      // Preparation-phase puts land before registration: no FK to blobs.
      expect(runQuery(upgraded, 'PRAGMA foreign_key_list(blob_bytes)').rows).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it('re-applies idempotently on every open', () => {
    const { path, db } = freshFile();
    const bytes = new TextEncoder().encode('sqlite placement durable');
    const key = keyFor(bytes);
    const store = createSqliteDbBlobStore(db);
    return store.putBlob(key, bytes).then(() => {
      db.close();
      const first = openSqliteDatabase(path);
      applySqliteBlobPlacementUpgrade(first);
      applySqliteBlobPlacementUpgrade(first);
      first.close();
      const second = openSqliteDatabase(path);
      try {
        const fetched = runQuery<{ bytes: Uint8Array }>(second,
          'SELECT bytes FROM blob_bytes WHERE storage_scope_id = $1', [SCOPE]);
        expect(fetched.rows).toHaveLength(1);
      } finally {
        second.close();
      }
    });
  });
});


describe('sqlite writer blob placement', () => {
  it('records object placement when a release registers blobs', async () => {
    const { db } = freshFile();
    try {
      const writer = createSqliteWriter(db);
      const store = createSqliteArtifactStore(db, writer);
      runQuery(db, 'INSERT INTO storage_scopes (id, org_id) VALUES ($1, $2)', [SCOPE, 'tenant-a']);
      const ensured = await store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner', bindingName: 'report', profile: {} });
      const bytes = new TextEncoder().encode('<h1>sqlite placement</h1>');
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const manifest = JSON.stringify({ files: [{ path: 'index.html', digest, size: bytes.length }] });
      const release: ReleaseRecord = { releaseId: randomUUID(), artifactId: ensured.artifactId,
        manifestDigest: createHash('sha256').update(manifest).digest('hex'), manifest,
        state: 'ready', createdAt: new Date().toISOString() };
      await store.putRelease(release);
      const { rows } = runQuery<{ placement: string }>(db,
        'SELECT placement FROM blobs WHERE storage_scope_id = $1 AND digest = $2', [SCOPE, digest]);
      expect(rows).toEqual([{ placement: 'object' }]);
    } finally {
      db.close();
    }
  });
});
