/**
 * L-5c — garbage collection (spec-v8 §9 5c).
 *
 * Blobs stay alive while referenced (per-digest holder sets) or pinned
 * (explicit retention against concurrent GC). Collection deletes only
 * unreferenced, unpinned blobs and reports per-key failures without
 * throwing, so revoked access, pending purge and actual erasure stay
 * distinguishable. Reference updates serialize per digest (in-process
 * mutex); the memory double yields mid-update to simulate store latency so
 * races are genuinely exercised. Deleting state (refcounts vs purge) is
 * serialized by the caller: purge dereferences first, then collects.
 */
import { createKeyMutex } from './ports.js';
import { blobDigestOfKey, type PublicationBlobStore } from './publication.js';

export interface RefcountStore {
  addRef(digest: string, holder: string): Promise<void>;
  releaseRef(digest: string, holder: string): Promise<void>;
  pin(digest: string, reason: string): Promise<void>;
  unpin(digest: string, reason: string): Promise<void>;
  count(digest: string): Promise<number>;
  isPinned(digest: string): Promise<boolean>;
}

/** In-memory RefcountStore double (yields mid-update to expose races). */
export function createMemoryRefcountStore(): RefcountStore {
  const holders = new Map<string, Set<string>>();
  const pins = new Map<string, Set<string>>();
  const mutex = createKeyMutex();
  return {
    async addRef(digest: string, holder: string): Promise<void> {
      await mutex.runSerialized(digest, async () => {
        const set = holders.get(digest) ?? new Set<string>();
        await Promise.resolve();
        set.add(holder);
        holders.set(digest, set);
      });
    },
    async releaseRef(digest: string, holder: string): Promise<void> {
      await mutex.runSerialized(digest, async () => {
        const set = holders.get(digest);
        await Promise.resolve();
        if (set === undefined || !set.has(holder)) {
          throw new Error(`refcount not held: ${digest} by ${holder}`);
        }
        set.delete(holder);
      });
    },
    async pin(digest: string, reason: string): Promise<void> {
      const set = pins.get(digest) ?? new Set<string>();
      if (set.has(reason)) throw new Error(`duplicate pin: ${digest} (${reason})`);
      set.add(reason);
      pins.set(digest, set);
    },
    async unpin(digest: string, reason: string): Promise<void> {
      const set = pins.get(digest);
      if (set === undefined || !set.has(reason)) {
        throw new Error(`not pinned: ${digest} (${reason})`);
      }
      set.delete(reason);
    },
    async count(digest: string): Promise<number> {
      return holders.get(digest)?.size ?? 0;
    },
    async isPinned(digest: string): Promise<boolean> {
      return (pins.get(digest)?.size ?? 0) !== 0;
    },
  };
}

export interface GcReport {
  deleted: string[];
  retained: string[];
  failures: { key: string; error: string }[];
}

export interface GcService {
  collect(
    blobs: PublicationBlobStore,
    prefix: string,
    claims?: DeletionClaimStore,
  ): Promise<GcReport>;
}

/**
 * Durable exclusive deletion claims (spec r2 A4/A6). Purge claims a digest
 * before dereferencing it; reference creation MUST check the claim and
 * refuse new references to claimed digests; erasure acknowledges the claim.
 */
export interface DeletionClaimStore {
  /** Exclusive claim; throws when the digest is already claimed. */
  claim(digest: string, holder: string): Promise<void>;
  /** Release the claim after the blob is gone (or the purge aborts). */
  releaseClaim(digest: string): Promise<void>;
  isClaimed(digest: string): Promise<boolean>;
}

export function createMemoryDeletionClaimStore(): DeletionClaimStore {
  const holders = new Map<string, string>();
  return {
    async claim(digest: string, holder: string): Promise<void> {
      if (holders.has(digest)) throw new Error(`deletion already claimed: ${digest}`);
      holders.set(digest, holder);
    },
    async releaseClaim(digest: string): Promise<void> {
      if (!holders.has(digest)) throw new Error(`deletion not claimed: ${digest}`);
      holders.delete(digest);
    },
    async isClaimed(digest: string): Promise<boolean> {
      return holders.has(digest);
    },
  };
}

/**
 * A RefcountStore that refuses new references to claimed digests. Purge
 * claims first, so racing publications cannot pin a blob scheduled for
 * deletion; already-held references still protect the blob in collect.
 */
export function createClaimGuardedRefs(
  refs: RefcountStore,
  claims: DeletionClaimStore,
): RefcountStore {
  return {
    addRef: async (digest: string, holder: string): Promise<void> => {
      if (await claims.isClaimed(digest)) {
        throw new Error(`blob scheduled for deletion: ${digest}`);
      }
      await refs.addRef(digest, holder);
    },
    releaseRef: (digest: string, holder: string): Promise<void> =>
      refs.releaseRef(digest, holder),
    count: (digest: string): Promise<number> => refs.count(digest),
    isPinned: (digest: string): Promise<boolean> => refs.isPinned(digest),
    pin: (digest: string, holder: string): Promise<void> => refs.pin(digest, holder),
    unpin: (digest: string, holder: string): Promise<void> => refs.unpin(digest, holder),
  };
}

/** Create a GC service over an injected refcount store (no driver imports). */
export function createGcService(refs: RefcountStore): GcService {
  return {
    async collect(
      blobs: PublicationBlobStore,
      prefix: string,
      claims?: DeletionClaimStore,
    ): Promise<GcReport> {
      const report: GcReport = { deleted: [], retained: [], failures: [] };
      for (const key of await blobs.listKeys(prefix)) {
        let digest: string;
        try {
          digest = blobDigestOfKey(key);
        } catch {
          report.retained.push(key);
          continue;
        }
        if ((await refs.count(digest)) !== 0 || (await refs.isPinned(digest))) {
          report.retained.push(key);
          continue;
        }
        try {
          await blobs.deleteBlob(key);
          report.deleted.push(key);
        } catch (error) {
          report.failures.push({ key, error: String(error) });
          continue;
        }
        if (claims !== undefined && (await claims.isClaimed(digest))) {
          try {
            await claims.releaseClaim(digest);
          } catch (error) {
            report.failures.push({ key, error: String(error) });
          }
        }
      }
      return report;
    },
  };
}
