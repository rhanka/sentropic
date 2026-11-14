/**
 * CMF-S2 — host composition for composite blob placement.
 *
 * Env-gated and additive: without `APP_ARTIFACT_STORAGE_PLACEMENT` the host
 * keeps the S3-only behavior. `db` routes every blob to `blob_bytes`;
 * `db+s3` keeps small blobs inline and the rest on the object placement;
 * unknown modes refuse at boot. Reads resolve through the registered
 * `artifacts.blobs.placement`, probing DB then object for prepared blobs.
 */
import type { Pool } from 'pg';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import type { FinalizeTxClient } from '@sentropic/artifacts/server/commit-contract';
import { createPostgresDbBlobStore } from '@sentropic/artifacts/adapters/db-blob';
import { createCompositeBlobStore, type CompositeBlobMode } from '@sentropic/artifacts/adapters/composite-blob';

export type ArtifactBlobPlacementMode = CompositeBlobMode;

export function parseBlobPlacementMode(raw: string | undefined): ArtifactBlobPlacementMode {
  if (raw === undefined || raw === '') return 's3';
  if (raw === 'db' || raw === 's3' || raw === 'db+s3') return raw;
  throw new Error(`invalid artifact blob placement mode: ${raw}`);
}

export function parseBlobInlineMaxBytes(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 65536;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid artifact blob inline max bytes: ${raw}`);
  return value;
}

const BLOB_KEY_PATTERN = /^artifacts\/([A-Za-z0-9_-]+)\/blobs\/sha256\/([0-9a-f]{64})$/;

/** Read-only view of the registered placement (publication authority only writes). */
export function createPostgresBlobPlacements(pool: Pool) {
  return {
    async getPlacement(key: string): Promise<'db' | 'object' | undefined> {
      const match = BLOB_KEY_PATTERN.exec(key);
      if (!match) throw new Error(`invalid blob key: ${key}`);
      const { rows } = await pool.query<{ placement: string }>(
        'SELECT placement FROM artifacts.blobs WHERE storage_scope_id = $1 AND digest = $2',
        [match[1], `sha256:${match[2]}`],
      );
      const placement = rows[0]?.placement;
      if (placement === undefined) return undefined;
      if (placement !== 'db' && placement !== 'object') throw new Error(`unknown blob placement: ${placement}`);
      return placement;
    },
  };
}

/** Digest lock shared with the package GC claim store (`artifacts-blob:<digest>`). */
export function createBlobDigestLock(pool: Pool) {
  return async (digest: string, work: () => Promise<void>, transaction?: FinalizeTxClient): Promise<void> => {
    if (transaction) {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`artifacts-blob:${digest}`]);
      await work();
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`artifacts-blob:${digest}`]);
      await work();
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* already closed */ }
      throw error;
    } finally {
      client.release();
    }
  };
}

export interface PlacementBlobStoreOptions {
  readonly pool: Pool;
  readonly s3: PublicationBlobStore;
  readonly mode: ArtifactBlobPlacementMode;
  readonly inlineMaxBytes: number;
}

/** Composite store: DB bytes + object placement under one port. */
export function createPlacementBlobStore(options: PlacementBlobStoreOptions): PublicationBlobStore {
  return createCompositeBlobStore({ db: createPostgresDbBlobStore(options.pool), s3: options.s3,
    mode: options.mode, inlineMaxBytes: options.inlineMaxBytes,
    placements: createPostgresBlobPlacements(options.pool),
    withDigestLock: createBlobDigestLock(options.pool) });
}
