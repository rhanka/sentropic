import type { PoolClient } from 'pg';
import type { LiveAttempt, LiveKey, LiveRuntime, LiveState } from './records';
import type { CacheIdentity, CacheReceipt } from './cache';

export interface LiveStore {
  read(key: LiveKey): Promise<LiveState | undefined>;
  /** Serializes one binding across API replicas. Exceptions roll back state AND release writes. */
  transaction<T>(key: LiveKey, work: (unit: {
    state: LiveState | undefined; save(state: LiveState): void; client?: PoolClient;
  }) => Promise<T>): Promise<T>;
}
export interface LiveBinding {
  generation: number; ownerId: string; headSha: string; healthy: boolean;
  autoPublish: boolean; automaticAuthorized: boolean; releaseId: string | null; releaseCommit: string | null;
  /** Comes from durable branch-creation/publication history, never inferred from a missing pointer. */
  initialUnpublishedBranchEligible: boolean;
}
export interface DraftSnapshot {
  generation: number; revision: number; baseHeadSha: string; treeSha: string; dirty: boolean;
}
export interface SourceSnapshot {
  headSha: string; treeSha: string; lockfile: Uint8Array; cacheIdentity: CacheIdentity;
  /** Trusted, path-filtered staging reference. No forge credentials or environment files. */
  stagingRef: string;
}
export interface LivePorts {
  store: LiveStore;
  now(): number;
  id(): string;
  /** Rechecks binding policy, owner/code rights, generation and sandbox qualification. */
  binding(key: LiveKey): Promise<LiveBinding>;
  forge: {
    head(key: LiveKey): Promise<string>;
    fastForward(key: LiveKey, before: string, after: string): Promise<boolean>;
    snapshot(key: LiveKey, headSha: string): Promise<SourceSnapshot>;
  };
  drafts: {
    current(key: LiveKey): Promise<DraftSnapshot>;
    /** CAS only an empty overlay to a verified new head; a concurrent edit must refuse. */
    advanceClean(key: LiveKey, expected: DraftSnapshot, headSha: string): Promise<DraftSnapshot>;
    /** Verifies the already-durable encrypted pointer; failure must prevent destructive cleanup. */
    checkpoint(key: LiveKey, draft: DraftSnapshot): Promise<void>;
  };
  pods: {
    ensure(key: LiveKey, runtime: LiveRuntime): Promise<{ uid: string }>;
    remove(key: LiveKey, runtime: LiveRuntime): Promise<void>;
  };
  cache: { acquire(source: SourceSnapshot): Promise<CacheReceipt> };
  /** Trusted supervisor transport: monotonic routeEpoch fences every operation, including delayed requests.
   * Quiesce cancels all older commands and waits for full process-tree termination.
   * Prepare installs dependencies read-only, clears branch npm config and phase-fences relay access.
   */
  worker: {
    prepare(runtime: LiveRuntime, source: SourceSnapshot, cache: CacheReceipt): Promise<void>;
    restore(runtime: LiveRuntime, draft: DraftSnapshot): Promise<void>;
    live(runtime: LiveRuntime): Promise<{ revision: number; routeEpoch: number }>;
    quiesce(runtime: LiveRuntime): Promise<void>;
    /** Removes ALL writable phase residue, including dependency overlays and old output. */
    clean(runtime: LiveRuntime): Promise<void>;
    build(runtime: LiveRuntime, attempt: LiveAttempt): Promise<{ candidateDigest: string }>;
    verify(runtime: LiveRuntime, attempt: LiveAttempt): Promise<void>;
  };
  routes: { revoke(key: LiveKey, runtime: LiveRuntime): Promise<void>; ready(key: LiveKey, runtime: LiveRuntime): Promise<void> };
  publication: {
    /** Atomic SG4 release/index/receipt writes in the supplied store transaction; never network publication here. */
    commit(unit: { client?: PoolClient }, key: LiveKey, attempt: LiveAttempt): Promise<{ releaseId: string }>;
  };
}
