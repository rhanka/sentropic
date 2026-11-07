import { describe, expect, it } from 'vitest';
import { createFairAdmission } from '../../../src/services/artifacts/live/admission';

const a = { storageScopeId: 's', artifactId: 'a' }; const b = { storageScopeId: 's', artifactId: 'b' };
const c = { storageScopeId: 's', artifactId: 'c' };
function setup(capacity = 1) { let now = 0;
  return { admission: createFairAdmission({ capacity, waiterTtlMs: 1000, now: () => now }), tick: (ms: number) => { now += ms; } }; }

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
});
