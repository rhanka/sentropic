/**
 * CMF-S2 — Postgres DB blob placement (`artifacts.blob_bytes`).
 *
 * DB-mode `ArtifactBlobPort`: digest-addressed blobs in the `blob_bytes`
 * table (no FK to `artifacts.blobs`, so preparation-phase puts succeed before
 * `registerBlob`). Create-only (`ON CONFLICT DO NOTHING`) + read-back
 * verification: identical retries are idempotent, different bytes fail closed
 * without overwriting. The runtime role holds SELECT + INSERT only; DELETE
 * belongs to the lifecycle maintenance role (CR-5).
 */
import type { Pool } from 'pg';
import type { PublicationBlobStore } from '../server/publication.js';
import { assertBlobPrefix } from '../server/blob-prefix.js';
import { cloneBlobBytes, verifyBytesForKey, verifyStoredBytesForKey } from '../server/blob-bridge.js';

const BLOB_KEY_PATTERN = /^artifacts\/([A-Za-z0-9_-]+)\/blobs\/sha256\/([0-9a-f]{64})$/;
const SCOPE_PREFIX_PATTERN = /^artifacts\/([A-Za-z0-9_-]+)\/blobs\/sha256\//;

function splitKey(key: string): { scope: string; digest: string } {
  const match = BLOB_KEY_PATTERN.exec(key);
  if (!match) throw new Error(`invalid blob key: ${key}`);
  return { scope: match[1]!, digest: `sha256:${match[2]!}` };
}

/** Create a DB-backed blob store over an injected pg pool (no env reads). */
export function createPostgresDbBlobStore(pool: Pool): PublicationBlobStore {
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      const snapshot = cloneBlobBytes(bytes);
      verifyBytesForKey(key, snapshot);
      const { scope, digest } = splitKey(key);
      await pool.query(
        `INSERT INTO artifacts.blob_bytes (storage_scope_id, digest, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (storage_scope_id, digest) DO NOTHING`,
        [scope, digest, Buffer.from(snapshot)],
      );
      const stored = await this.getBlob(key);
      if (stored === undefined) throw new Error(`blob missing after write: ${key}`);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      const { scope, digest } = splitKey(key);
      const { rows } = await pool.query<{ bytes: Buffer }>(
        'SELECT bytes FROM artifacts.blob_bytes WHERE storage_scope_id = $1 AND digest = $2',
        [scope, digest],
      );
      if (rows[0] === undefined) return undefined;
      return verifyStoredBytesForKey(key, new Uint8Array(rows[0].bytes));
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
      const { rows } = await pool.query<{ digest: string }>(
        'SELECT digest FROM artifacts.blob_bytes WHERE storage_scope_id = $1 ORDER BY digest',
        [match[1]],
      );
      return rows
        .map((row) => `artifacts/${match[1]}/blobs/sha256/${row.digest.slice('sha256:'.length)}`)
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    async deleteBlob(key: string): Promise<void> {
      const { scope, digest } = splitKey(key);
      const result = await pool.query(
        'DELETE FROM artifacts.blob_bytes WHERE storage_scope_id = $1 AND digest = $2',
        [scope, digest],
      );
      if (result.rowCount === 0) throw new Error(`unknown blob: ${key}`);
    },
  };
}
