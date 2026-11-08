import { expect, it } from 'vitest';
import { invitationWorld } from './fixtures/live-invitation-world.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OTHER_SESSION = '8f14e45f-ceea-467a-9575-21b2a6c3e1d0';
const clock = () => { const c = { now: Date.parse('2026-11-08T07:00:00Z') }; return { c, now: () => c.now }; };
const conflict = (reason: string) => ({ kind: 'git_live_conflict', details: { publicDetails: { reason } } });

it('should let only the binding owner invite a principal holding current code rights', async () => {
  const { c, now } = clock(); const v = invitationWorld({ now });
  const sid = await v.start();
  const body = { liveSessionId: sid, expiresInSeconds: 900, idempotencyKey: 'k' };
  await expect(v.as('bob', 'live_invite', { ...body, userRef: 'ref-carol' })).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.invite(sid, 'alice')).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(v.invite(sid, 'dave')).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.as('alice', 'live_invite', { ...body, userRef: 'nobody' })).rejects.toMatchObject({ kind: 'access_denied' });
  for (const expiresInSeconds of [299, 86401, 900.5]) {
    await expect(v.invite(sid, 'bob', { expiresInSeconds })).rejects.toMatchObject({ kind: 'invalid_request' });
  }
  await expect(v.invite(OTHER_SESSION, 'bob')).rejects.toMatchObject(conflict('stale_session'));
  expect(await v.invite(sid, 'bob')).toEqual({ invitationId: expect.stringMatching(UUID), status: 'pending', liveSessionId: sid,
    bindingGeneration: v.w.binding.generation, epoch: 1, expiresAt: new Date(c.now + 900_000).toISOString(), replayed: false });
  await expect(v.invite(sid, 'bob', { idempotencyKey: 'twice' })).rejects.toMatchObject(conflict('active_session'));
});

it('should accept only by the invitee, before the expiry and within the same live session', async () => {
  const { c, now } = clock(); const v = invitationWorld({ now });
  const sid = await v.start();
  const bob = await v.invite(sid, 'bob'), carol = await v.invite(sid, 'carol', { expiresInSeconds: 300 });
  await expect(v.accept('carol', bob.invitationId)).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.accept('alice', bob.invitationId)).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.accept('bob', OTHER_SESSION)).rejects.toMatchObject({ kind: 'access_denied' });
  expect(await v.accept('bob', bob.invitationId)).toEqual({ invitationId: bob.invitationId, status: 'active',
    liveSessionId: sid, epoch: 1, expiresAt: bob.expiresAt, replayed: false });
  c.now += 301_000;
  await expect(v.accept('carol', carol.invitationId)).rejects.toMatchObject({ kind: 'gone' });
  const erin = await v.invite(sid, 'erin');
  await v.stop(); const next = await v.start();
  expect(next).not.toBe(sid);
  await expect(v.accept('erin', erin.invitationId)).rejects.toMatchObject(conflict('stale_session'));
  const past = await v.list('alice', { liveSessionId: sid });
  expect(past.invitations.map((i: any) => [i.invitee.userRef, i.status]).sort()).toEqual([['ref-bob', 'ceased'],
    ['ref-carol', 'expired'], ['ref-erin', 'ceased']]);
  expect(await v.list('alice')).toMatchObject({ liveSessionId: next, epoch: 0, invitations: [], next: null });
});

it('should bump the session epoch on revocation, let the others adopt it and call onRevoked once after commit', async () => {
  const v = invitationWorld(); const sid = await v.start();
  const bob = await v.invite(sid, 'bob'), carol = await v.invite(sid, 'carol');
  await v.accept('bob', bob.invitationId);
  const seen: unknown[] = [];
  v.onRevoked.mockImplementation(async () => { seen.push(await v.w.service.liveViewer(v.identity, 'carol')); });
  await expect(v.revoke('dave', carol.invitationId)).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.revoke('bob', carol.invitationId)).rejects.toMatchObject({ kind: 'access_denied' });
  expect(await v.revoke('alice', carol.invitationId)).toEqual({ invitationId: carol.invitationId, status: 'revoked',
    epoch: 2, replayed: false });
  expect(v.onRevoked.mock.calls).toEqual([[{ storageScopeId: v.identity.storageScopeId, artifactId: v.identity.artifactId,
    liveSessionId: sid, bindingGeneration: v.identity.bindingGeneration, invitationId: carol.invitationId, epoch: 2 }]]);
  expect(seen).toEqual([null]);
  expect(await v.w.service.liveViewer(v.identity, 'bob')).toEqual({ role: 'invitee',
    invitation: { id: bob.invitationId, epoch: 2, expiresAt: Date.parse(bob.expiresAt) } });
  expect(await v.revoke('alice', carol.invitationId)).toMatchObject({ epoch: 2, replayed: true });
  expect(await v.revoke('alice', carol.invitationId, 'again')).toMatchObject({ status: 'revoked', epoch: 2, replayed: false });
  expect(await v.revoke('bob', bob.invitationId)).toMatchObject({ status: 'revoked', epoch: 3 });
  expect(v.onRevoked).toHaveBeenCalledTimes(2);
  expect(await v.w.service.liveViewer(v.identity, 'bob')).toBeNull();
  expect(await v.w.service.liveInvitationState(v.identity)).toEqual({ epoch: 3, expiresAt: null });
});

it('should project the owner list and the invitee list without principal ids', async () => {
  const { c, now } = clock(); const v = invitationWorld({ now }); const sid = await v.start();
  const bob = await v.invite(sid, 'bob'); c.now += 1000; const carol = await v.invite(sid, 'carol');
  const accepted = await v.accept('bob', bob.invitationId);
  const owner = await v.list('alice');
  expect(owner).toEqual({ liveSessionId: sid, bindingGeneration: v.identity.bindingGeneration, epoch: 1, next: null, invitations: [
    { invitationId: bob.invitationId, invitee: { userRef: 'ref-bob', displayName: 'BOB' }, status: 'active',
      expiresAt: bob.expiresAt, acceptedAt: expect.any(String) },
    { invitationId: carol.invitationId, invitee: { userRef: 'ref-carol', displayName: 'CAROL' }, status: 'pending',
      expiresAt: carol.expiresAt, acceptedAt: null }] });
  expect(accepted.status).toBe('active');
  expect(await v.list('bob')).toMatchObject({ liveSessionId: sid, invitations: [{ invitationId: bob.invitationId }] });
  expect((await v.list('carol')).invitations).toHaveLength(1);
  await expect(v.list('dave')).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(v.list('alice', { cursor: 'not-a-cursor' })).rejects.toMatchObject({ kind: 'invalid_request' });
  const wire = JSON.stringify([owner, await v.list('bob')]);
  for (const principal of ['"bob"', '"carol"', '"alice"', 'principalId']) expect(wire).not.toContain(principal);
});

it('should export the session epoch, the latest active expiry and the live viewer', async () => {
  const v = invitationWorld(); const views = v.w.service;
  expect(await views.liveInvitationState(v.identity)).toEqual({ epoch: 0, expiresAt: null });
  expect(await views.liveViewer(v.identity, 'alice')).toBeNull();
  const sid = await v.start();
  expect(await views.liveViewer(v.identity, 'alice')).toEqual({ role: 'binding_owner' });
  const bob = await v.invite(sid, 'bob', { expiresInSeconds: 3600 }), carol = await v.invite(sid, 'carol');
  expect(await views.liveInvitationState(v.identity)).toEqual({ epoch: 1, expiresAt: null });
  expect(await views.liveViewer(v.identity, 'carol')).toBeNull();
  await v.accept('carol', carol.invitationId);
  expect(await views.liveInvitationState(v.identity)).toEqual({ epoch: 1, expiresAt: Date.parse(carol.expiresAt) });
  await v.accept('bob', bob.invitationId);
  expect(await views.liveInvitationState(v.identity)).toEqual({ epoch: 1, expiresAt: Date.parse(bob.expiresAt) });
  expect(await views.liveViewer(v.identity, 'dave')).toBeNull();
  await v.stop();
  expect(await views.liveViewer(v.identity, 'bob')).toBeNull();
});

it('should refuse the 17th open invitation and every invitation tool when invitations are not qualified', async () => {
  const v = invitationWorld(); const sid = await v.start();
  for (let i = 1; i <= 16; i++) await v.invite(sid, 'u' + i);
  await expect(v.invite(sid, 'u17')).rejects.toMatchObject({ kind: 'limit_exceeded' });
  const off = invitationWorld({ qualified: false }); const offSid = await off.start();
  const id = '11111111-1111-4111-8111-111111111111';
  for (const call of [() => off.invite(offSid, 'bob'), () => off.accept('bob', id), () => off.revoke('alice', id),
    () => off.list('alice')]) {
    await expect(call()).rejects.toMatchObject({ kind: 'builder_unavailable' });
  }
  expect(await off.w.service.liveInvitationState(off.identity)).toEqual({ epoch: 0, expiresAt: null });
  expect(await off.w.service.liveViewer(off.identity, 'alice')).toEqual({ role: 'binding_owner' });
});

it('should replay idempotent transitions and refuse a reused key with other arguments', async () => {
  const v = invitationWorld(); const sid = await v.start();
  const first = await v.invite(sid, 'bob');
  expect(await v.invite(sid, 'bob')).toEqual({ ...first, replayed: true });
  await expect(v.invite(sid, 'bob', { expiresInSeconds: 600 })).rejects.toMatchObject({ kind: 'command_conflict' });
  const accepted = await v.accept('bob', first.invitationId, 'acc');
  expect(await v.accept('bob', first.invitationId, 'acc')).toEqual({ ...accepted, replayed: true });
  await expect(v.accept('bob', first.invitationId, 'acc-2')).rejects.toMatchObject(conflict('active_session'));
});
