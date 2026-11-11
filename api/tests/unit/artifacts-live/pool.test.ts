import { describe, expect, it, vi } from 'vitest';
import { memoryRows } from './fixture';
import { createPoolManager, readPoolMin, POOL_MAX_AGE_MS } from '../../../src/services/artifacts/live/pool';

const setup = () => {
  let now = 1_000_000;
  const removed: Array<{ podName: string; podUid: string }> = [];
  const pool = createPoolManager(memoryRows(), { now: () => now });
  const removePod = vi.fn(async (podName: string, podUid: string) => { removed.push({ podName, podUid }); });
  return { pool, removePod, removed, advance: (ms: number) => { now += ms; } };
};
const fillWarm = async (pool: ReturnType<typeof createPoolManager>, scope = 'scope-a', key = 'cache-k', base = 'B') => {
  const filling = await pool.beginFill(scope, key, base);
  return pool.completeFill(scope, key, 'uid-1').then(async warm => ({ filling, warm }));
};

describe('warm pod pool manager (L3)', () => {
  it('should fill to warm and keep the liveness lease alive through renew', async () => {
    const { pool } = setup();
    const { filling } = await fillWarm(pool);
    expect(filling.state).toBe('filling');
    const renewed: string[] = [];
    const first = await pool.renewAll('scope-a', async entry => { renewed.push(entry.podName); }, async () => {});
    expect(first).toEqual({ renewed: 1, evicted: 0 });
    expect(renewed).toHaveLength(1);
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 1, warmDeps: 0, filling: 0, claimed: 0 });
  });
  it('should let exactly one of two concurrent claims win and the other fall to cold', async () => {
    const { pool } = setup();
    await fillWarm(pool);
    const [first, second] = await Promise.all([pool.claimForLive('scope-a', 'cache-k'), pool.claimForLive('scope-a', 'cache-k')]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 1 });
  });
  it('should mark warm-deps synchronously on release so an immediate build claim hits', async () => {
    const { pool } = setup();
    await fillWarm(pool);
    const live = await pool.claimForLive('scope-a', 'cache-k');
    expect(live?.state).toBe('warm');
    const released = await pool.releaseWarmDeps('scope-a', 'cache-k', 'H');
    expect(released).toMatchObject({ state: 'warm-deps', poolEpoch: 1, baseHeadSha: 'H' });
    // A live claim must not serve warm-deps, but a build claim hits the hot tree at once.
    expect(await pool.claimForLive('scope-a', 'cache-k')).toBeUndefined();
    const build = await pool.claimForBuild('scope-a', 'cache-k');
    expect(build).toMatchObject({ state: 'warm-deps', poolEpoch: 1 });
  });
  it('should never match a claim across scopes, even for an identical lockfile', async () => {
    const { pool } = setup();
    await fillWarm(pool);
    expect(await pool.claimForLive('scope-b', 'cache-k')).toBeUndefined();
    expect(await pool.claimForBuild('scope-b', 'cache-k')).toBeUndefined();
    expect(await pool.claimForLive('scope-a', 'cache-k')).toBeDefined();
  });
  it('should drop a failed fill back to absent and refuse mismatched releases', async () => {
    const { pool } = setup();
    await pool.beginFill('scope-a', 'cache-k', 'B');
    await pool.failFill('scope-a', 'cache-k');
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 0 });
    await expect(pool.releaseWarmDeps('scope-a', 'cache-k', 'B')).rejects.toMatchObject({ reason: 'pool_release_mismatch' });
    await expect(pool.promoteWarm('scope-a', 'cache-k', 'B')).rejects.toMatchObject({ reason: 'pool_promote_mismatch' });
  });
  it('should drain every unbound pod with its pre-drain occupancy and keep claimed pods', async () => {
    const { pool, removePod, removed } = setup();
    await fillWarm(pool, 'scope-a', 'key-1');
    await pool.beginFill('scope-a', 'key-2', 'B');
    await fillWarm(pool, 'scope-a', 'key-3');
    await pool.claimForBuild('scope-a', 'key-3');
    const { before } = await pool.drain('scope-a', removePod);
    expect(before).toEqual({ warm: 1, warmDeps: 0, filling: 1, claimed: 1 });
    expect(removed.map(r => r.podUid)).toEqual(['uid-1']);
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 1 });
  });
  it('should reconcile rows against listed survivors both ways on adoption', async () => {
    const { pool, removePod } = setup();
    const { warm } = await fillWarm(pool);
    await pool.beginFill('scope-a', 'gone-key', 'B');
    const result = await pool.adopt('scope-a',
      [{ name: warm.podName, uid: 'uid-1' }, { name: 'artifact-pool-0123456789abcdef', uid: 'uid-x' }], removePod);
    expect(result.adopted).toHaveLength(1);
    expect(result.orphaned).toBe(1);
    expect(result.orphansDeleted).toBe(1);
    expect(removePod).toHaveBeenCalledWith('artifact-pool-0123456789abcdef', 'uid-x');
  });
  it('should evict pods older than 24 h instead of renewing them', async () => {
    const { pool, removePod, advance } = setup();
    await fillWarm(pool);
    advance(POOL_MAX_AGE_MS + 1);
    const result = await pool.renewAll('scope-a', async () => { throw new Error('must not renew'); }, removePod);
    expect(result).toEqual({ renewed: 0, evicted: 1 });
    expect(removePod).toHaveBeenCalledTimes(1);
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 0 });
  });
  it('should parse the pool minimum with a safe default and a 0 rollback shape', async () => {
    expect(readPoolMin({})).toBe(1);
    expect(readPoolMin({ ARTIFACT_POOL_MIN_PER_HOT_KEY: '2' })).toBe(2);
    expect(readPoolMin({ ARTIFACT_POOL_MIN_PER_HOT_KEY: '0' })).toBe(0);
    expect(readPoolMin({ ARTIFACT_POOL_MIN_PER_HOT_KEY: 'nope' })).toBe(1);
    expect(readPoolMin({ ARTIFACT_POOL_MIN_PER_HOT_KEY: '9' })).toBe(1);
  });
  it('should renew hot keys and adopt survivors across scopes', async () => {
    const { pool, removePod, advance } = setup();
    await fillWarm(pool);
    await pool.noteHot('scope-a', 'cache-k');
    await pool.noteHot('scope-a', 'cache-k');
    const renewed: string[] = [];
    expect(await pool.renewHot(async entry => { renewed.push(entry.podName); }, removePod))
      .toEqual({ renewed: 1, evicted: 0 });
    expect(renewed).toHaveLength(1);
    const survivors = [{ name: renewed[0], uid: 'uid-1' }, { name: 'artifact-pool-ffffffffffffffff', uid: 'uid-x' }];
    const adopted = await pool.adoptHot(survivors, removePod);
    expect(adopted.adopted).toHaveLength(1);
    expect(adopted.orphansDeleted).toBe(1);
    advance(POOL_MAX_AGE_MS + 1);
    expect(await pool.renewHot(async () => undefined, removePod)).toEqual({ renewed: 0, evicted: 1 });
  });
});
