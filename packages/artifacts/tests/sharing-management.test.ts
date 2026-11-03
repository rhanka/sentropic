/**
 * G1 — sharing management end-to-end over the control surface (converged-r2
 * §2.1/§2.2/§2.3 + owner answers). `artifacts_set_access` keeps its frozen
 * input schema; the server semantics widen through the `sentropic:` sentinel
 * principals. Existing tool definitions are untouched (asserted by the parity
 * suites); only the receipt gains fields.
 */
import { describe, expect, it } from 'vitest';
import { RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../src/profile/index.js';
import type { SharingPolicyPort } from '../src/server/ports.js';
import { createTransportWorld } from './fixtures/transport-world.js';

const parityProfile = (allowPublicSharing?: boolean): ArtifactProviderProfile => ({
  ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'],
  operations: [...RADAR_ARTIFACTS_PROFILE.operations,
    { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
  rules: allowPublicSharing === undefined ? RADAR_ARTIFACTS_PROFILE.rules
    : { ...RADAR_ARTIFACTS_PROFILE.rules, allowPublicSharing },
});

const openPolicy: SharingPolicyPort = {
  getSharingPolicy: async () => ({ allowPublicSharing: true, policyRevision: 'sharing-rev-1' }),
};

async function worldWith(opts: {
  allowPublicSharing?: boolean; sharingPolicy?: SharingPolicyPort;
  actorIsAdmin?: (actorId: string, storageScopeId: string) => boolean | Promise<boolean>;
} = {}) {
  const world = createTransportWorld(['alice', 'bob', 'carol', 'admin-1'], 'scope-g1', {
    profile: parityProfile(opts.allowPublicSharing), sharingPolicy: opts.sharingPolicy,
    actorIsAdmin: opts.actorIsAdmin,
  });
  const ensured = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
  if (!ensured.ok) throw new Error('ensure failed');
  const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
  const setAccess = (args: Record<string, unknown>, actor = 'alice') => world.app.handle({
    method: 'POST', path: '/set_access',
    body: { artifactId, ...args }, actorId: actor,
  }, world.invocation(actor));
  const get = (actor: string) => world.app.handle({
    method: 'GET', path: `/meta/${artifactId}`, body: undefined, actorId: actor,
  }, world.invocation(actor));
  return { world, artifactId, setAccess, get };
}

describe('G1 sharing management', () => {
  it('grants a nominative read (view-only default) and audits the event', async () => {
    const { world, artifactId, setAccess } = await worldWith();
    const res = await setAccess({ action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: 's1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ artifactId, accessMode: 'restricted', changed: true,
      grants: [{ principalId: 'bob', grant: 'read' }] });
    expect(res.body).not.toHaveProperty('isPublic');
    // replay of the same key/command replays the receipt without a new event
    const replay = await setAccess({ action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: 's1' });
    expect(replay.status).toBe(200);
    expect(world.accessEvents).toHaveLength(1);
    expect(world.accessEvents[0]).toMatchObject({ actorId: 'alice', action: 'grant', audience: 'user',
      principalId: 'bob', policyRevision: expect.any(String) });
    // a different command under the same key conflicts
    const conflict = await setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 's1' });
    expect(conflict.status).toBe(409);
  });

  it('transitions restricted → platform and opens reads to approved accounts only', async () => {
    const { world, artifactId, setAccess, get } = await worldWith();
    expect((await get('carol')).status).toBe(404);
    const res = await setAccess({ action: 'grant', principalId: 'sentropic:platform', grant: 'read', idempotencyKey: 's2' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessMode: 'platform', changed: true });
    expect((await get('carol')).status).toBe(200);
    // unapproved account is refused (masked as not_found)
    world.setAccountApproved('carol', false);
    expect((await get('carol')).status).toBe(404);
    // Q2: automatic resume once approved again, grant kept meanwhile
    world.setAccountApproved('carol', true);
    expect((await get('carol')).status).toBe(200);
    // platform mode never carries source
    const src = await world.app.handle({ method: 'POST', path: '/get_source',
      body: { artifactId, releaseId: '00000000-0000-4000-8000-000000000000', paths: ['index.html'] },
      actorId: 'carol' }, world.invocation('carol'));
    expect([403, 404]).toContain(src.status);
    expect(world.accessEvents.at(-1)).toMatchObject({ action: 'grant', audience: 'platform', principalId: null });
  });

  it('refuses the public mode while either lock is closed, accepts it with both open', async () => {
    // both locks closed (default): profile key absent + no port
    const closed = await worldWith();
    const denied = await closed.setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'p1' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: 'public_sharing_disabled' });
    expect((await closed.world.acls.getArtifactAcl(closed.artifactId))?.accessMode ?? 'restricted').toBe('restricted');

    // runtime port open but profile capability closed
    const portOnly = await worldWith({ sharingPolicy: openPolicy });
    expect((await portOnly.setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'p1' })).status)
      .toBe(403);

    // profile capability open but runtime port absent
    const profileOnly = await worldWith({ allowPublicSharing: true });
    expect((await profileOnly.setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'p1' })).status)
      .toBe(403);

    // both locks open
    const open = await worldWith({ allowPublicSharing: true, sharingPolicy: openPolicy });
    const res = await open.setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessMode: 'public', changed: true, policyRevision: 'sharing-rev-1' });
    expect(open.world.accessEvents.at(-1)).toMatchObject({ action: 'grant', audience: 'public', principalId: null,
      policyRevision: 'sharing-rev-1' });
  });

  it('applies the admin reduce-only matrix, including the unique public→platform degradation', async () => {
    const actorIsAdmin = (id: string) => id === 'admin-1';
    const { world, artifactId, setAccess, get } = await worldWith({
      allowPublicSharing: true, sharingPolicy: openPolicy, actorIsAdmin,
    });
    // owner opens public, invites bob
    expect((await setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'a1' })).status).toBe(200);
    expect((await setAccess({ action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: 'a2' })).status).toBe(200);
    // admin can revoke a nominative grant on someone else's artifact
    expect((await setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 'a3' }, 'admin-1')).status).toBe(200);
    // admin cannot place a nominative grant nor widen to public
    expect((await setAccess({ action: 'grant', principalId: 'carol', grant: 'read', idempotencyKey: 'a4' }, 'admin-1')).status).toBe(403);
    expect((await setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'a5' }, 'admin-1')).status).toBe(403);
    // the unique admin grant: degradation public → platform
    const degrade = await setAccess({ action: 'grant', principalId: 'sentropic:platform', grant: 'read', idempotencyKey: 'a6' }, 'admin-1');
    expect(degrade.status).toBe(200);
    expect(degrade.body).toMatchObject({ accessMode: 'platform', changed: true });
    // revoke platform on a public artifact is a no-op (changed:false) — reopen public first
    expect((await setAccess({ action: 'grant', principalId: 'sentropic:public', grant: 'read', idempotencyKey: 'a7' })).status).toBe(200);
    const noop = await setAccess({ action: 'revoke', principalId: 'sentropic:platform', idempotencyKey: 'a8' }, 'admin-1');
    expect(noop.status).toBe(200);
    expect(noop.body).toMatchObject({ accessMode: 'public', changed: false });
    // admin can close public → restricted
    const close = await setAccess({ action: 'revoke', principalId: 'sentropic:public', idempotencyKey: 'a9' }, 'admin-1');
    expect(close.status).toBe(200);
    expect(close.body).toMatchObject({ accessMode: 'restricted', changed: true });
    // admin does not become a reader of the content
    expect((await get('admin-1')).status).toBe(404);
    expect((await world.acls.getArtifactAcl(artifactId))?.grants).toEqual([]);
  });

  it('masks non-reader non-admin management and unknown artifacts as not_found', async () => {
    const { setAccess } = await worldWith({ actorIsAdmin: (id) => id === 'admin-1' });
    // §2.3 order (2): bob is neither a reader nor an approved admin of the
    // scope — the artifact's existence must not leak (404, not 403)
    expect((await setAccess({ action: 'grant', principalId: 'carol', grant: 'read', idempotencyKey: 'x1' }, 'bob')).status)
      .toBe(404);
    const missing = await worldWith();
    const res = await missing.world.app.handle({ method: 'POST', path: '/set_access',
      body: { artifactId: '00000000-0000-4000-8000-000000000099', action: 'grant', principalId: 'bob',
        grant: 'read', idempotencyKey: 'x2' }, actorId: 'alice' }, missing.world.invocation());
    expect(res.status).toBe(404);
  });

  it('closes the 403/404 existence oracle on set_access for every non-approved-admin actor (§2.3 order (2))', async () => {
    // admin predicate wired but scoped to ANOTHER storageScopeId: admin-1 is
    // admin there, not here — existence stays masked in this scope
    const otherScope = await worldWith({ actorIsAdmin: (id, scope) => id === 'admin-1' && scope === 'scope-other' });
    expect((await otherScope.setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 'o1' }, 'admin-1')).status)
      .toBe(404);
    // non-reader non-admin in scope while the predicate is wired: 404
    const wired = await worldWith({ actorIsAdmin: (id) => id === 'admin-1' });
    const existing = await wired.setAccess({ action: 'grant', principalId: 'carol', grant: 'read', idempotencyKey: 'n1' }, 'bob');
    expect(existing.status).toBe(404);
    const unknown = await wired.world.app.handle({ method: 'POST', path: '/set_access',
      body: { artifactId: '00000000-0000-4000-8000-000000000099', action: 'grant', principalId: 'carol',
        grant: 'read', idempotencyKey: 'n2' }, actorId: 'bob' }, wired.world.invocation('bob'));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(existing.body);
    // unapproved admin of the SAME scope: still masked (approved admin required)
    const unapproved = await worldWith({ actorIsAdmin: (id) => id === 'admin-1' });
    unapproved.world.setAccountApproved('admin-1', false);
    expect((await unapproved.setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 'u1' }, 'admin-1')).status)
      .toBe(404);
    // approved admin of the SAME scope: visible — the management right is then
    // decided inside the transaction (revoke of an absent grant = 200 no-op,
    // nominative grant = 403 access_denied, never 404)
    const sameScope = await worldWith({ actorIsAdmin: (id, scope) => id === 'admin-1' && scope === 'scope-g1' });
    const revoke = await sameScope.setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 's1' }, 'admin-1');
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ changed: false });
    expect((await sameScope.setAccess({ action: 'grant', principalId: 'carol', grant: 'read', idempotencyKey: 's2' }, 'admin-1')).status)
      .toBe(403);
  });

  it('treats revoke of an absent grant as a no-op success', async () => {
    const { setAccess } = await worldWith();
    const res = await setAccess({ action: 'revoke', principalId: 'bob', idempotencyKey: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: false, grants: [] });
  });

  it('cuts a suspended invite at the next read and resumes it automatically (Q2)', async () => {
    const { world, setAccess, get } = await worldWith();
    expect((await setAccess({ action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: 'q1' })).status).toBe(200);
    expect((await get('bob')).status).toBe(200);
    world.setAccountApproved('bob', false);
    expect((await get('bob')).status).toBe(404);
    // the grant row is kept (paused, not deleted)
    expect((await world.acls.getArtifactAcl((await world.acls.listArtifactIds())[0]!))?.grants)
      .toEqual([{ principalId: 'bob', grant: 'read' }]);
    world.setAccountApproved('bob', true);
    expect((await get('bob')).status).toBe(200);
  });
});
