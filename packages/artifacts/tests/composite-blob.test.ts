/**
 * CMF-S2 — composite `db+s3` placement (unit, driver-neutral).
 * Routes puts by mode and size, resolves reads through the registered
 * placement with a DB-then-object probe for prepared blobs, coordinates
 * deletes across both sides, and refuses unknown modes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCompositeBlobStore, placementForPut } from '../src/adapters/composite-blob.js';
import { listBlobKeysPaged } from '../src/server/blob-bridge.js';
import { createMemoryBlobStore, type PublicationBlobStore } from '../src/server/publication.js';

function keyFor(bytes: Uint8Array, scope = 'scope-a'): string {
  return `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

function stores(placements = new Map<string, 'db' | 'object'>()) {
  const db = createMemoryBlobStore();
  const s3 = createMemoryBlobStore();
  const store = createCompositeBlobStore({ db, s3, mode: 'db+s3', inlineMaxBytes: 8,
    placements: { getPlacement: async (key) => placements.get(key) } });
  return { db, s3, store, placements };
}

describe('composite blob placement', () => {
  it.each(['db', 's3'] as const)('keeps a partial %s deletion failure visible and retryable', async (failingSide) => {
    const db = createMemoryBlobStore();
    const s3 = createMemoryBlobStore();
    const bytes = new TextEncoder().encode('retry partial delete');
    const key = keyFor(bytes);
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    let denied = true;
    const side = failingSide === 'db' ? db : s3;
    const failing = { ...side, async deleteBlob(candidate: string) {
      if (denied) throw new Error('AccessDenied');
      await side.deleteBlob(candidate);
    } };
    const store = createCompositeBlobStore({ db: failingSide === 'db' ? failing : db,
      s3: failingSide === 's3' ? failing : s3, mode: 'db+s3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    await expect(store.deleteBlob(key)).rejects.toThrow('AccessDenied');
    expect(await side.getBlob(key)).toEqual(bytes);
    denied = false;
    await store.deleteBlob(key);
    expect(await db.getBlob(key)).toBeUndefined();
    expect(await s3.getBlob(key)).toBeUndefined();
  });

  it.each(['db', 's3'] as const)('enumerates old placements after switching to %s', async (mode) => {
    const { db, s3 } = stores();
    const a = new TextEncoder().encode('old db bytes');
    const b = new TextEncoder().encode('old object bytes');
    await db.putBlob(keyFor(a), a);
    await s3.putBlob(keyFor(b), b);
    const store = createCompositeBlobStore({ db, s3, mode, inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    const expected = [keyFor(a), keyFor(b)].sort();
    expect(await store.listKeys('artifacts/scope-a/blobs/sha256/')).toEqual(expected);
    expect((await store.listKeysPaged!('artifacts/scope-a/blobs/sha256/',
      { maxItems: 10, maxEncodedBytes: 10000 })).keys).toEqual(expected);
  });

  it('routes puts by mode and inline threshold', () => {
    expect(placementForPut('db', 1_000_000, 8)).toBe('db');
    expect(placementForPut('s3', 1, 8)).toBe('object');
    expect(placementForPut('db+s3', 8, 8)).toBe('db');
    expect(placementForPut('db+s3', 9, 8)).toBe('object');
    expect(() => placementForPut('db+s3', 1, 0)).toThrow(/invalid inline max bytes/);
  });

  it('refuses an unknown mode at construction', () => {
    const db = createMemoryBlobStore();
    expect(() => createCompositeBlobStore({ db, s3: createMemoryBlobStore(), mode: 'tape' as never,
      inlineMaxBytes: 8, placements: { getPlacement: async () => undefined } })).toThrow(/invalid blob placement mode/);
  });

  it('stores small blobs in db and large blobs in s3', async () => {
    const { db, s3, store } = stores();
    const small = new TextEncoder().encode('tiny');
    const large = new TextEncoder().encode('larger than eight');
    await store.putBlob(keyFor(small), small);
    await store.putBlob(keyFor(large), large);
    expect(await db.getBlob(keyFor(small))).toEqual(small);
    expect(await db.getBlob(keyFor(large))).toBeUndefined();
    expect(await s3.getBlob(keyFor(large))).toEqual(large);
    expect(await s3.getBlob(keyFor(small))).toBeUndefined();
  });

  it('resolves reads through the registered placement', async () => {
    const { db, s3, store, placements } = stores();
    const bytes = new TextEncoder().encode('placed');
    const key = keyFor(bytes);
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    placements.set(key, 'db');
    expect(await store.getBlob(key)).toEqual(bytes);
    placements.set(key, 'object');
    expect(await store.getBlob(key)).toEqual(bytes);
  });

  it('probes db then object for prepared-but-unfinalized blobs', async () => {
    const { s3, store } = stores();
    const bytes = new TextEncoder().encode('prepared');
    const key = keyFor(bytes);
    await s3.putBlob(key, bytes);
    expect(await store.getBlob(key)).toEqual(bytes);
    expect(await store.getBlob(keyFor(new TextEncoder().encode('absent-value')))).toBeUndefined();
  });

  it('unions listings and deletes from both sides', async () => {
    const { store } = stores();
    const onlyDb = new TextEncoder().encode('a');
    const onlyS3 = new TextEncoder().encode('longer b value');
    const keys = [keyFor(onlyDb), keyFor(onlyS3)].sort();
    await store.putBlob(keys[0]!, onlyDb);
    await store.putBlob(keys[1]!, onlyS3);
    expect(await store.listKeys('artifacts/scope-a/blobs/sha256/')).toEqual(keys);
    await store.deleteBlob(keys[0]!);
    expect(await store.listKeys('artifacts/scope-a/blobs/sha256/')).toEqual([keys[1]]);
    await store.deleteBlob(keys[1]!);
    await expect(store.deleteBlob(keys[1]!)).rejects.toThrow(/unknown blob/);
  });

  it('coordinates deletes under the caller digest lock', async () => {
    const db = createMemoryBlobStore();
    const seen: string[] = [];
    const store = createCompositeBlobStore({ db, s3: createMemoryBlobStore(), mode: 'db',
      inlineMaxBytes: 8, placements: { getPlacement: async () => 'db' },
      withDigestLock: async (digest, work) => { seen.push(digest); await work(); } });
    const bytes = new TextEncoder().encode('locked');
    const key = keyFor(bytes);
    await store.putBlob(key, bytes);
    await store.deleteBlob(key);
    expect(seen).toEqual([`sha256:${key.split('/').pop()}`]);
    expect(await store.getBlob(key)).toBeUndefined();
  });

  it('keeps db-only and s3-only modes on their side', async () => {
    const mk = (mode: 'db' | 's3'): PublicationBlobStore => createCompositeBlobStore({ db: createMemoryBlobStore(),
      s3: createMemoryBlobStore(), mode, inlineMaxBytes: 8, placements: { getPlacement: async () => undefined } });
    const bytes = new TextEncoder().encode('side');
    await mk('db').putBlob(keyFor(bytes), bytes);
    await mk('s3').putBlob(keyFor(bytes), bytes);
  });

  it('reads db-placed blobs through the composite in s3 mode', async () => {
    const db = createMemoryBlobStore();
    const s3 = createMemoryBlobStore();
    const bytes = new TextEncoder().encode('db placed but s3 mode');
    const key = keyFor(bytes);
    await db.putBlob(key, bytes);
    const store = createCompositeBlobStore({ db, s3, mode: 's3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => 'db' } });
    expect(await store.getBlob(key)).toEqual(bytes);
  });

  it('walks the ordered union through bounded backend pages', async () => {
    const db = createMemoryBlobStore();
    const s3 = createMemoryBlobStore();
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const expected = new Set<string>();
    for (const [side, words] of [[db, ['db alpha', 'db beta']], [s3, ['s3 gamma', 's3 delta']]] as const) {
      for (const word of words) {
        const bytes = new TextEncoder().encode(`${word} ${side === db ? 'd' : 's'}`);
        const key = keyFor(bytes);
        expected.add(key);
        await side.putBlob(key, bytes);
      }
    }
    // One key on both sides exercises union deduplication.
    const shared = new TextEncoder().encode('present on both sides');
    const sharedKey = keyFor(shared);
    expected.add(sharedKey);
    await db.putBlob(sharedKey, shared);
    await s3.putBlob(sharedKey, shared);
    const store = createCompositeBlobStore({ db, s3, mode: 'db+s3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    const ordered = [...expected].sort();
    const seen: string[] = [];
    let continuation: string | undefined;
    for (;;) {
      const page = await listBlobKeysPaged(store, prefix, continuation === undefined
        ? { maxItems: 2, maxEncodedBytes: 1_000_000 }
        : { maxItems: 2, maxEncodedBytes: 1_000_000, continuation });
      expect(page.keys.length).toBeLessThanOrEqual(2);
      expect(page.keys).toEqual([...page.keys].sort());
      seen.push(...page.keys);
      if (page.continuation === undefined) break;
      continuation = page.continuation;
    }
    expect(seen).toEqual(ordered);
    await expect(listBlobKeysPaged(store, prefix, {
      maxItems: 2, maxEncodedBytes: 1_000_000, continuation: 'tampered',
    })).rejects.toThrow(/invalid blob page continuation/);
  });

  it('pages a side without store-level paging through the fallback slice', async () => {
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const s3backing = createMemoryBlobStore();
    const bare: PublicationBlobStore = {
      putBlob: (key, bytes) => s3backing.putBlob(key, bytes),
      getBlob: (key) => s3backing.getBlob(key),
      listKeys: (listedPrefix) => s3backing.listKeys(listedPrefix),
      deleteBlob: (key) => s3backing.deleteBlob(key),
    };
    const db = createMemoryBlobStore();
    const expected: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const bytes = new TextEncoder().encode(`bare side ${index}`);
      const key = keyFor(bytes);
      expected.push(key);
      await s3backing.putBlob(key, bytes);
    }
    const store = createCompositeBlobStore({ db, s3: bare, mode: 'db+s3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    expect(store.listKeysPaged).toBeDefined();
    const seen: string[] = [];
    let startAfter: string | undefined;
    for (;;) {
      const result = await store.listKeysPaged!(prefix, startAfter === undefined
        ? { maxItems: 2, maxEncodedBytes: 1_000_000 }
        : { maxItems: 2, maxEncodedBytes: 1_000_000, startAfter });
      seen.push(...result.keys);
      if (!result.hasMore) break;
      startAfter = result.keys[result.keys.length - 1];
    }
    expect(seen).toEqual(expected.sort());
  });

  it('lists only its side in db and s3 modes', async () => {
    const db = createMemoryBlobStore();
    const s3 = createMemoryBlobStore();
    const inert: PublicationBlobStore = {
      putBlob: async (key) => { throw new Error(`not configured ${key}`); },
      getBlob: async () => undefined,
      listKeys: async () => [],
      deleteBlob: async () => {},
    };
    const dbBytes = new TextEncoder().encode('db side');
    const dbKey = keyFor(dbBytes);
    await db.putBlob(dbKey, dbBytes);
    const dbStore = createCompositeBlobStore({ db, s3: inert, mode: 'db', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    expect(await dbStore.listKeys('artifacts/scope-a/blobs/sha256/')).toEqual([dbKey]);
    expect(await dbStore.getBlob(dbKey)).toEqual(dbBytes);
    expect(await dbStore.getBlob(keyFor(new TextEncoder().encode('missing')))).toBeUndefined();
    const s3Bytes = new TextEncoder().encode('s3 side value longer');
    const s3Key = keyFor(s3Bytes);
    await s3.putBlob(s3Key, s3Bytes);
    const s3Store = createCompositeBlobStore({ db: createMemoryBlobStore(), s3, mode: 's3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    expect(await s3Store.listKeys('artifacts/scope-a/blobs/sha256/')).toEqual([s3Key]);
  });
});
