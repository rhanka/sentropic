import { describe, expect, it, vi } from 'vitest';
import { createFairAdmission } from '../../../src/services/artifacts/live/admission';
import { fixture } from './fixture';

const a = { storageScopeId: 's', artifactId: 'a' }; const b = { storageScopeId: 's', artifactId: 'b' };
const c = { storageScopeId: 's', artifactId: 'c' };
type Held = Array<{ key: typeof a; ownerId: string }>;
function setup(capacity = 1, holders: () => Promise<Held> = async () => []) { let now = 0;
  return { admission: createFairAdmission({ capacity, waiterTtlMs: 1000, now: () => now, holders }),
    tick: (ms: number) => { now += ms; } }; }

describe('live fair admission (one worker, many users)', () => {
  it('should admit one binding and queue the others with builder_unavailable', async () => {
    const { admission } = setup();
    await admission.acquire(a, 'alice');
    await expect(admission.acquire(b, 'bob')).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
  });
  it('should be idempotent for the holder', async () => {
    const { admission } = setup(); await admission.acquire(a, 'alice'); await expect(admission.acquire(a, 'alice')).resolves.toBeUndefined();
  });
  it('should serve the user with the oldest grant first when the slot frees, not the first poller', async () => {
    const { admission, tick } = setup();
    await admission.acquire(a, 'alice'); tick(1);
    await expect(admission.acquire(b, 'alice')).rejects.toMatchObject({ reason: 'queued' }); tick(1);
    await expect(admission.acquire(c, 'bob')).rejects.toMatchObject({ reason: 'queued' });
    await admission.release(a); tick(1);
    await expect(admission.acquire(b, 'alice')).rejects.toMatchObject({ reason: 'queued' }); // alice was granted last
    await expect(admission.acquire(c, 'bob')).resolves.toBeUndefined();
  });
  it('should drop a stale waiter so an abandoned request never blocks the slot', async () => {
    const { admission, tick } = setup();
    await admission.acquire(a, 'alice'); await expect(admission.acquire(b, 'bob')).rejects.toBeTruthy();
    await admission.release(a); tick(5000);
    await expect(admission.acquire(c, 'carol')).resolves.toBeUndefined();
  });
  it('should ignore release by a binding that does not hold the slot', async () => {
    const { admission } = setup(); await admission.acquire(a, 'alice'); await admission.release(b);
    await expect(admission.acquire(b, 'bob')).rejects.toMatchObject({ reason: 'queued' });
  });
  it('should keep the slots of running pods after an API restart', async () => {
    const holders = vi.fn(async () => [{ key: a, ownerId: 'alice' }]); const { admission } = setup(1, holders);
    await expect(admission.acquire(b, 'bob')).rejects.toMatchObject({ reason: 'queued' });
    await expect(admission.acquire(a, 'alice')).resolves.toBeUndefined();
    await admission.release(a); await expect(admission.acquire(b, 'bob')).resolves.toBeUndefined();
    expect(holders).toHaveBeenCalledOnce();
  });
  it('should fail closed while running pods cannot be listed, then retry', async () => {
    const holders = vi.fn<() => Promise<Held>>().mockRejectedValueOnce(new Error('store down')).mockResolvedValue([]);
    const { admission } = setup(1, holders);
    await expect(admission.acquire(a, 'alice')).rejects.toMatchObject({ code: 'builder_unavailable' });
    await expect(admission.acquire(a, 'alice')).resolves.toBeUndefined(); expect(holders).toHaveBeenCalledTimes(2);
  });
  it('should refuse a capacity that is not a positive integer', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) expect(() => setup(capacity)).toThrow();
  });
  it('should not admit a fifth session after a restart while four pods run', async () => {
    const f = fixture({ capacity: 4 }); const keys = [0, 1, 2, 3].map(i => ({ storageScopeId: 's', artifactId: `x${i}` }));
    for (const k of keys) await f.controller.start(k);
    const restarted = createFairAdmission({ capacity: 4, waiterTtlMs: 60_000, now: () => 0, holders: () => f.ports.store.active() });
    await expect(restarted.acquire({ storageScopeId: 's', artifactId: 'x4' }, 'eve')).rejects.toMatchObject({ reason: 'queued' });
    await expect(restarted.acquire(keys[0], 'owner')).resolves.toBeUndefined();
  });
});
