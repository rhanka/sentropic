import { describe, expect, it } from 'vitest';
import {
  createHeavyPhaseQueue,
  createMemoryHeavyPhaseQueueStore,
  PROVISIONAL_HEAVY_PHASE_COSTS_MIB,
  type HeavyPhaseQueueStore,
} from '../src/runtime/heavy-phase-queue.js';

const node = 'd2-4-a';
function world(options: { store?: HeavyPhaseQueueStore; podBaseMiB?: number } = {}) {
  const clock = { now: 0 };
  const store = options.store ?? createMemoryHeavyPhaseQueueStore();
  const queue = createHeavyPhaseQueue({ store, now: () => clock.now, budget: { budgetMiB: 1706,
    podBaseMiB: options.podBaseMiB ?? 40, costs: PROVISIONAL_HEAVY_PHASE_COSTS_MIB, entryTtlMs: 30_000 } });
  return { clock, store, queue };
}
const pods = async (queue: ReturnType<typeof world>['queue'], subjects: string[]) => {
  for (const subject of subjects) await queue.hold(node, { subject, pod: true });
};

describe('cluster mesh heavy-phase queue (durable FIFO under a node memory budget)', () => {
  it('should keep strict FIFO: a phase that fits never bypasses an earlier one that does not', async () => {
    const { queue } = world(); await pods(queue, ['v1', 'v2', 'v3']);
    expect(await queue.request(node, { subject: 'v1', kind: 'prebundle' })).toMatchObject({ state: 'admitted' });
    expect(await queue.request(node, { subject: 'v2', kind: 'prebundle' }))
      .toMatchObject({ state: 'queued', position: 1, blockedBy: 'budget' });
    expect(await queue.request(node, { subject: 'v3', kind: 'dev' }))
      .toMatchObject({ state: 'queued', position: 2, blockedBy: 'fifo' });
    await queue.finish(node, { subject: 'v1', kind: 'prebundle' });
    expect((await queue.status(node)).entries).toEqual([
      { subject: 'v2', kind: 'prebundle', costMiB: 980, state: 'admitted', position: 0 },
      { subject: 'v3', kind: 'dev', costMiB: 418, state: 'admitted', position: 0 },
    ]);
  });
  it('should turn a finished dev into a live reservation and sequence P1, D1, P2, P3, P4, D2, D3', async () => {
    const { queue } = world(); await pods(queue, ['v1', 'v2', 'v3', 'v4']);
    const admitted = async (subject: string, kind: 'prebundle' | 'dev') =>
      (await queue.request(node, { subject, kind })).state === 'admitted';
    expect(await admitted('v1', 'prebundle')).toBe(true); await queue.finish(node, { subject: 'v1', kind: 'prebundle' });
    expect(await admitted('v1', 'dev')).toBe(true); await queue.finish(node, { subject: 'v1', kind: 'dev', live: true });
    expect([await admitted('v2', 'prebundle'), await admitted('v3', 'prebundle'), await admitted('v4', 'prebundle')])
      .toEqual([true, false, false]);
    await queue.finish(node, { subject: 'v2', kind: 'prebundle' });
    expect(await admitted('v2', 'dev')).toBe(false);
    const order = (await queue.status(node)).entries.map(e => `${e.subject}:${e.kind}:${e.state}`);
    expect(order).toEqual(['v3:prebundle:admitted', 'v4:prebundle:queued', 'v2:dev:queued']);
    await queue.finish(node, { subject: 'v3', kind: 'prebundle' });
    expect(await queue.request(node, { subject: 'v2', kind: 'dev' })).toMatchObject({ state: 'queued', blockedBy: 'budget' });
    await queue.finish(node, { subject: 'v4', kind: 'prebundle' });
    expect((await queue.status(node)).lives).toEqual(['v1']);
    expect(await admitted('v2', 'dev')).toBe(true); await queue.finish(node, { subject: 'v2', kind: 'dev', live: true });
    expect(await admitted('v3', 'dev')).toBe(true); await queue.finish(node, { subject: 'v3', kind: 'dev', live: true });
    expect(await queue.status(node)).toMatchObject({ lives: ['v1', 'v2', 'v3'], usedMiB: 160 + 3 * 418, budgetMiB: 1706 });
    // 4 pod bases + 4 lives exceed 1706 MiB at 40 MiB per base: the fourth dev waits for a live to stop.
    expect(await queue.request(node, { subject: 'v4', kind: 'dev' })).toMatchObject({ state: 'queued', blockedBy: 'budget' });
    await queue.hold(node, { subject: 'v1', live: false });
    expect(await admitted('v4', 'dev')).toBe(true);
  });
  it('should admit a build only when no live runs on the node, holding later phases behind it', async () => {
    const { queue } = world(); await pods(queue, ['v1', 'v2', 'v3']);
    await queue.request(node, { subject: 'v1', kind: 'dev' }); await queue.finish(node, { subject: 'v1', kind: 'dev', live: true });
    expect(await queue.request(node, { subject: 'v2', kind: 'build' })).toMatchObject({ state: 'queued', blockedBy: 'live' });
    expect(await queue.request(node, { subject: 'v3', kind: 'dev' })).toMatchObject({ state: 'queued', position: 2, blockedBy: 'fifo' });
    await queue.hold(node, { subject: 'v1', live: false });
    expect(await queue.request(node, { subject: 'v2', kind: 'build' })).toMatchObject({ state: 'admitted' });
    expect(await queue.status(node)).toMatchObject({ usedMiB: 120 + 1344 });
    expect(await queue.request(node, { subject: 'v3', kind: 'dev' })).toMatchObject({ state: 'queued', position: 1, blockedBy: 'budget' });
  });
  it('should keep a retry at its position and drop every ticket of a cancelled subject', async () => {
    const { queue } = world();
    await queue.request(node, { subject: 'v1', kind: 'build' });
    await queue.request(node, { subject: 'v2', kind: 'build' }); await queue.request(node, { subject: 'v3', kind: 'build' });
    expect(await queue.request(node, { subject: 'v2', kind: 'build' })).toMatchObject({ state: 'queued', position: 1 });
    await queue.cancel(node, 'v2');
    expect(await queue.request(node, { subject: 'v3', kind: 'build' })).toMatchObject({ state: 'queued', position: 1 });
  });
  it('should expire a waiter or an admitted runner that stops renewing after the TTL', async () => {
    const { queue, clock } = world();
    await queue.request(node, { subject: 'v1', kind: 'build' }); await queue.request(node, { subject: 'v2', kind: 'build' });
    clock.now = 20_000; expect(await queue.request(node, { subject: 'v2', kind: 'build' })).toMatchObject({ state: 'queued' });
    clock.now = 30_001; expect(await queue.request(node, { subject: 'v2', kind: 'build' })).toMatchObject({ state: 'admitted' });
    clock.now = 60_002; expect((await queue.status(node)).entries).toEqual([]);
  });
  it('should survive an API restart: the queue is durable and a seed replaces only the pod and live holds', async () => {
    const before = world(); await pods(before.queue, ['v1', 'v2']);
    await before.queue.request(node, { subject: 'v1', kind: 'build' }); await before.queue.request(node, { subject: 'v2', kind: 'build' });
    const after = world({ store: before.store });
    await after.queue.seed(node, { pods: ['v1', 'v2', 'v3'], lives: [] });
    expect(await after.queue.status(node)).toMatchObject({ pods: ['v1', 'v2', 'v3'], lives: [], usedMiB: 120 + 1344,
      entries: [{ subject: 'v1', state: 'admitted' }, { subject: 'v2', state: 'queued', position: 1 }] });
  });
  it('should refuse a budget that cannot admit every phase on an empty node', () => {
    expect(() => world({ podBaseMiB: 400 })).toThrow('heavy-phase budget');
    expect(() => createHeavyPhaseQueue({ store: createMemoryHeavyPhaseQueueStore(), now: () => 0,
      budget: { budgetMiB: 1706, podBaseMiB: 40, costs: { ...PROVISIONAL_HEAVY_PHASE_COSTS_MIB, dev: 0 }, entryTtlMs: 1 } }))
      .toThrow('heavy-phase budget');
  });
});
