import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createHeavyGate } from '../../../src/services/artifacts/live/heavy';

const keys = ['a', 'b', 'c', 'd'].map(id => ({ storageScopeId: 'scope-a', artifactId: `artifact-${id}` }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
/** Counts overlapping heavy work (install, build) to prove the per-node serialization. */
function overlap(f: ReturnType<typeof fixture>) {
  const meter = { active: 0, peak: 0 };
  const heavy = async () => { meter.active++; meter.peak = Math.max(meter.peak, meter.active);
    await new Promise(resolve => setTimeout(resolve, 2)); meter.active--; };
  f.ports.worker.prepare = vi.fn(heavy); f.ports.worker.build = vi.fn(async () => { await heavy(); return { candidateDigest: 'c' }; });
  return meter;
}

describe('live heavy phases share one node gate', () => {
  it('should stagger four concurrent cold revives of four users on one node', async () => {
    const f = fixture({ capacity: 4 }); keys.forEach((k, i) => f.owners.set(`${k.storageScopeId}/${k.artifactId}`, `user-${i}`));
    const meter = overlap(f);
    const lives = await Promise.all(keys.map(k => f.controller.start(k)));
    expect(meter.peak).toBe(1); expect(lives.map(l => l.phase)).toEqual(['LIVE', 'LIVE', 'LIVE', 'LIVE']);
    expect(new Set(lives.map(l => l.ownerId)).size).toBe(4);
  });
  it('should hold a cold revive while another binding runs its idle clean build', async () => {
    const f = fixture({ capacity: 2 }); await f.controller.start(keys[0]);
    const building = deferred(); const release = deferred();
    f.ports.worker.build = vi.fn(async () => { building.resolve(); await release.promise; return { candidateDigest: 'c' }; });
    f.advance(900_001); const idle = f.controller.reap(keys[0]); await building.promise;
    const prepare = vi.mocked(f.ports.worker.prepare).mock.calls.length;
    const revive = f.controller.start(keys[1]); await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.ports.worker.prepare).toHaveBeenCalledTimes(prepare);
    release.resolve(); await idle; await expect(revive).resolves.toMatchObject({ phase: 'LIVE' });
  });
  it('should serialize an explicit clean build behind a running revive', async () => {
    const f = fixture({ capacity: 2 }); const meter = overlap(f);
    await Promise.all([f.controller.start(keys[0]), f.controller.buildOnly(keys[1], 'job-1')]);
    expect(meter.peak).toBe(1); expect(f.ports.worker.build).toHaveBeenCalledOnce();
    expect((await f.state(keys[1]))?.runtime.phase).toBe('DORMANT');
  });
  it('should project an HMR edit while another binding holds the gate', async () => {
    const f = fixture({ capacity: 2 }); await f.controller.start(key);
    const held = deferred(); f.ports.worker.prepare = vi.fn(async () => { await held.promise; });
    const revive = f.controller.start(keys[1]);
    f.draft().revision = 'r2'; await expect(f.controller.project(key, 'r2')).resolves.toMatchObject({ phase: 'LIVE', appliedRevision: 'r2' });
    held.resolve(); await revive;
  });
  it('should refuse a revive queued past the bound without writing state or keeping the slot', async () => {
    const f = fixture({ capacity: 2 }); f.ports.heavy = createHeavyGate({ maxWaitMs: 5 });
    const held = deferred(); f.ports.worker.prepare = vi.fn(async () => { await held.promise; });
    const first = f.controller.start(keys[0]);
    await expect(f.controller.start(keys[1])).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect(await f.state(keys[1])).toBeUndefined();
    await expect(f.admission.acquire(keys[2], 'other')).resolves.toBeUndefined();
    held.resolve(); await first;
  });
});
