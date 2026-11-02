import { describe, expect, it } from 'vitest';
import { createTransportWorld } from './fixtures/transport-world.js';

describe('P0 source, control and summary transports', () => {
  async function published() {
    const world = createTransportWorld(['alice', 'bob'], 'scope-p0b', { parity: true });
    const ensured = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
    if (!ensured.ok) throw new Error('ensure failed');
    const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
    const response = await world.mcp.invoke({ tool: 'artifacts_publish', invocation: world.invocation(),
      args: { artifactId, idempotencyKey: 'publish', files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>Author</h1>' }] } });
    expect(response.status).toBe(201);
    const releaseId = (response.body as { releaseId: string }).releaseId;
    const call = (tool: string, args: object, actor = 'alice') => world.mcp.invoke({ tool,
      invocation: world.invocation(actor), args: { artifactId, ...args } });
    return { world, artifactId, releaseId, call };
  }
  it.each(['artifacts_set_access', 'artifacts_delete'])('should mask invisible artifacts for %s over HTTP and MCP', async (tool) => {
    const { world, artifactId, releaseId, call } = await published();
    const path = tool === 'artifacts_set_access' ? '/set_access' : '/delete';
    const args = tool === 'artifacts_set_access'
      ? { action: 'grant', principalId: 'alice', grant: 'read', idempotencyKey: 'probe' }
      : { expectedCurrentReleaseId: releaseId, idempotencyKey: 'probe' };
    const http = (id: string) => world.app.handle({ method: 'POST', path,
      body: { artifactId: id, ...args }, actorId: 'bob' }, world.invocation('bob'));
    const hidden = { status: 404, body: { error: 'not_found' } };
    expect(await call(tool, args, 'bob')).toEqual(hidden);
    expect(await http(artifactId)).toEqual(hidden);
    const missingId = '00000000-0000-4000-8000-000000000099';
    expect(await call(tool, { ...args, artifactId: missingId }, 'bob')).toEqual(hidden);
    expect(await http(missingId)).toEqual(hidden);
    expect((await call('artifacts_set_access', { action: 'grant', principalId: 'bob', grant: 'read',
      idempotencyKey: 'share-probe' })).status).toBe(200);
    const denied = { status: 403, body: { error: 'access_denied' } };
    expect(await call(tool, args, 'bob')).toEqual(denied);
    expect(await http(artifactId)).toEqual(denied);
    await world.lifecycle.withdraw(artifactId, 'alice');
    expect(await call(tool, args, 'bob')).toEqual(hidden);
    expect(await http(artifactId)).toEqual(hidden);
    expect(world.receipts.size).toBe(3);
    expect(world.quotaReservations).toHaveLength(2);
  });
  it('should share read access without source and revoke the next read', async () => {
    const { world, artifactId, call } = await published();
    const args = { action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: 'share' };
    expect((await call('artifacts_set_access', args)).status).toBe(200);
    expect((await call('artifacts_set_access', args)).status).toBe(200);
    expect((await call('artifacts_get', {}, 'bob')).status).toBe(200);
    expect((await call('artifacts_get_source', {}, 'bob')).status).toBe(403);
    expect((await call('artifacts_set_access', { ...args, principalId: 'alice' })).status).toBe(409);
    expect((await call('artifacts_set_access', { ...args, idempotencyKey: 'other' }, 'bob')).status).toBe(403);
    expect((await call('artifacts_set_access', { action: 'revoke', principalId: 'bob', idempotencyKey: 'revoke' })).status).toBe(200);
    expect((await call('artifacts_get', {}, 'bob')).status).toBe(404);
    expect((await world.acls.getArtifactAcl(artifactId))?.grants).toEqual([]);
    expect(world.quotaReservations).toHaveLength(2);
  });
  it('should require a host proof, delete terminally and replay its receipt', async () => {
    const { world, artifactId, releaseId, call } = await published();
    const args = { expectedCurrentReleaseId: releaseId, idempotencyKey: 'delete' };
    const challenge = await call('artifacts_delete', args);
    expect(challenge).toMatchObject({ status: 409, body: { error: 'confirmation_required', details: {
      managementUrl: expect.any(String), expiresAt: expect.any(String), confirmationRef: expect.any(String) } } });
    expect((await call('artifacts_delete', { ...args, confirmationRef: 'forged' })).status).toBe(403);
    expect((await call('artifacts_get_source', {})).status).toBe(200);
    const ref = (challenge.body as { details: { confirmationRef: string } }).details.confirmationRef;
    world.approveConfirmation(ref);
    const deleted = await call('artifacts_delete', { ...args, confirmationRef: ref });
    expect(deleted).toMatchObject({ status: 200, body: { terminal: true, state: 'deleted', purgeState: 'pending' } });
    expect(await call('artifacts_delete', args)).toEqual(deleted);
    expect((await call('artifacts_get_source', {})).status).toBe(410);
    await expect(world.lifecycle.restore(artifactId, 'alice')).rejects.toThrow('terminal');
    const ensure = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure-again' });
    expect(ensure).toMatchObject({ ok: false, failure: { publicCode: 'gone' } });
  });
  it('should project complete get/list summaries and exact source bytes', async () => {
    const { world, artifactId, releaseId, call } = await published();
    const acl = (await world.acls.getArtifactAcl(artifactId))!;
    await world.acls.putArtifactAcl(artifactId, { ...acl, title: 'My page', description: 'Details', icon: 'home', updatedAt: '2026-11-01T00:00:00Z' });
    const metadata = await call('artifacts_get', {});
    expect(metadata.body).toMatchObject({ bindingName: 'page', currentReleaseId: releaseId,
      digest: expect.any(String), stableUrl: expect.any(String), pinnedUrl: expect.any(String),
      updatedAt: '2026-11-01T00:00:00Z', title: 'My page', description: 'Details', icon: 'home' });
    const list = await world.http('/list', {});
    expect(list).toMatchObject({ ok: true, result: { body: { artifacts: [expect.objectContaining({
      bindingName: 'page', currentReleaseId: releaseId, title: 'My page', digest: expect.any(String) })] } } });
    const source = await call('artifacts_get_source', { releaseId, paths: ['index.html'] });
    expect(source).toMatchObject({ status: 200, body: { releaseId, sourceRef: { kind: 'inline-original' },
      files: [{ path: 'index.html', bytes: [...Buffer.from('<h1>Author</h1>')] }] } });
  });
  it('should refuse expired and stale proofs without effects or receipts', async () => {
    const { world, releaseId, call } = await published();
    const args = { expectedCurrentReleaseId: releaseId, idempotencyKey: 'delete-expired' };
    const challenge = await call('artifacts_delete', args);
    const ref = (challenge.body as { details: { confirmationRef: string } }).details.confirmationRef;
    world.approveConfirmation(ref); world.expireConfirmation(ref);
    expect(await call('artifacts_delete', { ...args, confirmationRef: ref })).toMatchObject({
      status: 409, body: { error: 'confirmation_expired' } });
    expect(await call('artifacts_delete', { ...args, expectedCurrentReleaseId: null, confirmationRef: ref }))
      .toMatchObject({ status: 409, body: { error: 'confirmation_stale' } });
    expect((await call('artifacts_get_source', {})).status).toBe(200);
    expect(world.receipts.size).toBe(2);
  });
});
