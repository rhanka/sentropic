/**
 * G2 — MCP sharing tools, error-ordering acceptance (converged-r2 §2.3
 * ordering, §4 row G2): §2.3 order (2) visibility before resolution, the
 * single merged `person_not_shareable` 422 at step (4), idempotent replay
 * across a policyRevision change, the admin management visibility exception,
 * the reader's restricted list_access view, and capability_unavailable
 * without a PrincipalDirectoryPort.
 */
import { describe, expect, it } from 'vitest';
import type { SharingPolicyPort } from '../src/server/ports.js';
import { G2_SCOPE, expectNoInternalLeak, g2WorldWith } from './fixtures/share-g2-world.js';

describe('G2 MCP sharing tools — error ordering', () => {
  it('masks a non-reader forged userRef as not_found — no resolution leaks before visibility (§2.3 order (2))', async () => {
    const g2 = await g2WorldWith({ actorIsAdmin: (id) => id === 'idp-sub-admin' });
    const forged = await g2.setAccess({ action: 'grant', principalId: 'ref-forged', grant: 'read', idempotencyKey: 'leak-1' }, 'idp-sub-bob');
    expect(forged.status).toBe(404);
    expect(forged.body).toEqual({ error: 'not_found' });
    const missing = await g2.world.app.handle({ method: 'POST', path: '/set_access',
      body: { artifactId: '00000000-0000-4000-8000-000000000099', action: 'grant', principalId: 'ref-forged',
        grant: 'read', idempotencyKey: 'leak-2' }, actorId: 'idp-sub-bob' }, g2.world.invocation('idp-sub-bob'));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(forged.body);
    // list_access follows the same visibility rule for a non-reader non-admin
    expect((await g2.listAccess('idp-sub-bob')).status).toBe(404);
  });

  it('answers the single person_not_shareable 422 for all four non-shareable causes (owner, step (4))', async () => {
    const g2 = await g2WorldWith();
    const causes: [string, string][] = [
      ['unknown userRef', 'ref-unknown'],
      ['unapproved account', 'ref-peter'],
      ['inactive account', 'ref-bob'],
      ['out-of-scope account', 'ref-oscar'],
    ];
    g2.setApproved('idp-sub-bob', false); // inactive cause
    for (const [label, principalId] of causes) {
      const res = await g2.setAccess({ action: 'grant', principalId, grant: 'read', idempotencyKey: `ns-${label}` });
      expect(res.status, label).toBe(422);
      expect(res.body, label).toEqual({ error: 'person_not_shareable' });
    }
    // revoke of an unresolvable userRef is the same merged error (no probing)
    const revoke = await g2.setAccess({ action: 'revoke', principalId: 'ref-unknown', idempotencyKey: 'ns-revoke' });
    expect(revoke.status).toBe(422);
    expect(revoke.body).toEqual({ error: 'person_not_shareable' });
  });

  it('replays the same key across a policyRevision change without a parasitic 409', async () => {
    let revision = 'sharing-rev-1';
    const sharingPolicy: SharingPolicyPort = { getSharingPolicy: async () => ({ allowPublicSharing: true, policyRevision: revision }) };
    const g2 = await g2WorldWith({ sharingPolicy });
    const args = { action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'replay-1' } as const;
    expect((await g2.setAccess(args)).status).toBe(200);
    revision = 'sharing-rev-2'; // runtime lock flips between the two calls
    const replay = await g2.setAccess(args);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ artifactId: g2.artifactId, changed: true });
    expect(g2.world.accessEvents).toHaveLength(1); // receipt replayed, no duplicate mutation
    const conflict = await g2.setAccess({ action: 'revoke', principalId: 'ref-farid', idempotencyKey: 'replay-1' });
    expect(conflict.status).toBe(409); // same key, different command
  });

  it('lets an approved admin list and revoke someone else\'s restricted artifact without becoming a reader', async () => {
    const g2 = await g2WorldWith({ actorIsAdmin: (id, scope) => id === 'idp-sub-admin' && scope === G2_SCOPE });
    await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'adm-1' });
    const list = await g2.listAccess('idp-sub-admin');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ accessMode: 'restricted', canManage: true });
    expect(list.body.grants).toEqual([{ userRef: 'ref-farid', displayName: 'Farid Colleague',
      emailHint: 'f***@example.com', grant: 'read', createdAt: expect.any(String), effective: true }]);
    expectNoInternalLeak(list.body);
    // the management exception never makes the admin a content reader
    expect((await g2.get('idp-sub-admin')).status).toBe(404);
    const revoke = await g2.setAccess({ action: 'revoke', principalId: 'ref-farid', idempotencyKey: 'adm-2' }, 'idp-sub-admin');
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ changed: true, grants: [] });
    expect((await g2.get('idp-sub-farid')).status).toBe(404);
  });

  it('shows a simple reader only the mode and its own entry in list_access', async () => {
    const g2 = await g2WorldWith();
    await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'rdr-1' });
    await g2.setAccess({ action: 'grant', principalId: 'ref-bob', grant: 'read', idempotencyKey: 'rdr-2' });
    const res = await g2.listAccess('idp-sub-bob');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessMode: 'restricted', canManage: false });
    expect(res.body.grants).toHaveLength(1);
    expect(res.body.grants[0]).toMatchObject({ userRef: 'ref-bob', grant: 'read', effective: true });
    expectNoInternalLeak(res.body);
    // a suspended invitee sees its entry as paused (Q2), not deleted
    g2.setApproved('idp-sub-bob', false);
    const paused = await g2.listAccess('idp-sub-bob');
    expect(paused.status).toBe(200);
    expect(paused.body.grants[0]).toMatchObject({ userRef: 'ref-bob', effective: false, blockedBy: 'account_inactive' });
  });

  it('answers capability_unavailable for the new tools when no PrincipalDirectoryPort is wired', async () => {
    const g2 = await g2WorldWith({ withDirectory: false });
    const lookup = await g2.lookup('idp-sub-alice', { query: 'farid' });
    expect(lookup.status).toBe(503);
    expect(lookup.body).toEqual({ error: 'capability_unavailable' });
    expect((await g2.listAccess('idp-sub-alice')).status).toBe(503);
    // sentinels keep working without the port (G1 behaviour preserved)
    expect((await g2.setAccess({ action: 'grant', principalId: 'sentropic:platform', grant: 'read', idempotencyKey: 'np-1' })).status)
      .toBe(200);
  });
});
