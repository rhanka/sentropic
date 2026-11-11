/**
 * CMF-S3 — `placement-migrate` (both directions, never deletes the source).
 * Copies scope blobs to the target placement, verifies length and SHA-256,
 * switches `artifacts.blobs.placement` per bounded batch transaction. Source
 * copies are never touched; re-runs are idempotent; AP-3 counts fail on any total
 * decrease. Runs in the api image with DATABASE_URL + object-store env.
 */
import type { Pool } from 'pg';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import { verifyBytesForKey } from '@sentropic/artifacts/server/blob-bridge';

export interface PlacementMigrationOptions {
  readonly pool: Pool;
  /** Reads through the current registered placement (composite). */
  readonly composite: PublicationBlobStore;
  readonly db: PublicationBlobStore;
  readonly s3: PublicationBlobStore;
  readonly scope: string;
  readonly to: 'db' | 'object';
  readonly batchSize?: number;
  /** Resume after this `sha256:<hex>` digest (exclusive); restart when absent. */
  readonly resumeFrom?: string;
  /** Test hook: stop after this many batches. */
  readonly maxBatches?: number;
}

export interface PlacementMigrationBatch {
  readonly batch: number;
  readonly copied: number;
  readonly alreadyPlaced: number;
  readonly bytes: number;
  readonly lastDigest: string;
}

export interface PlacementMigrationReport {
  readonly scope: string;
  readonly to: 'db' | 'object';
  readonly batches: PlacementMigrationBatch[];
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly done: boolean;
  readonly nextCursor?: string;
}

interface BlobRow { digest: string; placement: string; size: number }

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function blobKey(scope: string, digest: string): string {
  return `artifacts/${scope}/blobs/sha256/${digest.slice('sha256:'.length)}`;
}

export function parsePlacementMigrateArgs(argv: readonly string[]): { scope: string; to: 'db' | 'object';
  batchSize: number; resumeFrom?: string } {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const scope = get('--scope');
  const to = get('--to');
  if (!scope || !/^[A-Za-z0-9_-]+$/.test(scope)) throw new Error('placement-migrate requires --scope <storage-scope-id>');
  if (to !== 'db' && to !== 'object') throw new Error('placement-migrate requires --to db|object');
  const batchSize = get('--batch-size') === undefined ? 100 : Number(get('--batch-size'));
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('placement-migrate requires --batch-size 1..1000');
  }
  const resumeFrom = get('--resume-from');
  if (resumeFrom !== undefined && !DIGEST_PATTERN.test(resumeFrom)) {
    throw new Error('placement-migrate requires --resume-from sha256:<64 hex>');
  }
  return { scope, to, batchSize, resumeFrom };
}

/** Migrate one scope to the target placement. Never deletes the source copy. */
export async function migratePlacement(options: PlacementMigrationOptions): Promise<PlacementMigrationReport> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('placement-migrate requires batchSize 1..1000');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.scope)) throw new Error('placement-migrate requires a valid scope');
  const target = options.to === 'db' ? options.db : options.s3; // single switch; never a delete path
  const before = await options.pool.query<{ placement: string; count: string }>(
    'SELECT placement, count(*)::text AS count FROM artifacts.blobs WHERE storage_scope_id = $1 GROUP BY placement',
    [options.scope],
  );
  const totalBefore = before.rows.reduce((sum, row) => sum + Number(row.count), 0);
  const batches: PlacementMigrationBatch[] = [];
  let cursor = options.resumeFrom;
  for (;;) {
    const { rows } = await options.pool.query<BlobRow>(
      `SELECT digest, placement, size FROM artifacts.blobs WHERE storage_scope_id = $1
       AND ($2::text IS NULL OR digest > $2) ORDER BY digest LIMIT $3`,
      [options.scope, cursor ?? null, batchSize],
    );
    if (rows.length === 0) break;
    let copied = 0;
    let alreadyPlaced = 0;
    let bytes = 0;
    const switched: string[] = [];
    for (const row of rows) {
      if (!DIGEST_PATTERN.test(row.digest)) throw new Error(`refusing unparseable digest: ${row.digest}`);
      const key = blobKey(options.scope, row.digest);
      if (row.placement === options.to) {
        // Already placed: verify the target still serves the bytes, copy nothing.
        const present = await target.getBlob(key);
        if (present === undefined) throw new Error(`placed blob missing in target: ${key}`);
        verifyBytesForKey(key, present);
        alreadyPlaced += 1;
        continue;
      }
      const content = await options.composite.getBlob(key);
      if (content === undefined) throw new Error(`blob missing in current placement: ${key}`);
      verifyBytesForKey(key, content);
      if (content.byteLength !== row.size) throw new Error(`blob size mismatch: ${key}`);
      await target.putBlob(key, content);
      const readBack = await target.getBlob(key);
      if (readBack === undefined) throw new Error(`blob missing after copy: ${key}`);
      verifyBytesForKey(key, readBack);
      if (readBack.byteLength !== content.byteLength) throw new Error(`copy size mismatch: ${key}`);
      copied += 1;
      bytes += content.byteLength;
      switched.push(row.digest);
    }
    if (switched.length > 0) {
      const client = await options.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE artifacts.blobs SET placement = $1
           WHERE storage_scope_id = $2 AND digest = ANY ($3::text[])`,
          [options.to, options.scope, switched],
        );
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* already closed */ }
        throw error;
      } finally {
        client.release();
      }
    }
    cursor = rows[rows.length - 1]!.digest;
    batches.push({ batch: batches.length + 1, copied, alreadyPlaced, bytes, lastDigest: cursor });
    if (options.maxBatches !== undefined && batches.length >= options.maxBatches) break;
  }
  const after = await options.pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM artifacts.blobs WHERE storage_scope_id = $1', [options.scope]);
  const totalAfter = Number(after.rows[0]?.count ?? '0');
  if (totalAfter !== totalBefore) throw new Error(`placement migration changed the row total: ${totalBefore} -> ${totalAfter}`);
  const done = options.maxBatches === undefined || batches.length < options.maxBatches;
  return { scope: options.scope, to: options.to, batches, totalBefore, totalAfter, done, ...(done ? {} : { nextCursor: cursor }) };
}
