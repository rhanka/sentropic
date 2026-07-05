/**
 * artifact-store.test.ts — BR-52 ArtifactStorePort.
 *
 * Covers the LocalFsArtifactStore contract end-to-end (no external deps) and the
 * S3ArtifactStore delegation/checksum behaviour against a mocked storage-s3 module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalFsArtifactStore } from '../../src/services/artifact-store/local-fs-artifact-store';
import { S3ArtifactStore } from '../../src/services/artifact-store/s3-artifact-store';
import {
  ArtifactChecksumMismatchError,
  ArtifactNotFoundError,
} from '../../src/services/artifact-store/port';

vi.mock('../../src/services/storage-s3', () => ({
  putObject: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({})),
  getObjectBytes: vi.fn(async () => new Uint8Array()),
  getObjectBodyStream: vi.fn(async () => new ReadableStream<Uint8Array>()),
  deleteObject: vi.fn(async () => undefined),
  getDocumentsBucketName: vi.fn(() => 'documents'),
}));

import {
  deleteObject,
  getDocumentsBucketName,
  getObjectBytes,
  headObject,
  putObject,
} from '../../src/services/storage-s3';

const sha256 = (b: Uint8Array | Buffer): string => createHash('sha256').update(b).digest('hex');

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

describe('LocalFsArtifactStore', () => {
  let root: string;
  let store: LocalFsArtifactStore;

  beforeEach(() => {
    root = join(tmpdir(), `artifact-test-${process.pid}-${Date.now()}`);
    store = new LocalFsArtifactStore(root, 'documents');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes with checksum + metadata', async () => {
    const body = Buffer.from('hello artifact world');
    const ref = { bucket: 'documents', key: 'docs/a/file.txt' };

    const put = await store.put({ ...ref, body, contentType: 'text/plain' });
    expect(put.checksum).toBe(sha256(body));
    expect(put.size).toBe(body.byteLength);
    expect(put.ref).toEqual(ref);

    const bytes = await store.getBytes(ref);
    expect(Buffer.from(bytes).toString()).toBe('hello artifact world');

    const streamed = await drainStream(await store.getStream(ref));
    expect(Buffer.from(streamed).toString()).toBe('hello artifact world');

    const head = await store.head(ref);
    expect(head.contentType).toBe('text/plain');
    expect(head.contentLength).toBe(body.byteLength);
    expect(head.checksum).toBe(sha256(body));
    expect(head.lastModified).toBeInstanceOf(Date);
  });

  it('deletes object + sidecar idempotently', async () => {
    const ref = { bucket: 'documents', key: 'gone.bin' };
    await store.put({ ...ref, body: Buffer.from([1, 2, 3]) });
    await store.delete(ref);
    await expect(store.getBytes(ref)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    // Deleting an already-missing key resolves.
    await expect(store.delete(ref)).resolves.toBeUndefined();
  });

  it('throws ArtifactNotFoundError for a missing key', async () => {
    await expect(store.getBytes({ bucket: 'documents', key: 'nope' })).rejects.toBeInstanceOf(
      ArtifactNotFoundError
    );
    await expect(store.head({ bucket: 'documents', key: 'nope' })).rejects.toBeInstanceOf(
      ArtifactNotFoundError
    );
  });

  it('rejects a put whose expectedChecksum does not match', async () => {
    await expect(
      store.put({ bucket: 'documents', key: 'x', body: Buffer.from('abc'), expectedChecksum: 'deadbeef' })
    ).rejects.toBeInstanceOf(ArtifactChecksumMismatchError);
  });

  it('keeps object keys ending in .json distinct from other objects', async () => {
    const a = Buffer.from('plain foo');
    const b = Buffer.from('the json one');
    await store.put({ bucket: 'documents', key: 'foo', body: a });
    await store.put({ bucket: 'documents', key: 'foo.json', body: b });

    expect(Buffer.from(await store.getBytes({ bucket: 'documents', key: 'foo' })).toString()).toBe('plain foo');
    expect(Buffer.from(await store.getBytes({ bucket: 'documents', key: 'foo.json' })).toString()).toBe(
      'the json one'
    );
    expect((await store.head({ bucket: 'documents', key: 'foo' })).checksum).toBe(sha256(a));
    expect((await store.head({ bucket: 'documents', key: 'foo.json' })).checksum).toBe(sha256(b));
  });

  it('neutralizes path-traversal segments in bucket and key', async () => {
    const body = Buffer.from('contained');
    const sentinel = `ESCAPE_${process.pid}_${Date.now()}`;
    const ref = { bucket: '..', key: `a/../../${sentinel}` };
    const put = await store.put({ ...ref, body });
    expect(put.size).toBe(body.byteLength);
    // Round-trips under the sanitized path.
    expect(Buffer.from(await store.getBytes(ref)).toString()).toBe('contained');
    // Nothing escaped above the store root.
    const leaked = await fs
      .stat(join(root, '..', sentinel))
      .then(() => true)
      .catch(() => false);
    expect(leaked).toBe(false);
  });

  it('exposes the configured default bucket', () => {
    expect(store.defaultBucket()).toBe('documents');
  });
});

describe('S3ArtifactStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes the checksum, persists it as S3 metadata, and returns it', async () => {
    const store = new S3ArtifactStore();
    const body = Buffer.from('s3 artifact payload');
    const result = await store.put({ bucket: 'b', key: 'k', body, contentType: 'application/pdf' });

    expect(result.checksum).toBe(sha256(body));
    expect(result.size).toBe(body.byteLength);
    expect(vi.mocked(putObject)).toHaveBeenCalledWith({
      bucket: 'b',
      key: 'k',
      body,
      contentType: 'application/pdf',
      metadata: { sha256: sha256(body) },
    });
  });

  it('does not call putObject when expectedChecksum mismatches', async () => {
    const store = new S3ArtifactStore();
    await expect(
      store.put({ bucket: 'b', key: 'k', body: Buffer.from('x'), expectedChecksum: 'nope' })
    ).rejects.toBeInstanceOf(ArtifactChecksumMismatchError);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it('maps S3 head metadata back to the checksum field', async () => {
    vi.mocked(headObject).mockResolvedValueOnce({
      contentLength: 10,
      contentType: 'text/plain',
      metadata: { sha256: 'abc123' },
    });
    const store = new S3ArtifactStore();
    const head = await store.head({ bucket: 'b', key: 'k' });
    expect(head).toEqual({ contentLength: 10, contentType: 'text/plain', checksum: 'abc123' });
  });

  it('translates S3 missing-object errors to ArtifactNotFoundError', async () => {
    const store = new S3ArtifactStore();
    vi.mocked(getObjectBytes).mockRejectedValueOnce(
      Object.assign(new Error('nope'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
    );
    await expect(store.getBytes({ bucket: 'b', key: 'k' })).rejects.toBeInstanceOf(ArtifactNotFoundError);

    vi.mocked(headObject).mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotFound' }));
    await expect(store.head({ bucket: 'b', key: 'k' })).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('delegates getBytes / delete / defaultBucket to storage-s3', async () => {
    vi.mocked(getObjectBytes).mockResolvedValueOnce(new Uint8Array([9, 9]));
    const store = new S3ArtifactStore();

    expect(Array.from(await store.getBytes({ bucket: 'b', key: 'k' }))).toEqual([9, 9]);

    await store.delete({ bucket: 'b', key: 'k' });
    expect(vi.mocked(deleteObject)).toHaveBeenCalledWith({ bucket: 'b', key: 'k' });

    expect(store.defaultBucket()).toBe('documents');
    expect(vi.mocked(getDocumentsBucketName)).toHaveBeenCalled();
  });
});
