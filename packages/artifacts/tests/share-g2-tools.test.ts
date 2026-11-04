/**
 * G2 — MCP sharing tools, happy-path acceptance (converged-r2 §2.3/§2.4/§2.5,
 * §4 row G2 acceptance column + owner answers): frozen definitions, the
 * end-to-end "share with Farid" journey, payload projection, the
 * approved-caller lookup guard, homonyms and the "everyone" sentinel.
 * Error-ordering cases live in share-g2-errors.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile } from '../src/profile/index.js';
import { ARTIFACTS_TOOL_DEFINITIONS, ARTIFACTS_TOOL_NAMES, createArtifactsManifest } from '../src/mcp-core.js';
import { G2_SCOPE, expectNoInternalLeak, g2Profile, g2WorldWith } from './fixtures/share-g2-world.js';

describe('G2 MCP sharing tools', () => {
  it('keeps every pre-existing tool definition byte-identical across a profileRevisionId bump', () => {
    const base = compileArtifactsProfile(g2Profile());
    const bumped = compileArtifactsProfile({ ...g2Profile(), profileRevisionId: 'immo-artifacts.v9',
      resultEnvelopeVersion: 2, requireExpectedCurrentReleaseId: true });
    const preexisting = ARTIFACTS_TOOL_NAMES.filter((name) => name !== 'artifacts_lookup_people' && name !== 'artifacts_list_access');
    const baseByName = new Map(createArtifactsManifest({ profile: base }).tools.map((tool) => [tool.name, tool]));
    const bumpedByName = new Map(createArtifactsManifest({ profile: bumped }).tools.map((tool) => [tool.name, tool]));
    for (const name of preexisting) {
      expect(JSON.stringify(baseByName.get(name))).toBe(JSON.stringify(bumpedByName.get(name)));
      expect(ARTIFACTS_TOOL_DEFINITIONS[name].description).not.toContain('immo-artifacts');
    }
    // the two new tools are published with static definitions as well
    expect(baseByName.has('artifacts_lookup_people')).toBe(true);
    expect(baseByName.has('artifacts_list_access')).toBe(true);
    expect(JSON.stringify(baseByName.get('artifacts_lookup_people')))
      .toBe(JSON.stringify(bumpedByName.get('artifacts_lookup_people')));
  });

  it('runs the end-to-end "share with Farid" journey: lookup → userRef → grant → read → revoke → refused', async () => {
    const g2 = await g2WorldWith();
    const lookup = await g2.lookup('idp-sub-alice', { query: 'farid' });
    expect(lookup.status).toBe(200);
    expect(lookup.body.matches).toHaveLength(2); // homonyms are never silently resolved
    const farid = lookup.body.matches.find((m: any) => m.displayName === 'Farid Colleague');
    expect(farid).toMatchObject({ userRef: 'ref-farid', displayName: 'Farid Colleague', emailHint: 'f***@example.com' });
    expectNoInternalLeak(lookup.body);

    const grant = await g2.setAccess({ action: 'grant', principalId: farid.userRef, grant: 'read', idempotencyKey: 'share-1' });
    expect(grant.status).toBe(200);
    expect(grant.body).toMatchObject({ artifactId: g2.artifactId, accessMode: 'restricted', changed: true });
    expect(grant.body.grants).toEqual([{ principalId: 'ref-farid', grant: 'read', createdAt: expect.any(String) }]);
    expectNoInternalLeak(grant.body);

    // the invited colleague reads; the owner payload projects ownerId + grants
    expect((await g2.get('idp-sub-farid')).status).toBe(200);
    const ownerGet = await g2.get('idp-sub-alice');
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.ownerId).toBe('ref-alice');
    expect(ownerGet.body.grants[0].principalId).toBe('ref-farid');
    expectNoInternalLeak(ownerGet.body);

    const revoke = await g2.setAccess({ action: 'revoke', principalId: 'ref-farid', idempotencyKey: 'share-2' });
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ changed: true, grants: [] });
    expect((await g2.get('idp-sub-farid')).status).toBe(404); // cut at the next read
  });

  it('captures every model payload (get, list, set_access receipt, list_access, lookup_people) without internal ids or full emails', async () => {
    const g2 = await g2WorldWith();
    await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'cap-1' });
    await g2.setAccess({ action: 'grant', principalId: 'sentropic:platform', grant: 'read', idempotencyKey: 'cap-2' });
    const receipt = await g2.setAccess({ action: 'grant', principalId: 'ref-bob', grant: 'read', idempotencyKey: 'cap-3' });
    const listAccess = await g2.listAccess('idp-sub-alice');
    expect(listAccess.status).toBe(200);
    expect(listAccess.body).toMatchObject({ artifactId: g2.artifactId, accessMode: 'platform',
      owner: { userRef: 'ref-alice', displayName: 'Alice Author' }, canManage: true });
    expect(listAccess.body.grants).toHaveLength(2);
    expect(listAccess.body.grants.map((g: any) => g.userRef).sort()).toEqual(['ref-bob', 'ref-farid']);
    const lookup = await g2.lookup('idp-sub-alice', { query: 'example' });
    expect(lookup.status).toBe(200);
    const payloads = [receipt.body, listAccess.body, lookup.body,
      (await g2.get('idp-sub-alice')).body, (await g2.list('idp-sub-alice')).body,
      (await g2.get('idp-sub-bob')).body];
    for (const payload of payloads) expectNoInternalLeak(payload);
  });

  it('refuses lookup_people to a pending caller without enumerating the directory', async () => {
    const g2 = await g2WorldWith();
    const denied = await g2.lookup('idp-sub-peter', { query: 'example' });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'access_denied' });
    // the directory itself only ever returns approved accounts of the scope
    const matches = await g2.directory.searchPeople(G2_SCOPE, 'example', 10);
    expect(matches.every((m) => !m.email.startsWith('peter@'))).toBe(true);
    expect(matches.some((m) => m.userRef === 'ref-oscar')).toBe(false);
  });

  it('returns homonyms with distinct userRefs and masked emailHints, case-insensitively', async () => {
    const g2 = await g2WorldWith();
    const res = await g2.lookup('idp-sub-alice', { query: 'FARID' });
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(2);
    expect(new Set(res.body.matches.map((m: any) => m.userRef)).size).toBe(2);
    expect(res.body.matches.every((m: any) => m.emailHint === 'f***@example.com')).toBe(true);
    expectNoInternalLeak(res.body);
  });

  it('opens "everyone" (sentinel) to an approved account and refuses a pending one', async () => {
    const g2 = await g2WorldWith();
    const res = await g2.setAccess({ action: 'grant', principalId: 'sentropic:platform', grant: 'read', idempotencyKey: 'plat-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessMode: 'platform', changed: true });
    expect((await g2.get('idp-sub-carol')).status).toBe(200);
    expect((await g2.get('idp-sub-peter')).status).toBe(404); // pending: masked as not_found
  });
});
