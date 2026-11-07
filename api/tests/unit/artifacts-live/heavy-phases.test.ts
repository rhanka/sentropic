import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';

const keys = ['a', 'b', 'c', 'd'].map(id => ({ storageScopeId: 'scope-a', artifactId: `artifact-${id}` }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
/** Counts overlapping pre-bundles and builds, the phases whose peaks cannot stack on one d2-4 node. */
function overlap(f: ReturnType<typeof fixture>) {
  const meter = { active: 0, peak: 0 };
  const heavy = async () => { meter.active++; meter.peak = Math.max(meter.peak, meter.active);
    await new Promise(resolve => setTimeout(resolve, 2)); meter.active--; };
  f.ports.worker.prebundle = vi.fn(heavy); f.ports.worker.build = vi.fn(async () => { await heavy(); return { candidateDigest: 'c' }; });
  return meter;
}
const users = (f: ReturnType<typeof fixture>) => keys.forEach((k, i) => f.owners.set(`${k.storageScopeId}/${k.artifactId}`, `user-${i}`));

describe('live heavy phases go through the cluster-mesh queue of one d2-4 node (1706 MiB)', () => {
  it('should sequence the pre-bundles of three users and bring each live after its own', async () => {
    const f = fixture({ capacity: 4, budgetMiB: 1706 }); users(f); const meter = overlap(f);
    const lives = await Promise.all(keys.slice(0, 3).map(k => f.controller.start(k)));
    expect(meter.peak).toBe(1); expect(lives.map(l => l.phase)).toEqual(['LIVE', 'LIVE', 'LIVE']);
    expect(new Set(lives.map(l => l.ownerId)).size).toBe(3);
    expect(await f.queue.status('d2-4-a')).toMatchObject({ usedMiB: 3 * 40 + 3 * 418, entries: [] });
    expect((await f.queue.status('d2-4-a')).lives).toHaveLength(3);
  });
  it('should queue a fourth pre-bundle while three lives run, then refuse it past the bound and free its pod', async () => {
    const f = fixture({ capacity: 4, budgetMiB: 1706, maxWaitMs: 20 }); users(f);
    for (const k of keys.slice(0, 3)) await f.controller.start(k);
    await expect(f.controller.start(keys[3])).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect((await f.state(keys[3]))?.runtime).toMatchObject({ phase: 'DORMANT', stateDetail: 'builder_unavailable' });
    expect(f.objects.size).toBe(3); expect((await f.queue.status('d2-4-a')).pods).toHaveLength(3);
    await expect(f.admission.acquire(keys[3], 'user-3')).resolves.toBeUndefined();
  });
  it('should hold an explicit clean build while another binding is live and refuse it past the bound', async () => {
    const f = fixture({ capacity: 2, budgetMiB: 1706, maxWaitMs: 20 }); await f.controller.start(keys[0]);
    await expect(f.controller.buildOnly(keys[1], 'job-1')).rejects.toMatchObject({ reason: 'queued' });
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect((await f.state(keys[1]))?.runtime.phase).toBe('DORMANT');
  });
  it('should run an explicit clean build once no live runs on the node', async () => {
    const f = fixture({ capacity: 2, budgetMiB: 1706 }); const meter = overlap(f);
    await f.controller.buildOnly(keys[1], 'job-1');
    expect(meter.peak).toBe(1); expect((await f.state(keys[1]))?.runtime.phase).toBe('DORMANT');
    expect(await f.queue.status('d2-4-a')).toMatchObject({ pods: [], lives: [], entries: [] });
  });
  it('should project an HMR edit while another binding waits on its pre-bundle', async () => {
    const f = fixture({ capacity: 2, budgetMiB: 1706 }); await f.controller.start(key);
    const held = deferred(); f.ports.worker.prebundle = vi.fn(async () => { await held.promise; });
    const revive = f.controller.start(keys[1]);
    f.draft().revision = 'r2'; await expect(f.controller.project(key, 'r2')).resolves.toMatchObject({ phase: 'LIVE', appliedRevision: 'r2' });
    held.resolve(); await expect(revive).resolves.toMatchObject({ phase: 'LIVE' });
  });
});
