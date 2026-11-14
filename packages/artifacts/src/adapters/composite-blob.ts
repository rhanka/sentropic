/**
 * CMF-S2 — composite `db+s3` blob adapter.
 *
 * Routes `putBlob` by mode and size (`db`: always DB, `s3`: always object,
 * `db+s3`: DB at or below the inline threshold, object above), resolves reads
 * through the registered `artifacts.blobs.placement` (probing DB then object
 * for prepared-but-unfinalized blobs), and coordinates `deleteBlob` across
 * both sides under the caller's digest lock so neither an orphan DB row nor
 * an orphan object survives GC. Enumeration is the ordered union; bounded
 * pages merge both sides by keyset resume under one sealed continuation
 * (`listKeysPaged`, CR-4) so no side is ever bulk-loaded.
 */
import type { BlobKeyPage, BlobKeyPageResult, PublicationBlobStore } from '../server/publication.js';

export type CompositeBlobMode = 'db' | 's3' | 'db+s3';
export type RegisteredBlobPlacement = 'db' | 'object';

export interface CompositeBlobPlacements {
  /** Registered placement of a finalized blob; undefined before finalization. */
  getPlacement(key: string): Promise<RegisteredBlobPlacement | undefined>;
}

export interface CompositeBlobOptions {
  readonly db: PublicationBlobStore;
  readonly s3: PublicationBlobStore;
  readonly mode: CompositeBlobMode;
  /** `db+s3` only: blobs at or below this byte size land in the DB. */
  readonly inlineMaxBytes: number;
  readonly placements: CompositeBlobPlacements;
  /** Runs work under the digest lock shared with GC; direct when absent. */
  readonly withDigestLock?: (digest: string, work: () => Promise<void>) => Promise<void>;
}

function digestOfKey(key: string): string {
  const hex = key.split('/').pop() ?? '';
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`invalid blob key: ${key}`);
  return `sha256:${hex}`;
}

/** Pure routing decision, shared with the publication promotion path. */
export function placementForPut(mode: CompositeBlobMode, sizeBytes: number, inlineMaxBytes: number): RegisteredBlobPlacement {
  if (mode === 'db') return 'db';
  if (mode === 's3') return 'object';
  if (!Number.isSafeInteger(inlineMaxBytes) || inlineMaxBytes < 1) throw new Error('invalid inline max bytes');
  return sizeBytes <= inlineMaxBytes ? 'db' : 'object';
}

/** Create the composite blob store (no env reads, no connections). */
export function createCompositeBlobStore(options: CompositeBlobOptions): PublicationBlobStore {
  const { db, s3, mode, inlineMaxBytes, placements } = options;
  if (mode !== 'db' && mode !== 's3' && mode !== 'db+s3') throw new Error(`invalid blob placement mode: ${mode}`);
  const lock = options.withDigestLock ?? (async (_digest, work) => { await work(); });
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      const target = placementForPut(mode, bytes.byteLength, inlineMaxBytes) === 'db' ? db : s3;
      await target.putBlob(key, bytes);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      const placement = await placements.getPlacement(key);
      if (placement === 'db') return db.getBlob(key);
      if (placement === 'object') return s3.getBlob(key);
      return (await db.getBlob(key)) ?? s3.getBlob(key);
    },
    async getBlobRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | undefined> {
      const placement = await placements.getPlacement(key);
      if (placement === 'db') return db.getBlobRange?.(key, start, endInclusive);
      if (placement === 'object') return s3.getBlobRange?.(key, start, endInclusive);
      return (await db.getBlobRange?.(key, start, endInclusive)) ??
        s3.getBlobRange?.(key, start, endInclusive);
    },
    async listKeys(prefix: string): Promise<string[]> {
      const [fromDb, fromS3] = await Promise.all([db.listKeys(prefix), s3.listKeys(prefix)]);
      return [...new Set([...fromDb, ...fromS3])].sort();
    },
    async listKeysPaged(prefix: string, page: BlobKeyPage): Promise<BlobKeyPageResult> {
      // Ordered union over one shared keyset resume: both sides fetch their
      // first `maxItems` keys after the same resume key, which always covers
      // the union's first `maxItems` keys (a union member ranks no higher in
      // its own side than in the union). Bounded per side, no bulk load; the
      // bridge applies the byte budget and seals the single resume key.
      if (!Number.isSafeInteger(page.maxItems) || page.maxItems < 1) throw new Error('invalid blob page maxItems');
      const sides: readonly PublicationBlobStore[] = [db, s3];
      const fetched = await Promise.all(sides.map(async (side) => {
        const input: BlobKeyPage = page.startAfter === undefined
          ? { maxItems: page.maxItems, maxEncodedBytes: page.maxEncodedBytes }
          : { maxItems: page.maxItems, maxEncodedBytes: page.maxEncodedBytes, startAfter: page.startAfter };
        if (side.listKeysPaged !== undefined) return side.listKeysPaged(prefix, input);
        const all = (await side.listKeys(prefix)).filter((key) => key.startsWith(prefix)).sort();
        const start = page.startAfter === undefined ? 0 : (() => {
          const index = all.findIndex((key) => key > page.startAfter!);
          return index === -1 ? all.length : index;
        })();
        const keys = all.slice(start, start + page.maxItems);
        return { keys, hasMore: start + page.maxItems < all.length };
      }));
      const seen = new Set<string>();
      for (const result of fetched) {
        for (const key of result.keys) seen.add(key);
      }
      const union = [...seen].sort();
      const keys = union.slice(0, page.maxItems);
      const hasMore = fetched.some((result) => result.hasMore) || union.length > page.maxItems;
      return { keys, hasMore };
    },
    async deleteBlob(key: string): Promise<void> {
      await lock(digestOfKey(key), async () => {
        // Deferred per side: a synchronously-throwing store (unknown key)
        // must settle as a rejection inside allSettled, never escape during
        // argument evaluation and leave the other side floating unawaited.
        const attempt = async (side: PublicationBlobStore): Promise<void> => {
          await side.deleteBlob(key);
        };
        const outcomes = await Promise.allSettled([attempt(db), attempt(s3)]);
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected' &&
            !(outcome.reason instanceof Error && outcome.reason.message === `unknown blob: ${key}`) &&
            outcome.reason?.name !== 'NoSuchKey' && outcome.reason?.name !== 'NotFound') {
            throw outcome.reason;
          }
        }
        if (outcomes.every((outcome) => outcome.status === 'rejected')) {
          throw (outcomes[0] as PromiseRejectedResult).reason;
        }
      });
    },
  };
}
