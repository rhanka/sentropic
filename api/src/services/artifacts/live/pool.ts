import { randomUUID } from 'node:crypto';
import type { KvStore } from './cache-storage';
import { LiveError } from './records';
import { poolPodName } from './pods';

/** Durable warm-pool namespace (§7.3.1): one canonical row per `(scope, cacheKey)`, one scope index row.
 * No schema change — the same host KV as the heavy queue and the cache state. */
export const POOL_NAMESPACE = 'artifact-builder-pool/v1';
/** Maximum pool-pod age (§7.3.2): 24 h, then delete and refill (bounds image/agent drift). */
export const POOL_MAX_AGE_MS = 24 * 3600_000;
/** Env name of the pool minimum per hot key (default 1, §7.3.1, D3/Q4). */
export const ARTIFACT_POOL_MIN_ENV = 'ARTIFACT_POOL_MIN_PER_HOT_KEY';
export const POOL_MIN_DEFAULT = 1;

/** Tombstone: `KvStore.update` with `next: undefined` is a no-op (memory and Postgres alike keep the row),
 * so absence is written explicitly. Absent rows are invisible to occupancy/claims/drain/adopt/renew; `beginFill`
 * and `releaseUnclaimed` treat them as free. */
export type PoolState = 'filling' | 'warm' | 'warm-deps' | 'claimed' | 'absent';
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
        if (current && current.state !== 'absent') {
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
        return { next: { ...current, state: 'absent' }, result: undefined };
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
    /** Synchronous `warm-deps` release (§7.3.2, convergence Q2): `claimed → warm-deps` with `poolEpoch + 1`,
     * marked before `stop` answers so an immediately following `git_publish` claims the hot tree. The caller
     * verified the scrub ACK first (cleared `['/workspace', '/tmp']`, frozen `/dependencies`); any scrub doubt
     * deletes the pod instead of calling this. */
    async releaseWarmDeps(scope: string, cacheKey: string, baseHeadSha: string): Promise<PoolEntry> {
      const at = now();
      return store.update<PoolEntry, PoolEntry>(entryKey(scope, cacheKey), current => {
        if (!current || current.state !== 'claimed') throw new LiveError('builder_unavailable', 'pool_release_mismatch');
        const next: PoolEntry = { ...current, state: 'warm-deps', poolEpoch: current.poolEpoch + 1,
          baseHeadSha, lastRenewAt: at };
        return { next, result: next };
      });
    },
    /** Background refill promotion (`warm-deps → warm`) after the base source + prebundle were restaged.
     * `filledAt` (image/drift age) is preserved: only a fresh fill resets it. */
    async promoteWarm(scope: string, cacheKey: string, baseHeadSha: string): Promise<PoolEntry> {
      const at = now();
      return store.update<PoolEntry, PoolEntry>(entryKey(scope, cacheKey), current => {
        if (!current || current.state !== 'warm-deps') {
          throw new LiveError('builder_unavailable', 'pool_promote_mismatch');
        }
        const next: PoolEntry = { ...current, state: 'warm', baseHeadSha, lastRenewAt: at };
        return { next, result: next };
      });
    },
    /** Cold-pod release (§7.3.2, convergence Q2): `absent → warm-deps` for a scrubbed session pod that never
     * went through a claim (the S6 `stop` whose `publish` follows). Returns undefined when a row already
     * exists — the caller then deletes its pod instead of doubling the pool. */
    async releaseUnclaimed(scope: string, cacheKey: string, podName: string, podUid: string,
      baseHeadSha: string, poolEpoch: number): Promise<PoolEntry | undefined> {
      const at = now();
      return store.update<PoolEntry, PoolEntry | undefined>(entryKey(scope, cacheKey), current => {
        if (current && current.state !== 'absent') return { result: undefined };
        const next: PoolEntry = { scope, cacheKey, baseHeadSha, podName, podUid, poolEpoch,
          state: 'warm-deps', filledAt: at, lastRenewAt: at };
        return { next, result: next };
      });
    },
    /** Drop a row in any state back to absent, for scrub-doubt pod deletions. */
    async drop(scope: string, cacheKey: string): Promise<void> {
      await store.update<PoolEntry, void>(entryKey(scope, cacheKey), current => {
        if (!current) return { result: undefined };
        return { next: { ...current, state: 'absent' }, result: undefined };
      });
    },
    /** Per-scope occupancy for `GET /v1/pool` (§7.6.3). Absent tombstones are invisible. */
    async occupancy(scope: string): Promise<{ warm: number; warmDeps: number; filling: number; claimed: number }> {
      const keys = (await store.read<string[]>(indexKey(scope))) ?? [];
      const counts = { warm: 0, warmDeps: 0, filling: 0, claimed: 0 };
      for (const key of keys) {
        const entry = await store.read<PoolEntry>(key);
        if (!entry || entry.state === 'absent') continue;
        if (entry.state === 'warm') counts.warm++;
        else if (entry.state === 'warm-deps') counts.warmDeps++;
        else if (entry.state === 'filling') counts.filling++;
        else if (entry.state === 'claimed') counts.claimed++;
      }
      return counts;
    },
    /** Acceptance drain control (§7.3.3): deletes every unbound pool pod (`warm`, `warm-deps`, `filling`)
     * for the caller's scope without touching sealed units, and returns the pre-drain occupancy + timestamp
     * the acceptance report records as the per-run cold proof. Claimed pods (bound sessions) are untouched. */
    async drain(scope: string, removePod: (podName: string, podUid: string) => Promise<void>): Promise<{
      before: { warm: number; warmDeps: number; filling: number; claimed: number }; at: number }> {
      const keys = (await store.read<string[]>(indexKey(scope))) ?? [];
      const before = { warm: 0, warmDeps: 0, filling: 0, claimed: 0 };
      for (const key of keys) {
        const entry = await store.read<PoolEntry>(key);
        if (!entry || entry.scope !== scope || entry.state === 'absent') continue;
        if (entry.state === 'warm') before.warm++;
        else if (entry.state === 'warm-deps') before.warmDeps++;
        else if (entry.state === 'filling') before.filling++;
        else { before.claimed++; continue; }
        if (entry.podUid) await removePod(entry.podName, entry.podUid).catch(() => undefined);
        await store.update<PoolEntry, void>(key, current => ({ next: { ...current!, state: 'absent' }, result: undefined }));
      }
      return { before, at: now() };
    },
    /** Post-restart adoption (§7.3.5, §7.5.4): cross-checks KV rows against the `list` survivors. A pod
     * present in Kubernetes with a matching uid is re-adopted (the caller re-holds its heavy slot); a row
     * whose pod is gone, uid-mismatched or older than 24 h is dropped; a pool-labelled pod with no row is
     * reported for deletion as an orphan. */
    async adopt(scope: string, survivors: Array<{ name: string; uid: string }>,
      removePod: (podName: string, podUid: string) => Promise<void>): Promise<{
        adopted: PoolEntry[]; orphaned: number; orphansDeleted: number }> {
      const keys = (await store.read<string[]>(indexKey(scope))) ?? [];
      const byName = new Map(survivors.map(s => [s.name, s.uid]));
      const adopted: PoolEntry[] = [];
      let orphaned = 0; let orphansDeleted = 0;
      const tombstone = (key: string, entry: PoolEntry) =>
        store.update<PoolEntry, void>(key, () => ({ next: { ...entry, state: 'absent' }, result: undefined }));
      for (const key of keys) {
        const entry = await store.read<PoolEntry>(key);
        if (!entry || entry.scope !== scope || entry.state === 'absent') continue;
        const uid = byName.get(entry.podName);
        byName.delete(entry.podName);
        const alive = uid === entry.podUid && entry.podUid !== '' && now() - entry.filledAt <= POOL_MAX_AGE_MS;
        if (!alive) {
          orphaned++;
          await tombstone(key, entry);
          continue;
        }
        if (entry.state === 'filling') {
          // Mid-fill after a dead runner: the tree is untrusted, so the pod is deleted, not adopted.
          orphaned++;
          await tombstone(key, entry);
          await removePod(entry.podName, entry.podUid).catch(() => undefined);
          continue;
        }
        adopted.push(entry);
      }
      for (const [name, uid] of byName) {
        await removePod(name, uid).catch(() => undefined);
        orphansDeleted++;
      }
      return { adopted, orphaned, orphansDeleted };
    },
    /** Pool liveness renew (§7.3.1): a fenced `renew` at least every 60 s on every `warm`/`warm-deps` pod so
     * idle pool pods never self-terminate (30 min lease). Entries older than 24 h are evicted instead. */
    async renewAll(scope: string, renew: (entry: PoolEntry) => Promise<void>,
      removePod: (podName: string, podUid: string) => Promise<void>): Promise<{ renewed: number; evicted: number }> {
      const keys = (await store.read<string[]>(indexKey(scope))) ?? [];
      let renewed = 0; let evicted = 0;
      for (const key of keys) {
        const entry = await store.read<PoolEntry>(key);
        if (!entry || entry.scope !== scope
          || (entry.state !== 'warm' && entry.state !== 'warm-deps')) continue;
        if (now() - entry.filledAt > POOL_MAX_AGE_MS) {
          if (entry.podUid) await removePod(entry.podName, entry.podUid).catch(() => undefined);
          await store.update<PoolEntry, void>(key, () => ({ next: { ...entry, state: 'absent' }, result: undefined }));
          evicted++; continue;
        }
        await renew(entry);
        await store.update<PoolEntry, void>(key, current => {
          if (!current || (current.state !== 'warm' && current.state !== 'warm-deps')) return { result: undefined };
          return { next: { ...current, lastRenewAt: now() }, result: undefined };
        }).catch(() => undefined);
        renewed++;
      }
      return { renewed, evicted };
    },
  };
}

/** Pool minimum per hot key (§7.3.1, default 1; 0 disables the pool — the §7.7 rollback shape). */
export function readPoolMin(env: Readonly<Record<string, string | undefined>>): number {
  const parsed = Number(env[ARTIFACT_POOL_MIN_ENV]?.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 4 ? parsed : POOL_MIN_DEFAULT;
}
export type PoolManager = ReturnType<typeof createPoolManager>;
