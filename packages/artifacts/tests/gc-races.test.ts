/**
 * L-5c — garbage collection: refcounts, pins, collected orphans.
 *
 * Blobs stay alive while referenced (per-digest counters) or pinned
 * (explicit retention against concurrent GC). Collection deletes only
 * unreferenced, unpinned blobs and reports per-key failures without
 * throwing — revoked access, pending purge and actual erasure stay
 * distinguishable in the report. Pinned blobs survive even at zero
 * references; a missing blob at delete time is a recorded failure.
 */
import { describe, expect, it } from 'vitest';
import {
  createGcService,
  createMemoryRefcountStore,
} from '../src/server/gc.js';
import { createMemoryBlobStore } from '../src/server/publication.js';

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

const KEY_A = `artifacts/scope-1/blobs/sha256/${'aa'.repeat(32)}`;
const KEY_B = `artifacts/scope-1/blobs/sha256/${'bb'.repeat(32)}`;

function digestOf(key: string): string {
  return `sha256:${key.split('/').pop() ?? ''}`;
}

describe('garbage collection', () => {
  it('collects unreferenced blobs and reports the report', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const gc = createGcService(refs);
    await blobs.putBlob(KEY_A, owe([1]));
    await blobs.putBlob(KEY_B, owe([2]));
    await refs.addRef(digestOf(KEY_A), 'release-r1');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/');
    expect(report.deleted).toEqual([KEY_B]);
    expect(report.retained).toEqual([KEY_A]);
    expect(report.failures).toEqual([]);
    expect(await blobs.getBlob(KEY_B)).toBeUndefined();
    expect(await blobs.getBlob(KEY_A)).toEqual(owe([1]));
  });

  it('pins survive zero references; missing deletes are failures', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const gc = createGcService(refs);
    await blobs.putBlob(KEY_A, owe([1]));
    await refs.pin(digestOf(KEY_A), 'legal-hold');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/');
    expect(report.deleted).toEqual([]);
    expect(report.retained).toEqual([KEY_A]);
    await refs.unpin(digestOf(KEY_A), 'legal-hold');
    const failingBlobs = {
      ...blobs,
      deleteBlob: async (_key: string) => {
        throw new Error('store exploded');
      },
    };
    const report2 = await gc.collect(failingBlobs, 'artifacts/scope-1/blobs/');
    expect(report2.deleted).toEqual([]);
    expect(report2.failures).toHaveLength(1);
    expect(report2.failures[0]?.error).toMatch(/store exploded/);
    expect(report2.failures[0]?.key).toBe(KEY_A);
  });

  it('serializes concurrent addRef/releaseRef races exactly', async () => {
    const refs = createMemoryRefcountStore();
    const digest = digestOf(KEY_A);
    await Promise.all(Array.from({ length: 25 }, (_, i) => refs.addRef(digest, `holder-${i}`)));
    expect(await refs.count(digest)).toBe(25);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => refs.releaseRef(digest, `holder-${i}`)),
    );
    expect(await refs.count(digest)).toBe(0);
  });

  it('refuses to release unheld references and duplicate pins', async () => {
    const refs = createMemoryRefcountStore();
    const digest = digestOf(KEY_A);
    await expect(refs.releaseRef(digest, 'ghost')).rejects.toThrow(/not held/);
    await refs.pin(digest, 'hold');
    await expect(refs.pin(digest, 'hold')).rejects.toThrow(/duplicate/);
    await refs.unpin(digest, 'hold');
    await expect(refs.unpin(digest, 'hold')).rejects.toThrow(/not pinned/);
  });
});
