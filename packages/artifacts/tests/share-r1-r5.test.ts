/**
 * R1/R5 — review 1002 findings on the G2 sharing surface.
 *
 * R1: a missing directory entry must never leak the raw internal id (`sub`).
 * Every model-visible projection emits the opaque `UNKNOWN_USER_REF` instead.
 * R5: revoking a dormant (suspended or deleted) principal's grant is the
 * expected cleanup step and must stay allowed; granting still requires an
 * approved principal.
 */
import { describe, expect, it } from 'vitest';
import { UNKNOWN_USER_REF } from '../src/server/ports.js';
import { G2_SCOPE, G2_ACCOUNTS, expectNoInternalLeak, g2Profile, g2WorldWith } from './fixtures/share-g2-world.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { createMemoryDirectory } from './fixtures/memory-directory.js';

const profileWithVersions = (envelope: 1 | 2 = 1) => ({
  ...g2Profile(),
  ...(envelope === 2 ? { profileRevisionId: 'immo-artifacts.r1b', resultEnvelopeVersion: 2 as const,
    requireExpectedCurrentReleaseId: true as const } : {}),
  selectedCapabilities: [...g2Profile().selectedCapabilities,
    'artifacts_list_versions', 'artifacts_revert', 'artifacts_get_source'],
});

async function versionsWorld(envelope: 1 | 2 = 1) {
  const directory = createMemoryDirectory(G2_SCOPE, G2_ACCOUNTS);
  const world = createTransportWorld(
    G2_ACCOUNTS.map((account) => account.internalId),
    G2_SCOPE,
    { profile: profileWithVersions(envelope) as unknown as Parameters<typeof createTransportWorld>[2]['profile'], directory },
  );
  const ensured = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
  if (!ensured.ok) throw new Error('ensure failed');
  const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
  for (const account of G2_ACCOUNTS) {
    if (account.approved === false) world.setAccountApproved(account.internalId, false);
  }
  const call = (method: string, path: string, body: unknown, actor: string) => world.app.handle({
    method, path, body, actorId: actor,
  }, world.invocation(actor));
  const publish = (actor: string, key: string) => world.mcp.invoke({ tool: 'artifacts_publish',
    invocation: world.invocation(actor),
    args: { artifactId, idempotencyKey: key,
      ...(envelope === 2 ? { expectedCurrentReleaseId: null } : {}),
      files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>hello</h1>' }] } });
  return {
    world, directory, artifactId,
    setAccess: (args: Record<string, unknown>, actor = 'idp-sub-alice') => call('POST', '/set_access',
      { artifactId, ...args }, actor),
    listAccess: (actor: string) => call('POST', '/list_access', { artifactId }, actor),
    get: (actor: string) => call('GET', `/meta/${artifactId}`, undefined, actor),
    list: (actor: string) => call('POST', '/list', {}, actor),
    versions: (actor: string) => call('GET', `/versions/${artifactId}`, undefined, actor),
    publish,
    setApproved: (internalId: string, value: boolean) => {
      world.setAccountApproved(internalId, value);
      directory.setApproved(internalId, value);
    },
  };
}

describe('R1 — no raw internal id in any output', () => {
  it('projects a deleted grant holder to unknown on get, list_access and the set_access receipt', async () => {
    const g2 = await g2WorldWith();
    expect((await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r1-1' })).status)
      .toBe(200);
    expect((await g2.setAccess({ action: 'grant', principalId: 'ref-bob', grant: 'read', idempotencyKey: 'r1-2' })).status)
      .toBe(200);
    g2.directory.deletePrincipal('idp-sub-farid');

    const get = await g2.get('idp-sub-alice');
    expect(get.status).toBe(200);
    expect(get.body.ownerId).toBe('ref-alice');
    const grantRefs = (get.body.grants as { principalId: string }[]).map((grant) => grant.principalId).sort();
    expect(grantRefs).toEqual([UNKNOWN_USER_REF, 'ref-bob'].sort());
    expectNoInternalLeak(get.body);

    const listAccess = await g2.listAccess('idp-sub-alice');
    expect(listAccess.status).toBe(200);
    expect(listAccess.body.owner).toMatchObject({ userRef: 'ref-alice' });
    expect(listAccess.body.grants.map((grant: { userRef: string }) => grant.userRef).sort())
      .toEqual([UNKNOWN_USER_REF, 'ref-bob'].sort());
    const unknownGrant = listAccess.body.grants.find((grant: { userRef: string }) => grant.userRef === UNKNOWN_USER_REF);
    expect(unknownGrant.displayName).toBe(UNKNOWN_USER_REF);
    expect(unknownGrant).not.toHaveProperty('emailHint');
    expectNoInternalLeak(listAccess.body);

    const receipt = await g2.setAccess({ action: 'grant', principalId: 'ref-carol', grant: 'read', idempotencyKey: 'r1-3' });
    expect(receipt.status).toBe(200);
    expect(receipt.body.grants.map((grant: { principalId: string }) => grant.principalId).sort())
      .toEqual([UNKNOWN_USER_REF, 'ref-bob', 'ref-carol'].sort());
    expectNoInternalLeak(receipt.body);

    const list = await g2.list('idp-sub-alice');
    expect(list.status).toBe(200);
    expectNoInternalLeak(list.body);
  });

  it('projects a deleted owner to unknown without leaking the sub', async () => {
    const g2 = await g2WorldWith();
    expect((await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r1-own-1' })).status)
      .toBe(200);
    g2.directory.deletePrincipal('idp-sub-alice');

    const get = await g2.get('idp-sub-farid');
    expect(get.status).toBe(200);
    expect(get.body.ownerId).toBe(UNKNOWN_USER_REF);
    expectNoInternalLeak(get.body);

    const listAccess = await g2.listAccess('idp-sub-farid');
    expect(listAccess.status).toBe(200);
    expect(listAccess.body.owner).toMatchObject({ userRef: UNKNOWN_USER_REF, displayName: UNKNOWN_USER_REF });
    expectNoInternalLeak(listAccess.body);
  });

  it('projects a deleted author to unknown in list_versions v1', async () => {
    const v = await versionsWorld();
    expect((await v.publish('idp-sub-alice', 'r1-ver-1')).status).toBe(201);
    expect((await v.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r1-ver-2' })).status)
      .toBe(200);
    v.directory.deletePrincipal('idp-sub-alice');

    const res = await v.versions('idp-sub-farid');
    expect(res.status).toBe(200);
    const releases = (res.body as { releases: { author: unknown }[] }).releases;
    expect(releases).toHaveLength(1);
    expect(releases[0].author).toBe(UNKNOWN_USER_REF);
    expectNoInternalLeak(res.body);
  });

  it('projects a known author to userRef in list_versions v2 without leaking the sub', async () => {
    const v = await versionsWorld(2);
    expect((await v.publish('idp-sub-alice', 'r1b-ver-1')).status).toBe(201);
    expect((await v.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r1b-ver-2' })).status)
      .toBe(200);

    const res = await v.versions('idp-sub-farid');
    expect(res.status).toBe(200);
    // Under the v2 envelope handle() wraps the payload as { ok, output, ... }.
    const output = (res.body as { output: { versions: { authorPrincipalId: unknown }[] } }).output;
    expect(output.versions).toHaveLength(1);
    expect(output.versions[0].authorPrincipalId).toBe('ref-alice');
    expectNoInternalLeak(res.body);
  });

  it('projects a deleted author to unknown in list_versions v2', async () => {
    const v = await versionsWorld(2);
    expect((await v.publish('idp-sub-alice', 'r1b-del-1')).status).toBe(201);
    expect((await v.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r1b-del-2' })).status)
      .toBe(200);
    v.directory.deletePrincipal('idp-sub-alice');

    const res = await v.versions('idp-sub-farid');
    expect(res.status).toBe(200);
    const output = (res.body as { output: { versions: { authorPrincipalId: unknown }[] } }).output;
    expect(output.versions).toHaveLength(1);
    expect(output.versions[0].authorPrincipalId).toBe(UNKNOWN_USER_REF);
    expectNoInternalLeak(res.body);
  });
});

describe('R5 — revoke stays allowed for dormant principals', () => {
  it('revokes the grant of a suspended principal; re-approval does not resume access', async () => {
    const g2 = await g2WorldWith();
    expect((await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r5-1' })).status)
      .toBe(200);
    g2.setApproved('idp-sub-farid', false);

    const revoke = await g2.setAccess({ action: 'revoke', principalId: 'ref-farid', idempotencyKey: 'r5-2' });
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ changed: true, grants: [] });
    expectNoInternalLeak(revoke.body);

    g2.setApproved('idp-sub-farid', true);
    expect((await g2.get('idp-sub-farid')).status).toBe(404);
  });

  it('keeps requiring an approved principal for grant', async () => {
    const g2 = await g2WorldWith();
    g2.setApproved('idp-sub-bob', false);
    const grant = await g2.setAccess({ action: 'grant', principalId: 'ref-bob', grant: 'read', idempotencyKey: 'r5-grant' });
    expect(grant.status).toBe(422);
    expect(grant.body).toEqual({ error: 'person_not_shareable' });
  });

  it('revokes the grant of a deleted principal', async () => {
    const g2 = await g2WorldWith();
    expect((await g2.setAccess({ action: 'grant', principalId: 'ref-farid', grant: 'read', idempotencyKey: 'r5-del-1' })).status)
      .toBe(200);
    g2.directory.deletePrincipal('idp-sub-farid');

    const before = await g2.listAccess('idp-sub-alice');
    expect(before.status).toBe(200);
    expect(before.body.grants.map((grant: { userRef: string }) => grant.userRef)).toEqual([UNKNOWN_USER_REF]);
    expectNoInternalLeak(before.body);

    const revoke = await g2.setAccess({ action: 'revoke', principalId: 'ref-farid', idempotencyKey: 'r5-del-2' });
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ changed: true, grants: [] });
    expectNoInternalLeak(revoke.body);

    const after = await g2.listAccess('idp-sub-alice');
    expect(after.status).toBe(200);
    expect(after.body.grants).toEqual([]);
  });
});

describe('R1c — no raw sub in any receipt or output manifest', () => {
  const manifestOwnerOf = (body: unknown): unknown => {
    const manifest = (body as { manifest?: unknown }).manifest;
    if (typeof manifest !== 'string') return undefined;
    try {
      return (JSON.parse(manifest) as { ownerId?: unknown }).ownerId;
    } catch {
      return undefined;
    }
  };

  it('projects the release manifest ownerId in publish, revert, get_source and conflict outputs', async () => {
    const v = await versionsWorld();
    const seen: unknown[] = [];

    const first = await v.publish('idp-sub-alice', 'r1c-pub-1');
    expect(first.status).toBe(201);
    seen.push(first.body);
    expect(manifestOwnerOf(first.body)).toBe('ref-alice');
    expect((first.body as { digest: string }).digest)
      .toBe((JSON.parse((first.body as { manifest: string }).manifest) as { digest: string }).digest);
    expectNoInternalLeak(first.body);
    const firstReleaseId = (first.body as { releaseId: string }).releaseId;
    const storedFirst = await v.world.state.getRelease(firstReleaseId);
    expect(JSON.parse(storedFirst!.manifest).ownerId).toBe('idp-sub-alice');

    const second = await v.publish('idp-sub-alice', 'r1c-pub-2');
    expect(second.status).toBe(201);
    seen.push(second.body);
    expect(manifestOwnerOf(second.body)).toBe('ref-alice');
    expectNoInternalLeak(second.body);
    const secondReleaseId = (second.body as { releaseId: string }).releaseId;

    const reverted = await v.world.mcp.invoke({ tool: 'artifacts_revert',
      invocation: v.world.invocation('idp-sub-alice'),
      args: { artifactId: v.artifactId, releaseId: firstReleaseId,
        expectedCurrentReleaseId: secondReleaseId, idempotencyKey: 'r1c-revert-1' } });
    expect(reverted.status).toBe(201);
    seen.push(reverted.body);
    expect(manifestOwnerOf(reverted.body)).toBe('ref-alice');
    expectNoInternalLeak(reverted.body);

    const source = await v.world.mcp.invoke({ tool: 'artifacts_get_source',
      invocation: v.world.invocation('idp-sub-alice'), args: { artifactId: v.artifactId } });
    expect(source.status).toBe(200);
    seen.push(source.body);
    expect(manifestOwnerOf(source.body)).toBe('ref-alice');
    expectNoInternalLeak(source.body);

    const listed = await v.versions('idp-sub-alice');
    expect(listed.status).toBe(200);
    seen.push(listed.body);
    expectNoInternalLeak(listed.body);

    const got = await v.get('idp-sub-alice');
    expect(got.status).toBe(200);
    seen.push(got.body);
    expectNoInternalLeak(got.body);

    v.directory.deletePrincipal('idp-sub-alice');
    const afterDelete = await v.world.mcp.invoke({ tool: 'artifacts_publish',
      invocation: v.world.invocation('idp-sub-alice'),
      args: { artifactId: v.artifactId, idempotencyKey: 'r1c-pub-3',
        files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>after delete</h1>' }] } });
    expect(afterDelete.status).toBe(201);
    seen.push(afterDelete.body);
    expect(manifestOwnerOf(afterDelete.body)).toBe(UNKNOWN_USER_REF);
    expectNoInternalLeak(afterDelete.body);
    const deletedReleaseId = (afterDelete.body as { releaseId: string }).releaseId;
    expect(JSON.parse((await v.world.state.getRelease(deletedReleaseId))!.manifest).ownerId)
      .toBe('idp-sub-alice');

    const sourceAfterDelete = await v.world.mcp.invoke({ tool: 'artifacts_get_source',
      invocation: v.world.invocation('idp-sub-alice'), args: { artifactId: v.artifactId } });
    expect(sourceAfterDelete.status).toBe(200);
    seen.push(sourceAfterDelete.body);
    expect(manifestOwnerOf(sourceAfterDelete.body)).toBe(UNKNOWN_USER_REF);
    expectNoInternalLeak(sourceAfterDelete.body);

    for (const body of seen) expectNoInternalLeak(body);
  });

  it('projects the conflict currentSource manifest instead of leaking the sub', async () => {
    const v = await versionsWorld();
    const firstConf = await v.publish('idp-sub-alice', 'r1c-conf-1');
    expect(firstConf.status).toBe(201);
    const second = await v.publish('idp-sub-alice', 'r1c-conf-2');
    expect(second.status).toBe(201);
    const stale = await v.world.mcp.invoke({ tool: 'artifacts_publish',
      invocation: v.world.invocation('idp-sub-alice'),
      args: { artifactId: v.artifactId, idempotencyKey: 'r1c-conf-3',
        expectedCurrentReleaseId: (firstConf.body as { releaseId: string }).releaseId,
        edits: [{ path: 'index.html', oldStr: '<h1>hello</h1>', newStr: '<h1>stale</h1>' }] } });
    expect(stale.status).toBe(409);
    expectNoInternalLeak(stale.body);
    const currentSource = (stale.body as { conflict: { currentSource: { manifest: string } } })
      .conflict.currentSource;
    expect(JSON.parse(currentSource.manifest).ownerId).toBe('ref-alice');
    expectNoInternalLeak(currentSource);
  });
});
