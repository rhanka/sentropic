import { describe, expect, it } from 'vitest';
import { fixture, key } from './fixture';

describe('live invitation route fencing', () => {
  it('should record the invitation epoch when the session starts', async () => {
    const f = fixture(); f.invitation.epoch = 3; f.invitation.expiresAt = 5000;
    const live = await f.controller.start(key);
    expect(live).toMatchObject({ invitationEpoch: 3, invitationExpiresAt: 5000 });
  });
  it('should do nothing while the invitation epoch and expiry are unchanged', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.events.length = 0;
    await f.controller.reconcile(key);
    expect(f.events).not.toContain('revoke');
    expect((await f.state())?.runtime.routeEpoch).toBe(live.routeEpoch);
  });
  it('should bump the route epoch and reopen the route when an invitation is revoked', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.events.length = 0;
    f.invitation.epoch = 1; await f.controller.reconcile(key);
    const runtime = (await f.state())!.runtime;
    expect(runtime).toMatchObject({ phase: 'LIVE', invitationEpoch: 1, routeEpoch: live.routeEpoch + 1 });
    expect(f.events.slice(0, 2)).toEqual(['revoke', 'ready']);
  });
  it('should fence at expiry and adopt the next expiry', async () => {
    const f = fixture(); f.invitation.expiresAt = 1000; const live = await f.controller.start(key);
    f.advance(999); await f.controller.reconcile(key);
    expect((await f.state())!.runtime.routeEpoch).toBe(live.routeEpoch);
    f.advance(1); f.invitation.expiresAt = null; await f.controller.reconcile(key);
    expect((await f.state())!.runtime).toMatchObject({ routeEpoch: live.routeEpoch + 1, invitationExpiresAt: null });
  });
  it('should adopt a later expiry at the same epoch without fencing when another invitation is still active', async () => {
    const f = fixture(); f.invitation.expiresAt = 1000; const live = await f.controller.start(key); f.events.length = 0;
    f.invitation.expiresAt = 5000; f.advance(1000); await f.controller.reconcile(key);
    expect((await f.state())!.runtime).toMatchObject({ routeEpoch: live.routeEpoch, invitationExpiresAt: 5000 });
    expect(f.events).not.toContain('revoke');
  });
  it('should fence once when the last expiry lapsed even if the host still reports it', async () => {
    const f = fixture(); f.invitation.expiresAt = 1000; const live = await f.controller.start(key);
    f.advance(1000); await f.controller.reconcile(key); await f.controller.reconcile(key);
    expect((await f.state())!.runtime).toMatchObject({ routeEpoch: live.routeEpoch + 1, invitationExpiresAt: null });
  });
  it('should require the worker to confirm the new route epoch before the route reopens', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.invitation.epoch = 1; f.events.length = 0;
    (f.ports.worker.live as any).mockImplementationOnce(async () => ({ revision: 'r1', routeEpoch: live.routeEpoch }));
    await expect(f.controller.reconcile(key)).resolves.toBeUndefined();
    expect(f.events).not.toContain('ready');
    expect((await f.state())!.runtime.phase).not.toBe('LIVE');
  });
});
describe('live admission in the controller', () => {
  it('should refuse a second binding with builder_unavailable and free the slot after teardown', async () => {
    const f = fixture(); await f.controller.start(key);
    const other = { storageScopeId: 'scope-a', artifactId: 'artifact-b' };
    await expect(f.controller.start(other)).rejects.toMatchObject({ code: 'builder_unavailable' });
    await f.controller.reap(key); // not yet past lifetime
    f.advance(3_900_001); await f.controller.reap(key);
    expect((await f.state())!.runtime.phase).toBe('DORMANT');
    await expect(f.admission.acquire(other, 'owner')).resolves.toBeUndefined();
  });
});
