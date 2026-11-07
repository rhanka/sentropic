import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createLiveScheduler } from '../../../src/services/artifacts/live/scheduler';

const other = { storageScopeId: 'scope-a', artifactId: 'artifact-b' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('live scheduler (lease cadence and concurrent reconcile)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('should send a fenced frame for every runtime that is not DORMANT on each tick', async () => {
    const f = fixture({ capacity: 2 }); const a = await f.controller.start(key); const b = await f.controller.start(other);
    const scheduler = createLiveScheduler({ controller: f.controller, intervalMs: 30_000, onError: vi.fn() });
    await scheduler.tick();
    expect(vi.mocked(f.ports.worker.renew).mock.calls.map(([runtime]) => runtime.sessionId).sort())
      .toEqual([a.sessionId, b.sessionId].sort());
    await f.controller.stop(other, { ownerId: 'owner', sessionId: b.sessionId, generation: 1 });
    vi.mocked(f.ports.worker.renew).mockClear(); await scheduler.tick();
    expect(f.ports.worker.renew).toHaveBeenCalledOnce();
    expect(f.ports.worker.renew).toHaveBeenCalledWith(expect.objectContaining({ sessionId: a.sessionId }));
  });
  it('should reconcile keys concurrently and keep leasing a key whose heavy phase is still running', async () => {
    const blocked = deferred(); const reconciled: string[] = [];
    const controller = {
      active: vi.fn(async () => [{ key, ownerId: 'alice' }, { key: other, ownerId: 'bob' }]),
      lease: vi.fn(async (_k: typeof key) => true),
      reconcile: vi.fn(async (k: typeof key) => { if (k === key) await blocked.promise; reconciled.push(k.artifactId); }),
    };
    const scheduler = createLiveScheduler({ controller, intervalMs: 30_000, onError: vi.fn() });
    await scheduler.tick(); await flush(); expect(reconciled).toEqual(['artifact-b']);
    await scheduler.tick(); await flush();
    expect(controller.reconcile.mock.calls.filter(([k]) => k === key)).toHaveLength(1);
    expect(controller.lease.mock.calls.filter(([k]) => k === key)).toHaveLength(2);
    blocked.resolve(); await flush(); expect(reconciled).toEqual(['artifact-b', 'artifact-b', 'artifact-a']);
  });
  it('should report a failed frame or reconcile and continue with the other keys', async () => {
    const onError = vi.fn();
    const controller = { active: vi.fn(async () => [{ key, ownerId: 'alice' }, { key: other, ownerId: 'bob' }]),
      lease: vi.fn(async (k: typeof key) => { if (k === key) throw new Error('unreachable'); return true; }),
      reconcile: vi.fn(async () => undefined) };
    await createLiveScheduler({ controller, intervalMs: 30_000, onError }).tick(); await flush();
    expect(onError).toHaveBeenCalledWith(key, expect.any(Error)); expect(controller.lease).toHaveBeenCalledTimes(2);
    expect(controller.reconcile).toHaveBeenCalledTimes(2);
  });
  it('should tick at least twice per lease interval once started, and stop', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.controller.start(key);
    const scheduler = createLiveScheduler({ controller: f.controller, intervalMs: 30_000, onError: vi.fn() });
    const handle = scheduler.start(); await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(f.ports.worker.renew).mock.calls.length).toBeGreaterThanOrEqual(2);
    handle.stop(); const count = vi.mocked(f.ports.worker.renew).mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000); expect(f.ports.worker.renew).toHaveBeenCalledTimes(count);
  });
  it('should refuse an interval that cannot keep a frame within 60 s', () => {
    const f = fixture();
    for (const intervalMs of [0, 30_001, 60_000]) {
      expect(() => createLiveScheduler({ controller: f.controller, intervalMs, onError: vi.fn() })).toThrow();
    }
  });
});
