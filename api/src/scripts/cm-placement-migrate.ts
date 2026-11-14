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
  /** Qualification fault point after verified durable copies, before BEGIN. */
  readonly beforePlacementSwitch?: () => Promise<void>;
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
  readonly beforeByPlacement: Record<string, number>;
  readonly afterByPlacement: Record<string, number>;
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
  const beforeByPlacement: Record<string, number> = {};
  for (const row of before.rows) beforeByPlacement[row.placement] = Number(row.count);
  const totalBefore = Object.values(beforeByPlacement).reduce((sum, n) => sum + n, 0);
  const batches: PlacementMigrationBatch[] = [];
  let cursor = options.resumeFrom;
  let exhausted = false;
  for (;;) {
    const { rows } = await options.pool.query<BlobRow>(
      `SELECT digest, placement, size FROM artifacts.blobs WHERE storage_scope_id = $1
       AND ($2::text IS NULL OR digest > $2) ORDER BY digest LIMIT $3`,
      [options.scope, cursor ?? null, batchSize],
    );
    if (rows.length === 0) { exhausted = true; break; }
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
        if (present.byteLength !== row.size) throw new Error(`placed blob size mismatch: ${key}`);
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
      await options.beforePlacementSwitch?.();
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
  const after = await options.pool.query<{ placement: string; count: string }>(
    'SELECT placement, count(*)::text AS count FROM artifacts.blobs WHERE storage_scope_id = $1 GROUP BY placement',
    [options.scope]);
  const afterByPlacement: Record<string, number> = {};
  for (const row of after.rows) afterByPlacement[row.placement] = Number(row.count);
  const totalAfter = Object.values(afterByPlacement).reduce((sum, n) => sum + n, 0);
  if (totalAfter !== totalBefore) throw new Error(`placement migration changed the row total: ${totalBefore} -> ${totalAfter}`);
  const done = exhausted;
  if (done) {
    const remaining = await options.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM artifacts.blobs WHERE storage_scope_id = $1 AND placement <> $2',
      [options.scope, options.to]);
    const left = Number(remaining.rows[0]?.count ?? '0');
    if (left !== 0) throw new Error(`placement migration incomplete: ${left} rows still not in ${options.to}`);
  }
  return { scope: options.scope, to: options.to, batches, totalBefore, totalAfter,
    beforeByPlacement, afterByPlacement, done, ...(done ? {} : { nextCursor: cursor }) };
}

export interface PlacementMigrateCliDeps {
  readonly argv?: readonly string[];
  readonly pool?: import('pg').Pool;
  readonly s3?: import('@sentropic/artifacts/server/publication').PublicationBlobStore;
}

/** CLI entrypoint for the api image: `node dist/index.js --placement-migrate --scope <id> --to db|object [--batch-size N] [--resume-from sha256:<hex>]`. */
export async function runPlacementMigrateCli(deps: PlacementMigrateCliDeps = {}): Promise<void> {
  const argv = deps.argv ?? process.argv;
  const env = process.env;
  let pool: import('pg').Pool | undefined = deps.pool;
  let ownedPool = false;
  try {
    const args = parsePlacementMigrateArgs(argv);
    const connectionString = env.DATABASE_URL;
    if (!connectionString) throw new Error('placement-migrate requires DATABASE_URL');
    if (!pool) {
      const { Pool } = await import('pg');
      pool = new Pool({ connectionString });
      ownedPool = true;
    }
    const { createPostgresDbBlobStore } = await import('@sentropic/artifacts/adapters/db-blob');
    const { createPlacementBlobStore, parseBlobInlineMaxBytes, parseBlobPlacementMode } =
      await import('../services/artifacts/blob-placement');
    let s3 = deps.s3;
    let s3Client: import('@aws-sdk/client-s3').S3Client | undefined;
    if (!s3) {
      const bucket = env.APP_ARTIFACT_S3_BUCKET;
      const region = env.APP_ARTIFACT_S3_REGION;
      const accessKeyId = env.APP_ARTIFACT_S3_ACCESS_KEY_ID;
      const secretAccessKey = env.APP_ARTIFACT_S3_SECRET_ACCESS_KEY;
      if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        throw new Error('placement-migrate requires APP_ARTIFACT_S3_BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY');
      }
      const { S3Client } = await import('@aws-sdk/client-s3');
      s3Client = new S3Client({ region, endpoint: env.APP_ARTIFACT_S3_ENDPOINT,
        forcePathStyle: Boolean(env.APP_ARTIFACT_S3_ENDPOINT),
        credentials: { accessKeyId, secretAccessKey } });
      const { createS3BlobStore } = await import('@sentropic/artifacts/adapters/s3');
      s3 = createS3BlobStore({ client: s3Client, bucket });
    }
    const db = createPostgresDbBlobStore(pool);
    const mode = parseBlobPlacementMode(env.APP_ARTIFACT_STORAGE_PLACEMENT);
    const inlineMaxBytes = parseBlobInlineMaxBytes(env.APP_ARTIFACT_STORAGE_INLINE_MAX_BYTES);
    const composite = createPlacementBlobStore({ pool, s3, mode, inlineMaxBytes });
    const report = await migratePlacement({ pool, composite, db, s3,
      scope: args.scope, to: args.to, batchSize: args.batchSize, resumeFrom: args.resumeFrom });
    console.log(JSON.stringify({ status: 'done', ...report }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: (error as Error).message }));
    process.exitCode = 1;
  } finally {
    if (ownedPool) await pool?.end();
  }
}
