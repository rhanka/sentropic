/**
 * L-5b — publication end to end on disposable postgres+minio (spec-v8 §9 5b).
 *
 * The real publication service over the Postgres store and the S3 store
 * commits a small original HTML view: the release is served only after all
 * final bytes exist in the bucket and the DB transaction succeeds. A crash
 * between blobs and commit leaves a DB-pending intent and nothing visible;
 * reconcile marks it failed and an explicit retry converges. No HTTP layer
 * exists in 5b (http.ts arrives in 5c), so this proves service→DB/S3; the
 * HTTP leg is covered by `http-mcp-service-parity.test.ts` in L-5c.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createPublicationService } from '../src/server/publication.js';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createS3BlobStore } from '../src/adapters/s3.js';
import { reconcileIntents, type ObjectIntent } from '../src/server/object-intents.js';
import { parseManifest } from '../src/codecs.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`publication e2e needs ${name} (make test-artifacts-integration)`);
  }
  return value;
}

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0001_artifacts.sql'),
  'utf8',
);

const pool = new Pool({ connectionString: required('DATABASE_URL') });
const s3 = new S3Client({
  endpoint: required('ARTIFACTS_S3_ENDPOINT'),
  region: required('ARTIFACTS_S3_REGION'),
  credentials: {
    accessKeyId: required('ARTIFACTS_S3_ACCESS_KEY_ID'),
    secretAccessKey: required('ARTIFACTS_S3_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
});
const BUCKET = `itest-e2e-${Date.now()}-${process.pid}`;

const pgStore = createPostgresArtifactStore(pool);
const service = createPublicationService({
  state: pgStore,
  blobs: createS3BlobStore({ client: s3, bucket: BUCKET }),
  intents: pgStore,
  idempotency: pgStore,
});

const HTML = new TextEncoder().encode('<!doctype html><html><body>Hello</body></html>');
const INPUT = {
  ownerId: 'owner-1',
  storageScopeId: 'scope-1',
  artifactId: '11111111-1111-4111-8111-111111111111',
  profile: { title: 'Hello' },
  files: [{ path: 'index.html', mimeType: 'text/html', bytes: HTML }],
};

beforeAll(async () => {
  const setup = new Pool({ connectionString: required('DATABASE_URL') });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query(SQL);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
  await setup.end();
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
});

afterAll(async () => {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key as string }));
  if (objects.length !== 0) {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
  }
  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
  s3.destroy();
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.end();
});

describe('publication end to end', () => {
  it('serves the view only after bytes and transaction succeed', async () => {
    const { releaseId, manifest } = await service.publish({
      ...INPUT,
      idempotencyKey: 'e2e-1',
      paramsHash: 'h-1',
    });
    const parsed = parseManifest(manifest);
    expect(parsed.digest).toMatch(/^[0-9a-f]{64}$/);
    const current = await service.getCurrent(INPUT.artifactId);
    expect(current?.releaseId).toBe(releaseId);
    const [file] = parsed.files as { digest: string; size: number }[];
    const hex = (file?.digest ?? '').replace(/^sha256:/, '');
    const stored = await createS3BlobStore({ client: s3, bucket: BUCKET }).getBlob(
      `artifacts/scope-1/blobs/sha256/${hex}`,
    );
    expect(stored).toEqual(HTML);
    expect(await pgStore.listRegisteredBlobs('scope-1')).toContain(`sha256:${hex}`);
  });

  it('recovers a mid-commit crash through reconcile and retry', async () => {
    const crashing = createS3BlobStore({ client: s3, bucket: BUCKET });
    const realPut = crashing.putBlob.bind(crashing);
    let puts = 0;
    crashing.putBlob = async (key: string, bytes: Uint8Array) => {
      puts += 1;
      if (puts === 1) throw new Error('e2e crash');
      return realPut(key, bytes);
    };
    const crashingService = createPublicationService({
      state: pgStore,
      blobs: crashing,
      intents: pgStore,
      idempotency: pgStore,
    });
    await expect(
      crashingService.publish({ ...INPUT, idempotencyKey: 'e2e-2', paramsHash: 'h-1' }),
    ).rejects.toThrow(/e2e crash/);
    const pending = await pgStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.kind).toBe('commit-release');
    const report = await reconcileIntents(pgStore, async (intent: ObjectIntent) => {
      const releaseId = intent.payload['releaseId'];
      const stored = typeof releaseId === 'string' ? await pgStore.getRelease(releaseId) : undefined;
      return stored === undefined ? 'failed' : 'done';
    });
    expect(report.failed.length).toBe(1);
    const retried = await service.publish({ ...INPUT, idempotencyKey: 'e2e-3', paramsHash: 'h-1' });
    expect((await service.getCurrent(INPUT.artifactId))?.releaseId).toBe(retried.releaseId);
    expect(await pgStore.listPending()).toEqual([]);
  });
});
