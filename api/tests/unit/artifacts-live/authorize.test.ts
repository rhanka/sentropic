import { describe, expect, it } from 'vitest';
import { fixture, key, owner } from './fixture';

const bob = (epoch: number, expiresAt = 900_000) => ({ principalId: 'bob', invitation: { id: 'inv-bob', epoch, expiresAt } });

describe('live authority: the binding owner is the acting user (plan Δ4)', () => {
  it('should grant the binding owner read and write with the route fence for the host assertion', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    for (const access of ['read', 'write'] as const) {
      expect(await f.controller.authorize(key, owner, access)).toEqual({ ...key, sessionId: live.sessionId, generation: 1,
        routeEpoch: live.routeEpoch, podUid: live.podUid, podName: live.podName, sourceRevision: 'r1', principalId: 'owner',
        role: 'binding_owner', invitationId: '', invitationEpoch: 0, invitationExp: 0 });
    }
  });
  it('should refuse another principal, including a platform owner, without an invitation', async () => {
    const f = fixture(); await f.controller.start(key);
    for (const principalId of ['bob', 'platform-owner']) for (const access of ['read', 'write'] as const) {
      await expect(f.controller.authorize(key, { principalId }, access)).rejects.toMatchObject({ code: 'access_denied' });
    }
  });
  it('should let a current invitee read but never write', async () => {
    const f = fixture(); await f.controller.start(key); f.invitation.epoch = 1;
    expect(await f.controller.authorize(key, bob(1), 'read')).toMatchObject({ principalId: 'bob', role: 'invitee',
      invitationId: 'inv-bob', invitationEpoch: 1, invitationExp: 900 });
    await expect(f.controller.authorize(key, bob(1), 'write')).rejects.toMatchObject({ code: 'access_denied' });
  });
  it('should refuse a revoked invitation at once, before the reconcile fences the route', async () => {
    const f = fixture(); await f.controller.start(key); f.invitation.epoch = 2;
    await expect(f.controller.authorize(key, bob(1), 'read')).rejects.toMatchObject({ code: 'access_denied' });
  });
  it('should refuse an expired invitation by server time', async () => {
    const f = fixture(); await f.controller.start(key); f.invitation.epoch = 1; f.advance(1000);
    await expect(f.controller.authorize(key, bob(1, 1000), 'read')).rejects.toMatchObject({ code: 'access_denied' });
  });
  it('should refuse a grant while the session is not live', async () => {
    const f = fixture();
    await expect(f.controller.authorize(key, owner, 'read')).rejects.toMatchObject({ reason: 'stale_session' });
  });
  it('should take edits from the binding owner only and let invited foreground viewing extend the session', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.invitation.epoch = 1; f.advance(600_001);
    await expect(f.controller.activity(key, live.sessionId, 'edit', bob(1, 9_000_000))).rejects.toMatchObject({ code: 'access_denied' });
    await expect(f.controller.activity(key, live.sessionId, 'read', { principalId: 'carol' })).rejects.toMatchObject({ code: 'access_denied' });
    await f.controller.activity(key, live.sessionId, 'foreground', bob(1, 9_000_000));
    await f.controller.idle(key); expect(f.ports.worker.build).not.toHaveBeenCalled();
  });
  it('should queue a second user fairly on a full worker and admit them before a repeat user', async () => {
    const f = fixture(); const other = { ...key, artifactId: 'artifact-bob' }; const again = { ...key, artifactId: 'artifact-owner-2' };
    f.owners.set(`${other.storageScopeId}/${other.artifactId}`, 'bob');
    const live = await f.controller.start(key);
    await expect(f.controller.start(other)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    await expect(f.controller.start(again)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    await expect(f.controller.start(again)).rejects.toMatchObject({ reason: 'queued' });
    await expect(f.controller.start(other)).resolves.toMatchObject({ phase: 'LIVE', ownerId: 'bob' });
  });
});
