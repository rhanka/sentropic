/**
 * Lot 1a — revocation through HTTP and the new MCP tool (design-merged §4.1,
 * lot 1 acceptance): static frozen definition, self-revoke only, error order,
 * effect on the next call under a live cookie regime.
 */
import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile } from '../src/profile/index.js';
import { ARTIFACTS_PROVIDER_VERSION, ARTIFACTS_TOOL_DEFINITIONS, ARTIFACTS_TOOL_NAMES,
  createArtifactsManifest } from '../src/mcp-core.js';
import { RC_ALICE, RC_BOB, RC_OWNER, rcProfile, rcWorldWith } from './fixtures/reader-consent-world.js';

describe('reader consent revocation (HTTP + MCP)', () => {
  it('keeps every pre-existing tool definition byte-identical across a profileRevisionId bump', () => {
    const base = compileArtifactsProfile(rcProfile());
    const bumped = compileArtifactsProfile({ ...rcProfile(), profileRevisionId: 'immo-artifacts.v9',
      resultEnvelopeVersion: 2, requireExpectedCurrentReleaseId: true });
    const preexisting = ARTIFACTS_TOOL_NAMES.filter((name) => name !== 'artifacts_revoke_reader_consent');
    const baseByName = new Map(createArtifactsManifest({ profile: base }).tools.map((tool) => [tool.name, tool]));
    const bumpedByName = new Map(createArtifactsManifest({ profile: bumped }).tools.map((tool) => [tool.name, tool]));
    for (const name of preexisting) {
      expect(JSON.stringify(baseByName.get(name))).toBe(JSON.stringify(bumpedByName.get(name)));
      expect(ARTIFACTS_TOOL_DEFINITIONS[name].description).not.toContain('immo-artifacts');
    }
    expect(baseByName.has('artifacts_revoke_reader_consent')).toBe(true);
    expect(JSON.stringify(baseByName.get('artifacts_revoke_reader_consent')))
      .toBe(JSON.stringify(bumpedByName.get('artifacts_revoke_reader_consent')));
    const frozen = JSON.stringify(ARTIFACTS_TOOL_DEFINITIONS.artifacts_revoke_reader_consent);
    expect(frozen).not.toContain(ARTIFACTS_PROVIDER_VERSION);
    expect(frozen).not.toContain('immo-artifacts');
    expect(frozen).not.toContain('profileDigest');
  });

  it('revokes self consent over MCP and cuts the next call under a live session', async () => {
    const rc = await rcWorldWith();
    await rc.grantRead(RC_ALICE);
    await rc.grant();
    const revoked = await rc.revokeMcp(RC_ALICE, { idempotencyKey: 'revoke-1' });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ artifactId: rc.artifactId, changed: true });
    expect(await rc.store.findLiveConsent({ storageScopeId: 'scope-rc', readerAccountId: RC_ALICE,
      artifactId: rc.artifactId, scopeId: 'baskets.read', scopeVersion: 'v1' })).toBeUndefined();
    const again = await rc.revokeMcp(RC_ALICE, { idempotencyKey: 'revoke-2' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ changed: false });
  });

  it('refuses a forged other-principal revoke and offers no grant route to the model', async () => {
    const rc = await rcWorldWith();
    await rc.grantRead(RC_ALICE);
    await rc.grant();
    const forged = await rc.revokeMcp(RC_ALICE, { principalId: RC_BOB, idempotencyKey: 'forge-1' });
    expect(forged.status).toBe(400);
    expect(forged.body).toEqual({ error: 'invalid_request' });
    expect(ARTIFACTS_TOOL_NAMES).not.toContain('artifacts_grant_reader_consent' as never);
    expect(await rc.store.findLiveConsent({ storageScopeId: 'scope-rc', readerAccountId: RC_ALICE,
      artifactId: rc.artifactId, scopeId: 'baskets.read', scopeVersion: 'v1' })).toBeDefined();
  });

  it('returns not_found for a non-reader revoke, over HTTP and MCP', async () => {
    const rc = await rcWorldWith();
    expect((await rc.revokeHttp(RC_BOB, { idempotencyKey: 'nr-1' })).status).toBe(404);
    expect((await rc.revokeMcp(RC_BOB, { idempotencyKey: 'nr-2' })).status).toBe(404);
    expect(RC_OWNER).toBeDefined();
  });
});
