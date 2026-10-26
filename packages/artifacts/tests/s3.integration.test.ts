/**
 * L-5b — S3 adapter proof on disposable minio (spec-v8 §9 5b).
 *
 * The adapter implements the publication blob store over an injected bucket:
 * digest-addressed keys only, hostile paths refused before any network call,
 * absent objects read as undefined, prefix listing for orphans. Each run
 * uses its own bucket, emptied and removed afterwards. Runs only under
 * `make test-artifacts-integration`.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createS3BlobStore } from '../src/adapters/s3.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import { ArtifactOperationError } from '../src/server/failures.js';

function s3Env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`s3 proof needs ${name} (make test-artifacts-integration)`);
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

const BUCKET = `itest-${Date.now()}-${process.pid}`;
const KEY_A = `artifacts/scope-1/blobs/sha256/${'aa'.repeat(32)}`;
const KEY_B = `artifacts/scope-1/blobs/sha256/${'bb'.repeat(32)}`;
const KEY_OTHER = `artifacts/scope-9/blobs/sha256/${'cc'.repeat(32)}`;

const blobs = createS3BlobStore({
  client,
  bucket: BUCKET,
});

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
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

describe('s3 blob store', () => {
  it('round-trips bytes and reads absent as undefined', async () => {
    const bytes = owe([0, 255, 1, 2, 3]);
    await blobs.putBlob(KEY_A, bytes);
    expect(await blobs.getBlob(KEY_A)).toEqual(bytes);
    expect(await blobs.getBlob(KEY_B)).toBeUndefined();
  });

  it('lists keys under a prefix for orphans', async () => {
    await blobs.putBlob(KEY_A, owe([1]));
    await blobs.putBlob(KEY_B, owe([2]));
    await blobs.putBlob(KEY_OTHER, owe([3]));
    expect(await blobs.listKeys('artifacts/scope-1/blobs/')).toEqual([KEY_A, KEY_B]);
    expect(await blobs.listKeys('artifacts/scope-9/blobs/')).toEqual([KEY_OTHER]);
  });

  it('refuses hostile paths before any network call', async () => {
    const hostile = [
      '../evil',
      '/absolute',
      'other/prefix/x',
      'artifacts/scope-1/blobs/sha256/ZZZ',
      'artifacts/../scope-1/blobs/sha256/aa',
      '',
    ];
    for (const key of hostile) {
      await expect(blobs.putBlob(key, owe([1]))).rejects.toThrow(/key/);
      await expect(blobs.getBlob(key)).rejects.toThrow(/key/);
    }
    await expect(blobs.listKeys('')).rejects.toThrow(/prefix/);
    await expect(blobs.listKeys('../x')).rejects.toThrow(/prefix/);
  });
});

describe.each([
  ['memory', createMemoryBlobStore()],
  ['S3', blobs],
] as const)('%s listKeys prefix parity', (_name, store) => {
  it.each(['', '..', '../x', 'artifacts/../scope-1/', 'artifacts/scope..1/', 'artifacts/scope-1/..'])
    ('should reject invalid prefix %j with a stable typed error', async (prefix) => {
      await store.putBlob(KEY_A, owe([1]));
      const result = Promise.resolve().then(() => store.listKeys(prefix));
      await expect(result).rejects.toThrow(new Error(`invalid blob prefix: ${prefix}`));
      await expect(result).rejects.toBeInstanceOf(ArtifactOperationError);
      await expect(result).rejects.toMatchObject({ kind: 'invalid_request', code: 'invalid_blob_prefix' });
    });

  it.each([
    ['artifacts/scope-1/blobs/', [KEY_A, KEY_B]],
    ['artifacts/scope-9/blobs/', [KEY_OTHER]],
    ['artifacts/', [KEY_A, KEY_B, KEY_OTHER]],
    [KEY_A, [KEY_A]],
    ['artifacts/missing/', []],
    ['artifacts/scope.1/', []],
  ] as const)('should return sorted matching keys for valid prefix %j', async (prefix, expected) => {
    await store.putBlob(KEY_OTHER, owe([3]));
    await store.putBlob(KEY_B, owe([2]));
    await store.putBlob(KEY_A, owe([1]));
    expect(await store.listKeys(prefix)).toEqual(expected);
  });
});
