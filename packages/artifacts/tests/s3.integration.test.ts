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
import { createHash } from 'node:crypto';
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

// CMF-S1: puts are digest-verified before any I/O, so every fixture key names
// the SHA-256 of its bytes; the round-trip key lives in its own scope and is
// deleted afterwards to keep the listing fixtures exact.
function keyFor(scope: string, bytes: Uint8Array): string {
  return `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}
const BYTES_A = new Uint8Array([1]);
const BYTES_B = new Uint8Array([2]);
const BYTES_OTHER = new Uint8Array([3]);
const BYTES_RT = new Uint8Array([0, 255, 1, 2, 3]);
const KEY_A = keyFor('scope-1', BYTES_A);
const KEY_B = keyFor('scope-1', BYTES_B);
const KEY_OTHER = keyFor('scope-9', BYTES_OTHER);
const KEY_RT = keyFor('scope-rt', BYTES_RT);

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
    await blobs.putBlob(KEY_RT, BYTES_RT);
    expect(await blobs.getBlob(KEY_RT)).toEqual(BYTES_RT);
    expect(await blobs.getBlob(KEY_B)).toBeUndefined();
    await blobs.deleteBlob(KEY_RT);
  });

  it('lists keys under a prefix for orphans', async () => {
    await blobs.putBlob(KEY_A, BYTES_A);
    await blobs.putBlob(KEY_B, BYTES_B);
    await blobs.putBlob(KEY_OTHER, BYTES_OTHER);
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
      await store.putBlob(KEY_A, BYTES_A);
      const result = Promise.resolve().then(() => store.listKeys(prefix));
      await expect(result).rejects.toBeInstanceOf(ArtifactOperationError);
      await expect(result).rejects.toMatchObject({
        message: `invalid blob prefix: ${prefix}`, kind: 'invalid_request', code: 'invalid_blob_prefix',
      });
    });

  it.each([
    ['artifacts/scope-1/blobs/', [KEY_A, KEY_B]],
    ['artifacts/scope-9/blobs/', [KEY_OTHER]],
    ['artifacts/', [KEY_A, KEY_B, KEY_OTHER]],
    [KEY_A, [KEY_A]],
    [KEY_RT, []],
    ['artifacts/missing/', []],
    ['artifacts/scope.1/', []],
  ] as const)('should return sorted matching keys for valid prefix %j', async (prefix, expected) => {
    await store.putBlob(KEY_OTHER, owe([3]));
    await store.putBlob(KEY_B, owe([2]));
    await store.putBlob(KEY_A, owe([1]));
    expect(await store.listKeys(prefix)).toEqual(expected);
  });
});
