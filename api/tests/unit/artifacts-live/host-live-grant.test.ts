import { describe, expect, it } from 'vitest';
import { key } from './fixture';
import { grant, invitee, reconcile, session, setup } from './host-live-harness';

describe('host live API: session invitation state (§9)', () => {
  it('refuses a session invitation epoch lower than the stored one with 409 stale_invitation', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile({ invitation: session(2) }));
    for (const [path, body] of [['grant', grant({ principalId: 'owner' }, session(1))], ['reconcile', reconcile()]] as const) {
      const response = await s.call(path, body);
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'git_live_conflict', reason: 'stale_invitation' });
    }
    expect((await s.f.state())!.runtime).toMatchObject({ phase: 'LIVE', invitationEpoch: 2 });
  });
  it('keeps the route when the owner or an invitee grant carries the same epoch', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    const before = await s.routeEpoch(); s.f.events.length = 0;
    expect((await s.call('grant', grant({ principalId: 'owner' }))).status).toBe(200);
    const bob = await s.call('grant', grant(invitee('bob', 1, 9_000), session(1, 9_000)));
    expect((await bob.json()).grant).toMatchObject({ role: 'invitee', invitationEpoch: 1, routeEpoch: before });
    expect((await s.call('grant', grant({ principalId: 'owner' }, session(1, 9_000)))).status).toBe(200);
    expect(await (await s.call('reconcile', reconcile({ invitation: session(1, 9_000) }))).json()).toMatchObject({ ready: true });
    expect(s.f.events).not.toContain('revoke');
    expect((await s.f.state())!.runtime).toMatchObject({ routeEpoch: before, invitationEpoch: 1, invitationExpiresAt: 9_000 });
  });
  it('grants two active invitees at one epoch; a revocation re-issues the other at the next epoch and refuses the old', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    const bob = (await (await s.call('grant', grant(invitee('bob', 1, 8_000), session(1, 8_000)))).json()).grant;
    const carol = (await (await s.call('grant', grant(invitee('carol', 1, 9_000), session(1, 9_000)))).json()).grant;
    expect([bob.principalId, bob.invitationEpoch, carol.principalId, carol.invitationEpoch]).toEqual(['bob', 1, 'carol', 1]);
    expect(carol.routeEpoch).toBe(bob.routeEpoch); s.f.events.length = 0;
    // The host revokes bob: the shared epoch moves to 2, carol is re-issued at 2 and every reader reconnects.
    const reissued = await s.call('grant', grant(invitee('carol', 2, 9_000), session(2, 9_000)));
    expect(reissued.status).toBe(200);
    expect((await reissued.json()).grant).toMatchObject({ principalId: 'carol', invitationEpoch: 2, routeEpoch: bob.routeEpoch + 1 });
    expect(s.f.events).toEqual(expect.arrayContaining(['revoke', 'ready']));
    for (const actor of [invitee('bob', 1, 8_000), invitee('carol', 1, 9_000)]) {
      const old = await s.call('grant', grant(actor, session(2, 9_000)));
      expect(old.status).toBe(403); expect(await old.json()).toEqual({ error: 'access_denied' });
    }
    expect((await s.call('grant', grant(invitee('carol', 1, 9_000), session(1, 9_000)))).status).toBe(409);
    expect((await (await s.call('grant', grant({ principalId: 'owner' }, session(2, 9_000)))).json()).grant)
      .toMatchObject({ role: 'binding_owner', routeEpoch: bob.routeEpoch + 1 });
  });
  it('fences at the next tick only once the last active invitation expired', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    await s.call('grant', grant(invitee('bob', 1, 1_000), session(1, 1_000)));
    await s.call('grant', grant(invitee('carol', 1, 5_000), session(1, 5_000)));
    const before = await s.routeEpoch(); s.f.events.length = 0;
    s.f.advance(1_000); await s.controller.reconcile(key);
    expect((await s.f.state())!.runtime).toMatchObject({ phase: 'LIVE', routeEpoch: before, invitationExpiresAt: 5_000 });
    expect((await s.call('grant', grant(invitee('bob', 1, 1_000), session(1, 5_000)))).status).toBe(403);
    expect((await s.call('grant', grant(invitee('carol', 1, 5_000), session(1, 5_000)))).status).toBe(200);
    expect(s.f.events).not.toContain('revoke');
    s.f.advance(4_000); await s.controller.reconcile(key);
    expect((await s.f.state())!.runtime).toMatchObject({ phase: 'LIVE', routeEpoch: before + 1, invitationExpiresAt: null });
    expect(s.f.events).toEqual(expect.arrayContaining(['revoke', 'ready']));
    await s.controller.reconcile(key);
    expect(await s.routeEpoch()).toBe(before + 1);
  });
});
