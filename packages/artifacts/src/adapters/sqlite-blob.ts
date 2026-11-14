/**
 * CMF-S2 — SQLite DB blob placement (`blob_bytes`).
 *
 * SQLite equivalent of `db-blob.ts`: digest-addressed blobs in the
 * `blob_bytes` table (no FK to `blobs`, so preparation-phase puts succeed
 * before registration). Create-only (`ON CONFLICT DO NOTHING`) + read-back
 * verification: identical retries are idempotent, different bytes fail closed
 * without overwriting.
 */
import type { BlobKeyPage, BlobKeyPageResult, PublicationBlobStore } from '../server/publication.js';
import { assertBlobPrefix } from '../server/blob-prefix.js';
import { cloneBlobBytes, verifyBytesForKey, verifyStoredBytesForKey } from '../server/blob-bridge.js';
import { runQuery, type SqliteDatabase } from './sqlite-sql.js';

/** Per-call fetch cap: one page never materializes more than this. */
const PAGE_FETCH_CAP = 1000;

const BLOB_KEY_PATTERN = /^artifacts\/([A-Za-z0-9_-]+)\/blobs\/sha256\/([0-9a-f]{64})$/;
const SCOPE_PREFIX_PATTERN = /^artifacts\/([A-Za-z0-9_-]+)\/blobs\/sha256\//;

function splitKey(key: string): { scope: string; digest: string } {
  const match = BLOB_KEY_PATTERN.exec(key);
  if (!match) throw new Error(`invalid blob key: ${key}`);
  return { scope: match[1]!, digest: `sha256:${match[2]!}` };
}

/** Create a SQLite-backed blob store over an open database (no env reads). */
export function createSqliteDbBlobStore(db: SqliteDatabase): PublicationBlobStore {
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      const snapshot = cloneBlobBytes(bytes);
      verifyBytesForKey(key, snapshot);
      const { scope, digest } = splitKey(key);
      runQuery(
        db,
        `INSERT INTO blob_bytes (storage_scope_id, digest, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (storage_scope_id, digest) DO NOTHING`,
        [scope, digest, Buffer.from(snapshot)],
      );
      const stored = await this.getBlob(key);
      if (stored === undefined) throw new Error(`blob missing after write: ${key}`);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      const { scope, digest } = splitKey(key);
      const { rows } = runQuery<{ bytes: Uint8Array }>(
        db,
        'SELECT bytes FROM blob_bytes WHERE storage_scope_id = $1 AND digest = $2',
        [scope, digest],
      );
      if (rows[0] === undefined) return undefined;
      return verifyStoredBytesForKey(key, new Uint8Array(rows[0].bytes as unknown as ArrayLike<number>));
    },
    async getBlobRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | undefined> {
      const stored = await this.getBlob(key);
      if (stored === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive) ||
        start < 0 || endInclusive < start) return undefined;
      return stored.slice(start, Math.min(endInclusive + 1, stored.length));
    },
    async listKeys(prefix: string): Promise<string[]> {
      assertBlobPrefix(prefix);
      const match = SCOPE_PREFIX_PATTERN.exec(prefix);
      if (!match) throw new Error(`blob listing requires a scope prefix: ${prefix}`);
      const { rows } = runQuery<{ digest: string }>(
        db,
        'SELECT digest FROM blob_bytes WHERE storage_scope_id = $1 ORDER BY digest',
        [match[1]],
      );
      return rows
        .map((row) => `artifacts/${match[1]}/blobs/sha256/${row.digest.slice('sha256:'.length)}`)
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    async deleteBlob(key: string): Promise<void> {
      const { scope, digest } = splitKey(key);
      const result = runQuery(
        db,
        'DELETE FROM blob_bytes WHERE storage_scope_id = $1 AND digest = $2',
        [scope, digest],
      );
      if (result.rowCount === 0) throw new Error(`unknown blob: ${key}`);
    },
    async listKeysPaged(prefix: string, page: BlobKeyPage): Promise<BlobKeyPageResult> {
      assertBlobPrefix(prefix);
      const match = SCOPE_PREFIX_PATTERN.exec(prefix);
      if (!match) throw new Error(`blob listing requires a scope prefix: ${prefix}`);
      if (!Number.isSafeInteger(page.maxItems) || page.maxItems < 1) throw new Error('invalid blob page maxItems');
      const after = page.startAfter === undefined ? undefined : (() => {
        if (!page.startAfter.startsWith(prefix)) throw new Error(`invalid blob page resume key: ${page.startAfter}`);
        return splitKey(page.startAfter).digest;
      })();
      const limit = Math.min(page.maxItems + 1, PAGE_FETCH_CAP);
      const { rows } = runQuery<{ digest: string }>(
        db,
        `SELECT digest FROM blob_bytes WHERE storage_scope_id = $1
         AND substr(digest, 1, length($2)) = $2
         AND ($3 IS NULL OR digest > $3) ORDER BY digest LIMIT $4`,
        [match[1], `sha256:${prefix.slice(match[0].length)}`, after ?? null, limit],
      );
      const keys = rows.map((row) => `artifacts/${match[1]}/blobs/sha256/${row.digest.slice('sha256:'.length)}`)
        .filter((key) => key.startsWith(prefix))
        .sort();
      return { keys: keys.slice(0, page.maxItems), hasMore: rows.length === limit };
    },
  };
}
