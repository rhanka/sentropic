/**
 * CMF-S1 — hardened blob bridge (MODULE_STORAGE CR-1/CR-2/CR-4).
 * Identical retry idempotent; different bytes refused without overwrite;
 * wrong digest or truncated object fails closed; bounded pages with a
 * scope-bound integrity-protected continuation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalBlobStore } from '../src/adapters/local-blob.js';
import {
  cloneBlobBytes,
  createVerifiedBlobStore,
  listBlobKeysPaged,
  pageBlobKeys,
  verifyBytesForKey,
  verifyStoredBytesForKey,
} from '../src/server/blob-bridge.js';
import { createMemoryBlobStore } from '../src/server/publication.js';

function keyFor(bytes: Uint8Array, scope = 'scope-a'): string {
  return `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

const BYTES = new TextEncoder().encode('cmf-s1 bridge fixture bytes');
const KEY = keyFor(BYTES);

describe('blob bridge guards', () => {
  it('clones the caller buffer before verification', () => {
    const original = new Uint8Array([1, 2, 3]);
    const clone = cloneBlobBytes(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    clone[0] = 9;
    expect(original[0]).toBe(1);
  });

  it('verifies sha256 before any I/O and fails closed on mismatch', () => {
    expect(verifyBytesForKey(KEY, BYTES)).toBe(`sha256:${createHash('sha256').update(BYTES).digest('hex')}`);
    expect(() => verifyBytesForKey(KEY, new TextEncoder().encode('other bytes'))).toThrow(/digest mismatch/);
    expect(() => verifyStoredBytesForKey(KEY, new TextEncoder().encode('other bytes'))).toThrow(/digest mismatch/);
    expect(() => verifyBytesForKey('artifacts/scope-a/blobs/sha256/not-hex', BYTES)).toThrow(/invalid blob key/);
  });

  it('keeps an identical retry idempotent on the local store', async () => {
    const blobs = createLocalBlobStore(join(mkdtempSync(join(tmpdir(), 'cmf-s1-')), 'blobs'));
    await blobs.putBlob(KEY, BYTES);
    await expect(blobs.putBlob(KEY, BYTES)).resolves.toBeUndefined();
    expect(await blobs.getBlob(KEY)).toEqual(new Uint8Array(BYTES));
  });

  it('refuses different bytes without touching the stored object', async () => {
    const blobs = createLocalBlobStore(join(mkdtempSync(join(tmpdir(), 'cmf-s1-')), 'blobs'));
    await blobs.putBlob(KEY, BYTES);
    const other = new Uint8Array(BYTES.length).fill(7);
    expect(other).not.toEqual(new Uint8Array(BYTES));
    await expect(blobs.putBlob(KEY, other)).rejects.toThrow(/digest mismatch/);
    expect(await blobs.getBlob(KEY)).toEqual(new Uint8Array(BYTES));
  });

  it('fails closed on a wrong digest or a truncated object on read', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cmf-s1-')), 'blobs');
    const blobs = createLocalBlobStore(dir);
    await blobs.putBlob(KEY, BYTES);
    // Truncate the stored file behind the store's back.
    const hex = KEY.split('/').pop()!;
    const target = join(dir, 'artifacts', 'scope-a', 'blobs', 'sha256', hex);
    const stored = readFileSync(target);
    writeFileSync(target, stored.subarray(0, stored.length - 1));
    await expect(blobs.getBlob(KEY)).rejects.toThrow(/digest mismatch/);
  });

  it('settles a retry through read-back on a verified wrapper', async () => {
    const upstream = createMemoryBlobStore();
    const blobs = createVerifiedBlobStore(upstream);
    await blobs.putBlob(KEY, BYTES);
    await expect(blobs.putBlob(KEY, BYTES)).resolves.toBeUndefined();
    expect(await blobs.getBlob(KEY)).toEqual(new Uint8Array(BYTES));
    expect(await blobs.getBlob(KEY.replace(/[^/]+$/, '0'.repeat(64)))).toBeUndefined();
    await expect(blobs.putBlob(KEY, new Uint8Array(BYTES.length).fill(7))).rejects.toThrow(/digest mismatch/);
    expect(await blobs.getBlob(KEY)).toEqual(new Uint8Array(BYTES));
  });

  it('pages bounded keys with a scope-bound integrity-protected continuation', async () => {
    const upstream = createMemoryBlobStore();
    const scopeKeys: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const bytes = new TextEncoder().encode(`page fixture ${index} ${randomUUID()}`);
      const key = keyFor(bytes);
      scopeKeys.push(key);
      await upstream.putBlob(key, bytes);
    }
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const first = await listBlobKeysPaged(upstream, prefix, { maxItems: 2, maxEncodedBytes: 1_000_000 });
    expect(first.keys).toHaveLength(2);
    expect(first.continuation).toBeDefined();
    const second = await listBlobKeysPaged(upstream, prefix, {
      maxItems: 10, maxEncodedBytes: 1_000_000, continuation: first.continuation,
    });
    expect([...first.keys, ...second.keys].sort()).toEqual([...scopeKeys].sort());
    expect(second.continuation).toBeUndefined();
    await expect(listBlobKeysPaged(upstream, prefix, {
      maxItems: 10, maxEncodedBytes: 1_000_000, continuation: 'tampered',
    })).rejects.toThrow(/invalid blob page continuation/);
    await expect(listBlobKeysPaged(upstream, 'artifacts/other-scope/blobs/sha256/', {
      maxItems: 10, maxEncodedBytes: 1_000_000, continuation: first.continuation,
    })).rejects.toThrow(/invalid blob page continuation/);
  });

  it('bounds pages by encoded bytes', () => {
    const keys = ['artifacts/scope-a/blobs/sha256/' + 'a'.repeat(64), 'artifacts/scope-a/blobs/sha256/' + 'b'.repeat(64)];
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const first = pageBlobKeys(keys, prefix, { maxItems: 10, maxEncodedBytes: keys[0]!.length });
    expect(first.keys).toHaveLength(1);
    expect(first.continuation).toBeDefined();
  });

  it('refuses a cursor forged without the process HMAC secret', async () => {
    const upstream = createMemoryBlobStore();
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const forgedTag = createHash('sha256').update(`blob-page/v1:${prefix}:1`).digest('hex');
    const forged = Buffer.from(JSON.stringify({ v: 1, prefix, offset: 1, tag: forgedTag }), 'utf8').toString('base64url');
    await expect(listBlobKeysPaged(upstream, prefix, {
      maxItems: 10, maxEncodedBytes: 1_000_000, continuation: forged,
    })).rejects.toThrow(/invalid blob page continuation/);
  });
});
