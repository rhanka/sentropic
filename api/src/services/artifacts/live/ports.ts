import type { PoolClient } from 'pg';
import type { LiveAttempt, LiveKey, LivePhase, LiveRuntime, LiveState } from './records';
import type { LiveAdmission } from './admission';
import type { LiveHeavyGate } from './heavy';
import type { CacheIdentity, CacheReceipt } from './cache';
import type { AttemptFence } from './host-recheck';
/** Host-resolved pending job (G0 v3 §2.6). */
export interface HostJob { jobId: string; generation: number; headSha: string; expectedReleaseId: string | null }

export interface LiveStore {
  read(key: LiveKey): Promise<LiveState | undefined>;
  /** Every runtime that is not DORMANT (this environment): the scheduler set and the admission slots after a restart. */
  active(): Promise<Array<{ key: LiveKey; ownerId: string; phase: LivePhase }>>;
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
  generation: number; revision: string; baseHeadSha: string; treeSha: string; dirty: boolean;
}
export interface SourceSnapshot {
  headSha: string; treeSha: string; lockfile: Uint8Array; cacheIdentity: CacheIdentity;
  /** Trusted, path-filtered staging reference. No forge credentials or environment files. */
  stagingRef: string;
  /** GB1 descriptor digest validated at this exact commit. */
  descriptorDigest: string;
}
export interface LivePorts {
  store: LiveStore;
  /** Live pod slots (r3.5: four on one d2-4 node) shared fairly by users; refusal is `builder_unavailable`. */
  admission: LiveAdmission;
  /** Node client of the cluster-mesh heavy-phase queue: install, pre-bundle, dev start and clean build are admitted in
   * strict FIFO under the node memory budget (cold revive, wake, crash restore and builds alike). */
  heavy: LiveHeavyGate;
  /** Host-owned invitation fence of the binding generation: a monotonic revocation epoch (an invitation is valid only
   * when issued at the current epoch) and the earliest live invitation expiry. */
  invitations: { current(key: LiveKey, generation: number): Promise<{ epoch: number; expiresAt: number | null }> };
  now(): number;
  id(): string;
  /** Rechecks binding policy, owner/code rights, generation and sandbox qualification. */
  binding(key: LiveKey): Promise<LiveBinding>;
  forge: {
    head(key: LiveKey): Promise<string>;
    fastForward(key: LiveKey, before: string, after: string): Promise<boolean>;
    reachable(key: LiveKey, headSha: string): Promise<boolean>;
    snapshot(key: LiveKey, headSha: string): Promise<SourceSnapshot>;
  };
  drafts: {
    current(key: LiveKey, generation: number): Promise<DraftSnapshot>;
    /** CAS only an empty overlay to a verified new head; a concurrent edit must refuse. */
    advanceClean(key: LiveKey, expected: DraftSnapshot, headSha: string): Promise<DraftSnapshot>;
    /** Verifies the already-durable encrypted pointer; failure must prevent destructive cleanup. */
    checkpoint(key: LiveKey, draft: DraftSnapshot): Promise<void>;
  };
  pods: {
    ensure(key: LiveKey, runtime: LiveRuntime): Promise<{ uid: string }>;
    remove(key: LiveKey, runtime: LiveRuntime): Promise<void>;
  };
  cache: { acquire(source: SourceSnapshot, runtime: LiveRuntime): Promise<CacheReceipt> };
  /** Trusted supervisor transport: monotonic routeEpoch fences every operation, including delayed requests.
   * Quiesce cancels all older commands and waits for full process-tree termination.
   * Prepare installs dependencies read-only, clears branch npm config and phase-fences relay access.
   */
  worker: {
    prepare(runtime: LiveRuntime, source: SourceSnapshot, cache: CacheReceipt): Promise<void>;
    restore(runtime: LiveRuntime, draft: DraftSnapshot): Promise<void>;
    /** Vite dependency pre-bundle in the pod, a separate supervisor op that must precede `live` in every pod. */
    prebundle(runtime: LiveRuntime): Promise<void>;
    live(runtime: LiveRuntime): Promise<{ revision: string; routeEpoch: number }>;
    quiesce(runtime: LiveRuntime): Promise<void>;
    /** Removes ALL writable phase residue, including dependency overlays and old output. */
    clean(runtime: LiveRuntime): Promise<void>;
    build(runtime: LiveRuntime, attempt: LiveAttempt): Promise<{ candidateDigest: string }>;
    verify(runtime: LiveRuntime, attempt: LiveAttempt): Promise<void>;
    /** Liveness lease (A-LIVE Amendment 1 §3): one authenticated, fenced frame with no side effect. Without one for
     * 30 minutes the bootstrap kills the process tree and exits. */
    renew(runtime: LiveRuntime): Promise<void>;
  };
  routes: { revoke(key: LiveKey, runtime: LiveRuntime): Promise<void>; ready(key: LiveKey, runtime: LiveRuntime): Promise<void> };
  publication: {
    /** Resolve the binding's pending SG3/SG4 job at its generation, never a caller-supplied SHA or CAS. The host
     * records `fence` (this run and attempt) monotonically; only that attempt's handoff can publish. */
    job(key: LiveKey, jobId: string, fence: AttemptFence): Promise<HostJob>;
    /** Atomic SG4 release/index/receipt writes in the supplied store transaction; never network publication here. */
    commit(unit: { client?: PoolClient }, key: LiveKey, attempt: LiveAttempt, runtime: LiveRuntime): Promise<{ releaseId: string }>;
  };
}
