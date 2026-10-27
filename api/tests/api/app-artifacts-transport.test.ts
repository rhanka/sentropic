import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createArtifactTransport } from '../../src/services/artifacts/transport';
import { createArtifactHttpRouter } from '../../src/routes/namespaces/artifacts';
import { createRegistryDispatchRouter } from '../../src/services/mcp/registry-dispatch';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';

const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'client-a', credentialId: 'token-a' };
function fixture() {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const http = vi.fn(async () => ({ status: 201, body: { artifactId: 'artifact-a' } }));
  const mcp = vi.fn(async () => ({ status: 201, body: { artifactId: 'artifact-a' } }));
  const bind = vi.fn(async () => ({ profile, http, mcp }));
  const transport = createArtifactTransport({ profile, bind } as never);
  return { transport, http, mcp, bind };
}

describe('compiled app artifact transports', () => {
  it('should become ready with the refreshed APP-P1 before binding a request', async () => {
    const { transport, bind } = fixture();
    const registry = await transport.ready;
    expect([...registry.tools.keys()]).toEqual(['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish']);
    expect(bind).not.toHaveBeenCalled();
  });
  it('should dispatch exact compiled names once with verified identity and workspace', async () => {
    const { transport, bind, mcp } = fixture();
    const args = { bindingName: 'report', idempotencyKey: 'key-a' };
    expect(await transport.invoke(identity, 'workspace-a', ['mcp:tools:invoke'], 'artifacts_ensure', args))
      .toEqual({ status: 201, body: { artifactId: 'artifact-a' } });
    expect(bind).toHaveBeenCalledExactlyOnceWith(identity, 'workspace-a');
    expect(mcp).toHaveBeenCalledExactlyOnceWith({ tool: 'artifacts_ensure', args });
  });
  it('should refuse unknown names and insufficient scopes before binding storage', async () => {
    const { transport, bind } = fixture();
    for (const name of ['artifacts_promote', 'artifacts-ensure', 'missing']) {
      expect((await transport.invoke(identity, 'workspace-a', ['mcp:tools:invoke'], name, {})).status).toBe(404);
    }
    expect((await transport.invoke(identity, 'workspace-a', [], 'artifacts_list', {})).status).toBe(403);
    expect(bind).not.toHaveBeenCalled();
  });
  it('should validate closed inputs before binding even when forged authority equals the real principal', async () => {
    const { transport, bind } = fixture();
    expect((await transport.invoke(identity, 'workspace-a', ['mcp:tools:invoke'], 'artifacts_ensure', {
      bindingName: 'report', idempotencyKey: 'key', actorId: 'alice', storageScopeId: 'workspace-a',
    })).status).toBe(400);
    expect(bind).not.toHaveBeenCalled();
  });
  it('should expose compiled descriptors only after current authority is checked', async () => {
    const { transport, bind } = fixture();
    expect((await transport.discover(identity, 'workspace-a', ['mcp:discover'])).map(tool => tool.name))
      .toEqual(['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish']);
    bind.mockRejectedValueOnce(new Error('revoked'));
    await expect(transport.discover(identity, 'workspace-a', ['mcp:discover'])).rejects.toThrow();
    expect(await transport.discover(identity, 'workspace-a', [])).toEqual([]);
  });
  it('should mount HTTP effects with host identity and preserve package status', async () => {
    const { transport, http, bind } = fixture();
    const app = new Hono();
    app.route('/artifacts', createArtifactHttpRouter({
      transport: async () => transport, identity: async () => ({ identity, workspaceId: 'workspace-a' }),
    }));
    const response = await app.request('/artifacts/ensure', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bindingName: 'report', idempotencyKey: 'key' }) });
    expect(response.status).toBe(201);
    expect(bind).toHaveBeenCalledExactlyOnceWith(identity, 'workspace-a');
    expect(http).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/ensure',
      body: { bindingName: 'report', idempotencyKey: 'key' }, idempotencyKey: undefined });
    expect((await app.request('/artifacts/activate', { method: 'POST' })).status).toBe(404);
  });
  it('should refuse HTTP requests without verified identity or with malformed JSON', async () => {
    const { transport, bind } = fixture();
    const app = new Hono();
    app.route('/', createArtifactHttpRouter({ transport: async () => transport, identity: async () => null }));
    expect((await app.request('/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await app.request('/ensure', { method: 'POST', body: '{' })).status).toBe(400);
    expect(bind).not.toHaveBeenCalled();
  });
  it('should serve registry calls at the current MCP URL and pass connector/resource traffic downstream', async () => {
    const { transport, mcp } = fixture();
    const authorize = vi.fn(async () => ({ allowed: true as const }));
    const app = new Hono().route('/api/v1/mcp', createRegistryDispatchRouter({
      transport: async () => transport, enabled: () => true, authorize,
      authenticate: async () => ({ identity, workspaceId: 'workspace-a', scopes: ['mcp:discover', 'mcp:tools:invoke'] }),
    })).post('/api/v1/mcp', c => c.json({ legacy: true })).post('/api/v1/mcp/resources/read', c => c.json({ resource: true }));
    const request = (body: unknown) => app.request('/api/v1/mcp', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const list = await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await list.json()).result.tools).toHaveLength(4);
    const called = await request({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'artifacts_ensure', arguments: { bindingName: 'report', idempotencyKey: 'key' } } });
    expect((await called.json()).result.isError).toBe(false);
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(await (await request({ jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { connectorId: 'gmail', capabilityRef: 'read', input: {} } })).json()).toEqual({ legacy: true });
    expect(await (await app.request('/api/v1/mcp/resources/read', { method: 'POST' })).json()).toEqual({ resource: true });
    expect((await app.request('/api/v1/mcp/mcp', { method: 'POST' })).status).toBe(404);
    authorize.mockResolvedValueOnce({ allowed: false, reason: 'wrong_author', status: 503 } as never);
    expect((await request({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).status).toBe(503);
    expect(mcp).toHaveBeenCalledTimes(1);
  });
});
