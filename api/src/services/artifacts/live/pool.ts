import { randomUUID } from 'node:crypto';
import type { KvStore } from './cache-storage';
import { LiveError } from './records';
import { poolPodName } from './pods';

/** Durable warm-pool namespace (§7.3.1): one canonical row per `(scope, cacheKey)`, one scope index row.
 * No schema change — the same host KV as the heavy queue and the cache state. */
export const POOL_NAMESPACE = 'artifact-builder-pool/v1';
/** Pool label selecting every builder pool pod for adoption (`list`) and the drain proof. */
export const POOL_LABEL = 'sentropic.dev/pool';
export const POOL_LABEL_VALUE = 'artifact-builders';
/** Maximum pool-pod age (§7.3.2): 24 h, then delete and refill (bounds image/agent drift). */
export const POOL_MAX_AGE_MS = 24 * 3600_000;
/** Env name of the pool minimum per hot key (default 1, §7.3.1, D3/Q4). */
export const ARTIFACT_POOL_MIN_ENV = 'ARTIFACT_POOL_MIN_PER_HOT_KEY';
export const POOL_MIN_DEFAULT = 1;

export type PoolState = 'filling' | 'warm' | 'warm-deps' | 'claimed';
export interface PoolEntry {
  scope: string; cacheKey: string; baseHeadSha: string;
  podName: string; podUid: string; poolEpoch: number; state: PoolState;
  filledAt: number; lastRenewAt: number;
}
export interface PoolClaim {
  podName: string; podUid: string; poolEpoch: number;
  state: 'warm' | 'warm-deps'; cacheKey: string; baseHeadSha: string;
}
const entryKey = (scope: string, cacheKey: string) => `pool:${scope}:${cacheKey}`;
const indexKey = (scope: string) => `scope:${scope}`;

const poolId = () => randomUUID().replace(/-/g, '').slice(0, 16);

async function indexAdd(store: KvStore, scope: string, key: string): Promise<void> {
  await store.update<string[], void>(indexKey(scope), current => {
    const next = current?.includes(key) ? current : [...(current ?? []), key];
    return { next, result: undefined };
  });
}

/** Warm pod pool (§7.3): at least 1 warm pod per (scope, hot cacheKey). Claims flip `warm|warm-deps → claimed`
 * under compare-and-swap; a concurrent second claim misses cleanly to cold-known. Pods are never reused
 * across scopes, even for an identical lockfile: the pool key includes the scope, so a claim for another
 * scope cannot match by construction. */
export function createPoolManager(store: KvStore, options: { now(): number }) {
  const now = options.now;
  return {
    namespace: POOL_NAMESPACE,
    /** Begin a fill: a fresh pool pod identity, CAS `absent → filling`. The caller creates the pod and runs
     * the prepare sequence, then `completeFill`. A row in any other state refuses (another fill is running). */
    async beginFill(scope: string, cacheKey: string, baseHeadSha: string): Promise<PoolEntry> {
      const at = now();
      return store.update<PoolEntry, PoolEntry>(entryKey(scope, cacheKey), current => {
        if (current && current.state !== undefined) {
          throw new LiveError('builder_unavailable', 'pool_fill_in_progress');
        }
        const next: PoolEntry = { scope, cacheKey, baseHeadSha, podName: poolPodName(poolId()),
          podUid: '', poolEpoch: 0, state: 'filling', filledAt: 0, lastRenewAt: at };
        return { next, result: next };
      }).then(async entry => { await indexAdd(store, scope, entryKey(scope, cacheKey)); return entry; });
    },
    /** Admit a fill whose pod now serves: `filling → warm` with the recorded pod uid. */
    async completeFill(scope: string, cacheKey: string, podUid: string): Promise<PoolEntry> {
      const at = now();
      return store.update<PoolEntry, PoolEntry>(entryKey(scope, cacheKey), current => {
        if (!current || current.state !== 'filling') throw new LiveError('builder_unavailable', 'pool_fill_mismatch');
        const next: PoolEntry = { ...current, podUid, state: 'warm', filledAt: at, lastRenewAt: at };
        return { next, result: next };
      });
    },
    /** Drop a failed fill: back to absent so the next fill starts clean. Pod deletion stays with the caller. */
    async failFill(scope: string, cacheKey: string): Promise<void> {
      await store.update<PoolEntry, void>(entryKey(scope, cacheKey), current => {
        if (!current || current.state !== 'filling') return { result: undefined };
        return { next: undefined, result: undefined };
      });
    },
    /** Live claim (§7.3.2): `warm → claimed`. `warm-deps` never serves live (source must be restaged first);
     * static builds claim it through `claimForBuild`. A miss falls through to the cold-known path. */
    async claimForLive(scope: string, cacheKey: string): Promise<PoolClaim | undefined> {
      return store.update<PoolEntry, PoolClaim | undefined>(entryKey(scope, cacheKey), current => {
        if (!current || current.state !== 'warm') return { result: undefined };
        const next: PoolEntry = { ...current, state: 'claimed', lastRenewAt: now() };
        const claim: PoolClaim = { podName: current.podName, podUid: current.podUid,
          poolEpoch: current.poolEpoch, state: 'warm', cacheKey, baseHeadSha: current.baseHeadSha };
        return { next, result: claim };
      });
    },
    /** Build claim (§7.3.2): `warm | warm-deps → claimed`. Static builds stage `job.commitSha` directly and
     * never use `/tmp/vite-cache`, so a `warm-deps` pod (deps intact, workspace cleared) serves them. */
    async claimForBuild(scope: string, cacheKey: string): Promise<PoolClaim | undefined> {
      return store.update<PoolEntry, PoolClaim | undefined>(entryKey(scope, cacheKey), current => {
        if (!current || (current.state !== 'warm' && current.state !== 'warm-deps')) return { result: undefined };
        const from = current.state;
        const next: PoolEntry = { ...current, state: 'claimed', lastRenewAt: now() };
        const claim: PoolClaim = { podName: current.podName, podUid: current.podUid,
          poolEpoch: current.poolEpoch, state: from, cacheKey, baseHeadSha: current.baseHeadSha };
        return { next, result: claim };
      });
    },
  };
}
export type PoolManager = ReturnType<typeof createPoolManager>;
