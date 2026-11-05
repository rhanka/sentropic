/**
 * Upload presign proof on the repo S3 double (minio, `make test-artifacts-integration`).
 *
 * The presigned PUT announces exactly the signed header set (`content-type`
 * + exact `content-length`, no `x-amz-*`): a real PUT carrying exactly those
 * headers returns 200 without any checksum header, and `commit_upload`
 * verifies the staged bytes server-side. A corrupted declaration is refused,
 * the S3 staging object is deleted, and nothing is pinned. Runs only under
 * `make test-artifacts-integration` (needs `ARTIFACTS_S3_*`).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  casBlobKey,
  commitStagedUpload,
  createMemoryUploadSessionStore,
  createUploadService,
  stagingKey,
} from '../src/server/uploads.js';
import { createS3StagingStore, createS3UploadSigner } from '../src/adapters/s3-uploads.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import { createMemoryRefcountStore } from '../src/server/gc.js';

function s3Env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`presign proof needs ${name} (make test-artifacts-integration)`);
  }
  return value;
}

const client = new S3Client({
  endpoint: s3Env('ARTIFACTS_S3_ENDPOINT'),
  region: s3Env('ARTIFACTS_S3_REGION'),
  credentials: {
    accessKeyId: s3Env('ARTIFACTS_S3_ACCESS_KEY_ID'),
    secretAccessKey: s3Env('ARTIFACTS_S3_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
});

const BUCKET = `presign-${Date.now()}-${process.pid}`;
const SCOPE = 'scope-1';
const base = { artifactId: '11111111-1111-1111-1111-111111111111', storageScopeId: SCOPE, ownerId: 'alice' };

const sha = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const png = (fill: number): Uint8Array => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill,
]);

const staging = createS3StagingStore({ client, bucket: BUCKET });
const signer = createS3UploadSigner({ client, bucket: BUCKET });

function makeService() {
  const sessions = createMemoryUploadSessionStore();
  const blobs = createMemoryBlobStore();
  const refs = createMemoryRefcountStore();
  const service = createUploadService({ sessions, staging, signer }, {
    maxUploadBytes: 1024, maxSessionsPerPrincipal: 8,
  });
  return { sessions, blobs, refs, service,
    deps: { sessions, staging, blobs, refs, budget: { filesMax: 8, totalBytesMax: 8192 } } };
}

beforeAll(async () => {
  await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
});

afterAll(async () => {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key as string }));
  if (objects.length !== 0) {
    await client.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
  }
  await client.send(new DeleteBucketCommand({ Bucket: BUCKET }));
  client.destroy();
});

describe('presigned upload channel on the S3 double', () => {
  it('PUTs with exactly the announced headers and commits the verified bytes', async () => {
    const { service, deps } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    expect(Object.keys(created.requiredHeaders).sort()).toEqual(['content-length', 'content-type']);
    expect(Object.keys(created.requiredHeaders).some((key) => key.startsWith('x-amz-'))).toBe(false);
    // The signature does not bind any checksum header: the channel works
    // without it on a real S3 implementation.
    const signedHeaders = new URL(created.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders.split(';')).not.toContain('x-amz-checksum-sha256');
    const bytes = png(3);
    const put = await fetch(created.uploadUrl, {
      method: 'PUT', headers: created.requiredHeaders, body: bytes,
    });
    expect(put.status).toBe(200);
    expect(await staging.get(created.stagingKey)).toEqual(bytes);
    const staged = await commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: sha(bytes), size: 12,
    });
    expect(staged).toMatchObject({ uploadId: created.uploadId, digest: sha(bytes), size: 12 });
    expect(await deps.blobs.getBlob(casBlobKey(SCOPE, sha(bytes)))).toEqual(bytes);
  });

  it('refuses a corrupted declaration and deletes the S3 staging object', async () => {
    const { sessions, blobs, service, deps } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    const bytes = png(4);
    expect((await fetch(created.uploadUrl, {
      method: 'PUT', headers: created.requiredHeaders, body: bytes,
    })).status).toBe(200);
    await expect(commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: sha(png(5)), size: 12,
    })).rejects.toThrow(/digest mismatch/);
    expect(await staging.get(created.stagingKey)).toBeUndefined();
    expect((await sessions.get(created.uploadId))!.state).toBe('expired');
    expect(await blobs.listKeys(`artifacts/${SCOPE}/blobs/`)).toEqual([]);
  });
});
