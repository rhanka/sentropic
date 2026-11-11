import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, GetPublicAccessBlockCommand, PutObjectCommand, type S3Client }
  from '@aws-sdk/client-s3';
import { createBuilderCacheBlobs, createPostgresCacheStorage } from '../../../src/services/artifacts/live/cache-storage';

const PRIVATE = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
const digest64 = (char: string) => char.repeat(64);
const fileKey = `artifact-builder-cache/v1/files/${digest64('c')}`;

/** Command-level fake of the S3 client: in-memory objects per key, `blocks` overrides the privacy answer. */
function fakeS3(blocks: false | Record<string, boolean> = true) {
  const objects = new Map<string, Uint8Array>();
  const send = vi.fn(async (command: unknown): Promise<unknown> => {
    if (command instanceof GetPublicAccessBlockCommand) {
      if (blocks === false) throw new Error('privacy check unavailable');
      return { PublicAccessBlockConfiguration: blocks === true ? PRIVATE : { ...PRIVATE, ...blocks } };
    }
    if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, command.input.Body as Uint8Array); return {}; }
    if (command instanceof GetObjectCommand) {
      const bytes = objects.get(command.input.Key!);
      if (bytes === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: { transformToByteArray: async () => bytes } };
    }
    if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
    throw new Error('unexpected S3 command');
  });
  return { objects, send, client: { send } as unknown as S3Client };
}

/** Map-backed fake of the Postgres pool (pointer rows only), same contract as the adapters test pool. */
function fakePool() {
  const pointers = new Map<string, string>();
  const query = vi.fn(async (sql: string, values: string[]) => {
    const cacheKey = values[1]!;
    if (sql.startsWith('SELECT')) return { rows: pointers.has(cacheKey) ? [{ value: pointers.get(cacheKey) }] : [] };
    if (sql.startsWith('DELETE')) { pointers.delete(cacheKey); return { rows: [] }; }
    if (pointers.has(cacheKey)) return { rows: [] };
    pointers.set(cacheKey, values[2]!);
    return { rows: [{ key: cacheKey }] };
  });
  return { pointers, query };
}

describe('builder cache blob store', () => {
  it('should accept exactly the three cache key shapes under artifact-builder-cache/v1/ and refuse any other key before any S3 call', async () => {
    const f = fakeS3();
    const blobs = createBuilderCacheBlobs({ bucket: 'builder-dependency-cache', client: f.client });
    const manifestKey = `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/${randomUUID()}`;
    const archiveKey = `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/sealed-${digest64('e')}.tar.zst`;
    await blobs.put(fileKey, Buffer.from('file'));
    await blobs.put(manifestKey, Buffer.from('manifest'));
    await blobs.put(archiveKey, Buffer.from('archive'));
    expect(f.send.mock.calls.map(([command]) => command).filter(command => command instanceof PutObjectCommand)
      .map(command => (command as PutObjectCommand).input)).toEqual([
      { Bucket: 'builder-dependency-cache', Key: fileKey, Body: Buffer.from('file') },
      { Bucket: 'builder-dependency-cache', Key: manifestKey, Body: Buffer.from('manifest') },
      { Bucket: 'builder-dependency-cache', Key: archiveKey, Body: Buffer.from('archive') }]);
    await blobs.get(fileKey);
    await blobs.delete(fileKey);
    // Every out-of-prefix key is refused for put, get and delete: the old dependency-cache namespace, the artifacts
    // host blob shape, a missing prefix, a traversal, another prefix version, uppercase digests and a malformed id.
    for (const key of [`dependency-cache/v1/files/${digest64('c')}`, `artifacts/scope/blobs/sha256/${digest64('c')}`,
      `artifact-builder-cache/v2/files/${digest64('c')}`, '../artifact-builder-cache/v1/files/' + digest64('c'),
      'artifact-builder-cache/v1/files/' + digest64('C'),
      `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/not-a-uuid`,
      `artifact-builder-cache/v1/extra/${digest64('b')}/${digest64('d')}/${randomUUID()}`,
      `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/sealed-${digest64('e')}.tar.gz`,
      `artifact-builder-cache/v1/${digest64('b')}/sealed-${digest64('e')}.tar.zst`]) {
      await expect(blobs.put(key, Buffer.from('x'))).rejects.toThrow(/invalid builder-cache key/);
      await expect(blobs.get(key)).rejects.toThrow(/invalid builder-cache key/);
      await expect(blobs.delete(key)).rejects.toThrow(/invalid builder-cache key/);
    }
    // Three puts, one get and one delete — no refusal ever reached the client, privacy check included.
    expect(f.send.mock.calls.filter(([command]) => !(command instanceof GetPublicAccessBlockCommand))).toHaveLength(5);
  });

  it('should fail closed on a non-private bucket: every effect rechecks, is refused and never sends an object command', async () => {
    for (const field of Object.keys(PRIVATE)) {
      const f = fakeS3({ [field]: false });
      const blobs = createBuilderCacheBlobs({ bucket: 'public-cache', client: f.client });
      await expect(blobs.put(fileKey, Buffer.from('x')))
        .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
      await expect(blobs.get(fileKey))
        .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
      await expect(blobs.delete(fileKey))
        .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
      expect(f.send.mock.calls).toHaveLength(3); // a refusal is never cached
      expect(f.send.mock.calls.filter(([command]) => !(command instanceof GetPublicAccessBlockCommand))).toEqual([]);
    }
    // A check with no public-access-block answer, or one that fails, refuses the effect the same way.
    const opaque = createBuilderCacheBlobs({ bucket: 'opaque', client: { send: vi.fn(async () => ({})) } as unknown as S3Client });
    await expect(opaque.put(fileKey, Buffer.from('x')))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
    const broken = createBuilderCacheBlobs({ bucket: 'unknown', client: fakeS3(false).client });
    await expect(broken.put(fileKey, Buffer.from('x')))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
  });

  it('should name an S3 outage cache_s3_unavailable and never quarantine on it', async () => {
    const failing = { send: vi.fn(async (command: unknown) => {
      if (command instanceof GetPublicAccessBlockCommand) return { PublicAccessBlockConfiguration: PRIVATE };
      throw Object.assign(new Error('socket hang up'), { name: 'SocketTimeout' });
    }) } as unknown as S3Client;
    const blobs = createBuilderCacheBlobs({ bucket: 'builder-dependency-cache', client: failing });
    await expect(blobs.put(fileKey, Buffer.from('x')))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
    await expect(blobs.get(fileKey))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
    await expect(blobs.delete(fileKey))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
    // A store read over an S3 outage reports the outage instead of an invalid entry, without quarantining.
    const { pointers, query } = fakePool();
    pointers.set(`${digest64('b')}/${digest64('d')}`,
      JSON.stringify({ objectRef: `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/${randomUUID()}`,
        sha256: digest64('e') }));
    const storage = createPostgresCacheStorage({ query } as never, blobs);
    await expect(storage.read(`${digest64('b')}/${digest64('d')}`))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'cache_s3_unavailable' });
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('DELETE'))).toEqual([]);
  });

  it('should round-trip one sealed archive end to end (putArchive, getArchive) against S3', async () => {
    const f = fakeS3();
    const storage = createPostgresCacheStorage({ query: fakePool().query } as never,
      createBuilderCacheBlobs({ bucket: 'builder-dependency-cache', client: f.client }));
    const ref = `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/sealed-${digest64('e')}.tar.zst`;
    const bytes = Buffer.from('sealed-unit');
    await storage.putArchive(ref, bytes);
    expect(await storage.getArchive(ref)).toEqual(new Uint8Array(bytes));
    const absent = `artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/sealed-${digest64('f')}.tar.zst`;
    expect(await storage.getArchive(absent)).toBeUndefined();
    expect([...f.objects.keys()]).toEqual([ref]);
    // A malformed archive ref or an oversized archive refuses before any S3 call.
    const before = f.send.mock.calls.length;
    await expect(storage.putArchive(`artifact-builder-cache/v1/${digest64('b')}/sealed-${digest64('e')}.tar.zst`, bytes))
      .rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    await expect(storage.putArchive(ref, Buffer.alloc(1024 * 1024 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.send.mock.calls.length).toBe(before);
  });

  it('should round-trip the real generated keys end to end (putFile, admit, getFile, read) against S3', async () => {
    const f = fakeS3();
    const { pointers, query } = fakePool();
    const storage = createPostgresCacheStorage({ query } as never,
      createBuilderCacheBlobs({ bucket: 'builder-dependency-cache', client: f.client }));
    // putFile: one content-addressed object per distinct file, shared by every entry.
    const bytes = Buffer.from('file-bytes');
    await storage.putFile(digest64('c'), bytes);
    expect([...f.objects]).toEqual([[`artifact-builder-cache/v1/files/${digest64('c')}`, bytes]]);
    // admit: the manifest object lands under the same prefix; the Postgres pointer stays in its own namespace.
    const cacheKey = `${digest64('b')}/${digest64('d')}`;
    expect(await storage.admit(cacheKey, { receipt: {} as never, manifest: [] })).toMatchObject({ manifest: [] });
    const manifestKey = [...f.objects.keys()].find(key => key !== `artifact-builder-cache/v1/files/${digest64('c')}`)!;
    expect(manifestKey).toMatch(new RegExp(`^artifact-builder-cache/v1/${digest64('b')}/${digest64('d')}/[0-9a-f-]{36}$`));
    expect(JSON.parse(pointers.get(cacheKey)!).objectRef).toBe(manifestKey);
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))!;
    expect(insert[1]![0]).toBe('artifact-dependency-cache/v1');
    expect(insert[1]![1]).toBe(cacheKey);
    // read and getFile go back through the store under the same keys.
    expect(await storage.read(cacheKey)).toMatchObject({ manifest: [] });
    // The S3 body comes back as a plain Uint8Array (the store unwraps the stream exactly like the artifacts adapter).
    expect(await storage.getFile(digest64('c'))).toEqual(new Uint8Array(bytes));
    expect(await storage.getFile(digest64('a'))).toBeUndefined();
    // The store never accepts the old namespace again (Blocking 1): refused before any S3 call.
    const before = f.send.mock.calls.length;
    await expect(createBuilderCacheBlobs({ bucket: 'builder-dependency-cache', client: f.client })
      .put(`dependency-cache/v1/files/${digest64('c')}`, bytes)).rejects.toThrow(/invalid builder-cache key/);
    expect(f.send.mock.calls.length).toBe(before);
    // A pointer naming an out-of-prefix object is refused without any fetch.
    pointers.set(cacheKey, JSON.stringify({ objectRef: `dependency-cache/v1/${cacheKey}/${randomUUID()}`, sha256: digest64('e') }));
    await expect(storage.read(cacheKey)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.send.mock.calls.length).toBe(before);
  });
});
