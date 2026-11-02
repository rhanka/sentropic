import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createArtifactsAdapter, createArtifactsManifest } from '../src/mcp-core.js';
import { encodeToolResult } from '../../mcp-platform/src/transport/result-codec.js';
import { createTransportWorld } from './fixtures/transport-world.js';

const profile = (strict: boolean, envelope: 1 | 2) => ({
  ...RADAR_ARTIFACTS_PROFILE, profileRevisionId: strict ? 'immo-artifacts.v2' : 'immo-artifacts.p0b.v1',
  requireExpectedCurrentReleaseId: strict, resultEnvelopeVersion: envelope,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    ...(strict && envelope === 2 ? ['artifacts_list_versions', 'artifacts_revert'] : []),
    'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'],
  operations: [...RADAR_ARTIFACTS_PROFILE.operations,
    { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
});
const world = (strict: boolean, envelope: 1 | 2) => createTransportWorld(['alice', 'bob'], 'scope-r2',
  { profile: profile(strict, envelope) });

describe('R2 explicit profile and result switchovers', () => {
  it('should reject a new strict delete before confirmation without losing its typed refusal', async () => {
    const w = world(true, 2);
    const ensured = await w.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
    if (!ensured.ok) throw new Error('ensure failed');
    const args = { artifactId: (ensured.result.body as { artifactId: string }).artifactId, idempotencyKey: 'delete' };
    expect(await w.mcp.invoke({ tool: 'artifacts_delete', args, invocation: w.invocation() }))
      .toMatchObject({ status: 428, body: { error: { code: 'precondition_required' }, commitState: 'not_committed' } });
    expect(await w.mcp.invoke({ tool: 'artifacts_delete', args, invocation: w.invocation('bob') })).toMatchObject({ status: 404 });
    expect(w.quotaReservations).toHaveLength(1);
  });

  it('should replay a v1 receipt across both switchovers before requiring a precondition', async () => {
    const w = world(false, 1);
    const ensured = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'page', idempotencyKey: 'ensure' } });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const args = { artifactId, idempotencyKey: 'first', files: [{ path: 'index.html', mimeType: 'text/html', text: 'one' }] };
    const first = await w.mcp.invoke({ tool: 'artifacts_publish', invocation: w.invocation(), args });
    const strict = w.withProfile(profile(true, 2));
    const call = (input: object) => strict.handle({ method: 'POST', path: '/publish', actorId: 'alice', body: input }, w.invocation());
    expect(await call(args)).toMatchObject({ status: 201, body: { ok: true, replayed: true,
      output: { releaseId: (first.body as { releaseId: string }).releaseId } } });
    expect(await call({ ...args, idempotencyKey: 'new' })).toMatchObject({ status: 428 });
    expect(w.quotaReservations).toHaveLength(2);
    expect(await w.state.listReleases(artifactId)).toHaveLength(1);
  });

  it('should preserve source, metadata and ACLs while recording paginated revert lineage in v2', async () => {
    const w = world(true, 2);
    const call = (tool: string, args: object) => w.mcp.invoke({ tool, args, invocation: w.invocation() });
    const output = (response: { body: unknown }) => (response.body as { output: Record<string, any> }).output;
    const artifactId = output(await call('artifacts_ensure', { bindingName: 'page', idempotencyKey: 'ensure' })).artifactId;
    expect(output(await call('artifacts_get', { artifactId })).currentReleaseId).toBeNull();
    const first = output(await call('artifacts_publish', { artifactId, idempotencyKey: 'first', expectedCurrentReleaseId: null,
      title: 'First', files: [{ path: 'index.html', mimeType: 'text/html', text: 'one' }] }));
    const second = output(await call('artifacts_publish', { artifactId, idempotencyKey: 'edit',
      expectedCurrentReleaseId: first.releaseId, title: 'Current', edits: [{ path: 'index.html', oldStr: 'one', newStr: 'two' }] }));
    await call('artifacts_set_access', { artifactId, idempotencyKey: 'share', action: 'grant', principalId: 'bob', grant: 'read' });
    const reverted = await call('artifacts_revert', { artifactId, targetReleaseId: first.releaseId,
      expectedCurrentReleaseId: second.releaseId, idempotencyKey: 'revert' });
    expect(reverted.status).toBe(201);
    expect(output(reverted)).toMatchObject({ previousReleaseId: second.releaseId,
      revertedFromReleaseId: first.releaseId, title: 'Current', digest: first.digest, stableUrl: first.stableUrl });
    const all = output(await call('artifacts_list_versions', { artifactId }));
    expect(all.versions).toHaveLength(3);
    expect(all.versions.find((version: { releaseId: string }) => version.releaseId === output(reverted).releaseId))
      .toMatchObject({ releaseId: output(reverted).releaseId, authorPrincipalId: 'alice',
        parentReleaseId: second.releaseId, revertedFromReleaseId: first.releaseId, isCurrent: true, versionUrl: expect.any(String) });
    const history = output(await call('artifacts_list_versions', { artifactId, limit: 1 }));
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0].releaseId).toBe(all.versions[0].releaseId);
    const page = output(await call('artifacts_list_versions', { artifactId, limit: 1, cursor: history.nextCursor }));
    expect(page.versions[0].releaseId).toBe(all.versions[1].releaseId);
    const source = output(await call('artifacts_get_source', { artifactId }));
    expect(source.files[0]).toMatchObject({ path: 'index.html', text: 'one', encoding: 'utf8' });
    expect(source.files[0]).not.toHaveProperty('bytes');
    expect((await w.acls.getArtifactAcl(artifactId))?.grants).toEqual([{ principalId: 'bob', grant: 'read' }]);
  });

  it('should reject inconsistent trusted descriptors and expose the selected revision', () => {
    expect(() => compileArtifactsProfile(profile(false, 2))).toThrow();
    expect(() => compileArtifactsProfile({ ...profile(false, 1),
      selectedCapabilities: [...profile(false, 1).selectedCapabilities, 'artifacts_list_versions'] })).toThrow();
    const compatible = compileArtifactsProfile(profile(false, 1));
    expect(() => compatible.validate('artifacts_publish', { artifactId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey: 'edit', edits: [{ path: 'index.html', oldStr: 'one', newStr: 'two' }] })).toThrow();
    expect(() => compileArtifactsProfile({ ...profile(true, 2), resultEnvelopeVersion: 3 as 2 })).toThrow();
    const manifest = createArtifactsManifest({ profile: compileArtifactsProfile(profile(true, 2)) });
    expect(manifest.tools.find(tool => tool.name === 'artifacts_publish')?.description)
      .toContain('immo-artifacts.v2');
  });

  it('should keep compatible results at the root and select the v2 envelope independently', async () => {
    for (const [strict, envelope] of [[false, 1], [true, 1], [true, 2]] as const) {
      const w = world(strict, envelope);
      const result = await w.app.handle({ method: 'POST', path: '/ensure', actorId: 'alice',
        body: { bindingName: 'page', idempotencyKey: 'ensure' } }, w.invocation());
      expect(result.status).toBe(201);
      expect(envelope === 2 ? result.body : { output: result.body }).toMatchObject({
        output: { artifactId: expect.any(String) } });
      if (envelope === 1) expect(result.body).not.toHaveProperty('output');
      else expect(result.body).toMatchObject({ ok: true, commitState: 'committed', replayed: false });
    }
  });

  it('should require delete CAS only after the input switchover and preserve omission in command identity', async () => {
    const w = world(false, 1);
    const ensured = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'page', idempotencyKey: 'ensure' } });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const args = { artifactId, idempotencyKey: 'delete' };
    const challenge = await w.mcp.invoke({ tool: 'artifacts_delete', invocation: w.invocation(), args });
    expect(challenge).toMatchObject({ status: 409, body: { error: 'confirmation_required' } });
    const ref = (challenge.body as { details: { confirmationRef: string } }).details.confirmationRef;
    w.approveConfirmation(ref);
    expect(await w.mcp.invoke({ tool: 'artifacts_delete', invocation: w.invocation(),
      args: { ...args, confirmationRef: ref } })).toMatchObject({ status: 200, body: { terminal: true } });
    expect(await w.mcp.invoke({ tool: 'artifacts_delete', invocation: w.invocation(), args }))
      .toMatchObject({ status: 200, body: { terminal: true } });
    expect(await w.withProfile(profile(true, 2)).handle({ method: 'POST', path: '/delete', actorId: 'alice', body: args }, w.invocation()))
      .toMatchObject({ status: 200, body: { replayed: true, output: { terminal: true } } });
  });

  it('should preserve the strict refusal message and typed details over HTTP and MCP', async () => {
    const w = world(true, 2);
    const ensured = await w.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
    if (!ensured.ok) throw new Error('ensure failed');
    const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
    const args = { artifactId, idempotencyKey: 'missing', files: [{ path: 'index.html', mimeType: 'text/html', text: 'one' }] };
    const response = await w.app.handle({ method: 'POST', path: '/publish', body: args, actorId: 'alice' }, w.invocation());
    expect(response).toMatchObject({ status: 428, body: { ok: false, commitState: 'not_committed', error: {
      code: 'precondition_required', message: expect.stringContaining('The server will not infer this value.'),
      retriable: false, details: { profileRevisionId: 'immo-artifacts.v2', resultEnvelopeVersion: 2,
        requiredField: 'expectedCurrentReleaseId', readTools: ['artifacts_get', 'artifacts_list'] } } } });
    const adapter = createArtifactsAdapter({ profile: w.profile, app: w.app, createInvocation: () => w.invocation() });
    const wire = encodeToolResult(await adapter.invokeTool({ capabilityRef: 'artifacts_publish', input: args,
      ctx: { requestId: 'request', auditId: 'audit', principal: { sub: 'alice' } } } as never));
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toMatchObject({ ok: false,
      error: { code: 'precondition_required', details: { profileRevisionId: 'immo-artifacts.v2' } } });
    expect(w.quotaReservations).toHaveLength(1);
  });
});
