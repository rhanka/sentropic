import { describe, expect, it, vi } from 'vitest';
import { memoryRows } from './fixture';
import { createPoolManager } from '../../../src/services/artifacts/live/pool';
import { createHostPoolApi } from '../../../src/services/artifacts/live/pool-api';
import type { KubernetesCore } from '../../../src/services/artifacts/live/pods';

const setup = (scope: string, admin = false, shared?: { store: ReturnType<typeof memoryRows> }) => {
  const store = shared?.store ?? memoryRows();
  const pool = createPoolManager(store, { now: () => 1_000 });
  const kubernetes = { delete: vi.fn(async () => undefined), waitDeleted: vi.fn(async () => undefined) };
  const app = createHostPoolApi({ authenticate: () => ({ hostId: 'immo', storageScopeId: scope }),
    pool, kubernetes: kubernetes as unknown as KubernetesCore, now: () => 1_000, admin });
  return { pool, kubernetes, app, store };
};
const seedWarm = async (pool: ReturnType<typeof createPoolManager>, scope: string, cacheKey: string) => {
  const filling = await pool.beginFill(scope, cacheKey, 'B');
  await pool.completeFill(scope, cacheKey, `uid-${cacheKey}`);
  return filling.podName;
};

describe('pool endpoints (L3 §7.3.3, §7.6.3)', () => {
  it('should report per-scope occupancy and keep scopes isolated', async () => {
    const { pool, app, store } = setup('scope-a');
    await seedWarm(pool, 'scope-a', 'key-1');
    const res = await app.request('/v1/pool');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope: 'scope-a',
      occupancy: { warm: 1, warmDeps: 0, filling: 0, claimed: 0 } });
    const other = setup('scope-b', false, { store });
    const empty = await other.app.request('/v1/pool');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ scope: 'scope-b',
      occupancy: { warm: 0, warmDeps: 0, filling: 0, claimed: 0 } });
  });
  it('should refuse the drain without the pool admin flag', async () => {
    const { app } = setup('scope-a', false);
    const res = await app.request('/v1/pool/drain', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'access_denied' });
  });
  it('should drain every unbound pod with its pre-drain occupancy as the cold proof', async () => {
    const { pool, kubernetes, app } = setup('scope-a', true);
    const podName = await seedWarm(pool, 'scope-a', 'key-1');
    await pool.beginFill('scope-a', 'key-2', 'B');
    const res = await app.request('/v1/pool/drain', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope: 'scope-a',
      before: { warm: 1, warmDeps: 0, filling: 1, claimed: 0 } });
    expect(kubernetes.delete).toHaveBeenCalledWith('pods', podName, 'uid-key-1');
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 0 });
  });
  it('should leave claimed pods and other scopes untouched on drain', async () => {
    const { pool, app } = setup('scope-a', true);
    await seedWarm(pool, 'scope-a', 'key-1');
    await pool.claimForLive('scope-a', 'key-1');
    await seedWarm(pool, 'scope-a', 'key-2');
    const res = await app.request('/v1/pool/drain', { method: 'POST' });
    expect(await res.json()).toMatchObject({ before: { warm: 1, warmDeps: 0, filling: 0, claimed: 1 } });
    expect(await pool.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 1 });
  });
});
