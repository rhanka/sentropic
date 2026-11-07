import { describe, expect, it } from 'vitest';
import { fixture, key, owner } from './fixture';

const other = { storageScopeId: 'scope-a', artifactId: 'artifact-b' };

describe('live idle reaper (A-LIVE Amendment 1: 900 s, ends on the clean build)', () => {
  it('should not reap at exactly 900 s and reap strictly after with the clean build, then free the slot', async () => {
    const f = fixture(); await f.controller.start(key); f.events.length = 0;
    f.advance(900_000); await f.controller.reap(key);
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect((await f.state())?.runtime.phase).toBe('LIVE');
    f.advance(1); await f.controller.reap(key);
    expect(f.events).toEqual(['revoke', 'quiesce', 'checkpoint', 'clean', 'prepare:B', 'build', 'verify',
      'revoke', 'quiesce', 'checkpoint']);
    expect((await f.state())?.runtime.phase).toBe('DORMANT'); expect(f.objects.size).toBe(0);
    await expect(f.admission.acquire(other, 'bob')).resolves.toBeUndefined();
  });
  it('should extend a session under qualifying activity past one hour with no teardown', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    for (let minute = 0; minute < 90; minute += 10) {
      f.advance(600_000); await f.controller.activity(key, live.sessionId, minute % 20 ? 'read' : 'foreground', owner);
      await f.controller.reconcile(key); await f.controller.reap(key);
    }
    const runtime = (await f.state())!.runtime;
    expect(runtime).toMatchObject({ phase: 'LIVE', sessionId: live.sessionId, appliedRevision: 'r1' });
    expect(runtime).not.toHaveProperty('maximumLifetimeAt');
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect(f.ports.drafts.checkpoint).toHaveBeenCalledOnce();
  });
  it('should not renew idle time on status, heartbeat or ping', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    for (const kind of ['status', 'heartbeat', 'ping'] as const) {
      f.advance(300_000); await f.controller.activity(key, live.sessionId, kind, owner);
    }
    f.advance(1); await f.controller.reap(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('should reap through the scheduler reconcile pass', async () => {
    const f = fixture(); await f.controller.start(key); f.advance(900_001);
    await f.controller.reconcile(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect((await f.state())?.runtime.stateDetail).toBeUndefined();
  });
  it('should stop the live, then wait durably in BUILD_QUEUED while another binding is live, and build after it stops', async () => {
    const f = fixture({ capacity: 2, budgetMiB: 1706 }); await f.controller.start(key); const b = await f.controller.start(other);
    f.advance(900_001); await f.controller.activity(other, b.sessionId, 'read', owner);
    await f.controller.reap(key); await f.controller.reconcile(key);
    expect((await f.state())?.runtime.phase).toBe('BUILD_QUEUED'); expect(f.ports.worker.build).not.toHaveBeenCalled();
    expect(await f.controller.heavyStatus(key)).toEqual([{ kind: 'build', state: 'queued', position: 1 }]);
    expect(await f.controller.lease(key)).toBe(true);
    await f.controller.stop(other, { ownerId: 'owner', sessionId: b.sessionId, generation: 1 });
    await f.controller.reconcile(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect((await f.state())?.runtime.phase).toBe('DORMANT');
    expect(await f.controller.heavyStatus(key)).toEqual([]);
  });
  it('should wake a BUILD_QUEUED binding back to LIVE and drop its build ticket', async () => {
    const f = fixture({ capacity: 2, budgetMiB: 1706 }); await f.controller.start(key); const b = await f.controller.start(other);
    f.advance(900_001); await f.controller.activity(other, b.sessionId, 'read', owner); await f.controller.reap(key);
    await expect(f.controller.wake(key)).resolves.toMatchObject({ phase: 'LIVE', appliedRevision: 'r1' });
    expect(await f.controller.heavyStatus(key)).toEqual([]); expect(f.ports.worker.build).not.toHaveBeenCalled();
    expect((await f.queue.status('d2-4-a')).lives).toHaveLength(2);
  });
});

describe('live liveness lease (A-LIVE Amendment 1 §3)', () => {
  it('should send one fenced frame for a leased pod and none for a dormant runtime', async () => {
    const f = fixture(); expect(await f.controller.lease(key)).toBe(false);
    const live = await f.controller.start(key);
    expect(await f.controller.lease(key)).toBe(true);
    expect(f.ports.worker.renew).toHaveBeenCalledWith(expect.objectContaining({ sessionId: live.sessionId,
      leaseEpoch: live.leaseEpoch, routeEpoch: live.routeEpoch, podUid: live.podUid }));
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    expect(await f.controller.lease(key)).toBe(false); expect(f.ports.worker.renew).toHaveBeenCalledOnce();
  });
  it('should never extend idle time with lease frames', async () => {
    const f = fixture(); await f.controller.start(key);
    for (let elapsed = 0; elapsed <= 900_000; elapsed += 30_000) { await f.controller.lease(key); f.advance(30_000); }
    await f.controller.reap(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('should list only runtimes that are not DORMANT', async () => {
    const f = fixture({ capacity: 2 }); await f.controller.start(key); const b = await f.controller.start(other);
    expect(await f.controller.active()).toEqual([{ key, ownerId: 'owner', phase: 'LIVE' },
      { key: other, ownerId: 'owner', phase: 'LIVE' }]);
    await f.controller.stop(other, { ownerId: 'owner', sessionId: b.sessionId, generation: 1 });
    expect(await f.controller.active()).toEqual([{ key, ownerId: 'owner', phase: 'LIVE' }]);
  });
});
