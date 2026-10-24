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
import type { CommitExecutor, FinalizeTxClient } from './commit/types.js';
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
  /** Share this exclusion across claims, reference/pin creation and erasure. */
  withDigestLock<T>(digest: string, action: (locked: DeletionClaimAccess) => Promise<T>): Promise<T>;
  /** Exclusive claim; throws when the digest is already claimed. */
  claim(digest: string, holder: string): Promise<void>;
  /** Release the claim after the blob is gone (or the purge aborts). */
  releaseClaim(digest: string): Promise<void>;
  isClaimed(digest: string): Promise<boolean>;
}

type DeletionClaimAccess = Pick<DeletionClaimStore, 'claim' | 'releaseClaim' | 'isClaimed'>;

/** Short preparation transactions; no leased connection spans blob I/O. */
export function createPostgresClaimGuardedRefs(refs: RefcountStore, executor: CommitExecutor): RefcountStore {
  const insert = async (digest: string, holder: string, sql: string) => {
    const client = await executor.beginFinalization();
    try {
      await createPostgresDeletionClaimStore(client).withDigestLock(digest, async (claims) => {
        if (await claims.isClaimed(digest)) throw new Error(`blob scheduled for deletion: ${digest}`);
        await client.query(sql, [digest, holder]);
      });
      await client.commit();
    } catch (error) { await client.rollback(); throw error; }
    finally { client.release(); }
  };
  return { ...refs,
    addRef: (digest, holder) => insert(digest, holder,
      'INSERT INTO artifacts.blob_ref_holders (digest, holder) VALUES ($1, $2) ON CONFLICT DO NOTHING'),
    pin: (digest, reason) => insert(digest, reason,
      'INSERT INTO artifacts.blob_pins (digest, reason) VALUES ($1, $2)'),
  };
}

/** Transaction-scoped claims; callers commit the claim before external deletion. */
export function createPostgresDeletionClaimStore(client: FinalizeTxClient): DeletionClaimStore {
  const predicate = `kind = 'delete-blob' AND state = 'pending'
    AND payload->>'deletionClaim' = 'true' AND payload->>'digest' = $1`;
  const access: DeletionClaimAccess = {
    async isClaimed(digest) {
      const { rows } = await client.query<{ present: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM artifacts.object_intents WHERE ${predicate}) AS present`, [digest]);
      return rows[0]?.present === true;
    },
    async claim(digest, holder) {
      if (await access.isClaimed(digest)) throw new Error(`deletion already claimed: ${digest}`);
      await client.query(`INSERT INTO artifacts.object_intents (id, kind, payload)
        VALUES ($1, 'delete-blob', $2::jsonb)`,
      [crypto.randomUUID(), JSON.stringify({ deletionClaim: true, digest, holder })]);
    },
    async releaseClaim(digest) {
      const { rowCount } = await client.query(
        `UPDATE artifacts.object_intents SET state = 'done', updated_at = now() WHERE ${predicate}`, [digest]);
      if (rowCount === 0) throw new Error(`deletion not claimed: ${digest}`);
    },
  };
  const withDigestLock: DeletionClaimStore['withDigestLock'] = async (digest, action) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`artifacts-blob:${digest}`]);
    return action(access);
  };
  return { ...access, withDigestLock,
    claim: (digest, holder) => withDigestLock(digest, (locked) => locked.claim(digest, holder)),
    releaseClaim: (digest) => withDigestLock(digest, (locked) => locked.releaseClaim(digest)) };
}

export function createMemoryDeletionClaimStore(): DeletionClaimStore {
  const holders = new Map<string, string>();
  const mutex = createKeyMutex();
  const access: DeletionClaimAccess = {
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
  return {
    ...access,
    claim: (digest, holder) => mutex.runSerialized(digest, () => access.claim(digest, holder)),
    releaseClaim: (digest) => mutex.runSerialized(digest, () => access.releaseClaim(digest)),
    withDigestLock: (digest, action) => mutex.runSerialized(digest, () => action(access)),
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
      await claims.withDigestLock(digest, async (locked) => {
        if (await locked.isClaimed(digest)) throw new Error(`blob scheduled for deletion: ${digest}`);
        await refs.addRef(digest, holder);
      });
    },
    releaseRef: (digest: string, holder: string): Promise<void> =>
      refs.releaseRef(digest, holder),
    count: (digest: string): Promise<number> => refs.count(digest),
    isPinned: (digest: string): Promise<boolean> => refs.isPinned(digest),
    pin: (digest: string, holder: string): Promise<void> => claims.withDigestLock(digest, async (locked) => {
      if (await locked.isClaimed(digest)) throw new Error(`blob scheduled for deletion: ${digest}`);
      await refs.pin(digest, holder);
    }),
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
