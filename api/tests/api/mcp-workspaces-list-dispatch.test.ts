import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';
import { ArtifactOperationError } from '@sentropic/artifacts/server/outcome-contract';
import { createRegistryDispatchRouter, type RegistryDispatchPorts } from '../../src/services/mcp/registry-dispatch';
import { createArtifactTransport } from '../../src/services/artifacts/transport';
import { APP_P1_MANIFEST_DIGEST } from '../../src/services/mcp/cluster-registry';

// Host tool workspaces_list on the existing MCP URL: discovery, closed arguments,
// scope and admission. The directory port itself is covered with a real database
// in mcp-workspaces-list-directory.test.ts.

const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'client-a', credentialId: 'token-a' };
const directory = { workspaces: [{ workspaceRef: 'workspace-a', name: 'A', role: 'editor', publishable: true }] };

function fixture(overrides: Partial<RegistryDispatchPorts> = {}) {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const transport = createArtifactTransport({ profile, bind: vi.fn(async () => ({ profile })) } as never);
  const ports = {
    transport: vi.fn(async () => transport),
    enabled: () => true,
    // A token carrying exactly the scope the dispatcher requires for this method.
    authenticate: vi.fn(async (_context: unknown, scopes: string[]) => ({ identity, workspaceId: 'workspace-a', scopes })),
    authorize: vi.fn(async () => ({ allowed: true as const })),
    workspaces: vi.fn(async () => directory),
    ...overrides,
  };
  const app = new Hono().route('/api/v1/mcp', createRegistryDispatchRouter(ports as RegistryDispatchPorts));
  const rpc = (id: string, method: string, params?: unknown) => app.request('/api/v1/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
  });
  return { ports, transport, rpc };
}

describe('workspaces_list host tool dispatch', () => {
  it('should list a closed argument-free schema to a discover-only token beside the unchanged APP-P1 tools', async () => {
    const { ports, transport, rpc } = fixture();
    const body = await (await rpc('a', 'tools/list')).json();
    expect(ports.authenticate).toHaveBeenCalledWith(expect.anything(), ['mcp:discover'], undefined);
    expect(body.result.tools).toContainEqual({ name: 'workspaces_list',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
    expect(body.result.tools.map((tool: { name: string }) => tool.name))
      .toEqual(['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish', 'workspaces_list']);
    expect([...(await transport.ready).tools.keys()])
      .toEqual(['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish']);
    expect(APP_P1_MANIFEST_DIGEST).toBe('6faa661d9eab38920f4b7926d0778af00e3054dc3064f14c3d644ee0faa97ab7');
    expect(ports.workspaces).not.toHaveBeenCalled();
  });

  it.each([{ args: { x: 1 } }, { args: [] }, { args: null }, { args: 'x' }, { args: 0 }])(
    'should refuse arguments $args as invalid_request before authentication or any read', async ({ args }) => {
      const { ports, rpc } = fixture();
      const response = await rpc('b', 'tools/call', { name: 'workspaces_list', arguments: args });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'b', error: { code: -32600, message: 'invalid_request' } });
      expect(ports.authenticate).not.toHaveBeenCalled();
      expect(ports.workspaces).not.toHaveBeenCalled();
    });

  it.each([{ params: { name: 'workspaces_list' } }, { params: { name: 'workspaces_list', arguments: {} } }])(
    'should answer $params under mcp:tools:invoke through authorize()', async ({ params }) => {
      const { ports, rpc } = fixture();
      const response = await rpc('ok', 'tools/call', params);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'ok', result: {
        content: [{ type: 'text', text: JSON.stringify(directory) }], isError: false } });
      expect(ports.authenticate).toHaveBeenCalledWith(expect.anything(), ['mcp:tools:invoke'], undefined);
      expect(ports.authorize).toHaveBeenCalledOnce();
      expect(ports.workspaces).toHaveBeenCalledExactlyOnceWith(identity);
      expect(ports.transport).not.toHaveBeenCalled();
    });

  it('should ignore a caller-supplied workspaceRef', async () => {
    const { ports, rpc } = fixture();
    const plain = await (await rpc('d', 'tools/call', { name: 'workspaces_list' })).json();
    const response = await rpc('d', 'tools/call', { name: 'workspaces_list', workspaceRef: 'workspace-foreign' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plain);
    expect(ports.authenticate).toHaveBeenLastCalledWith(expect.anything(), ['mcp:tools:invoke'], undefined);
  });

  it('should keep the insufficient_scope challenge of a token without mcp:tools:invoke', async () => {
    const challenge = Response.json({ error: { code: 'insufficient_scope', message: 'Authorization failed.' } }, {
      status: 403, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="mcp:tools:invoke"' } });
    const { ports, rpc } = fixture({ authenticate: vi.fn(async () => challenge) });
    const response = await rpc('c', 'tools/call', { name: 'workspaces_list' });
    expect(response.status).toBe(403);
    expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'c', error: { code: -32003, message: 'insufficient_scope' } });
    expect(ports.authorize).not.toHaveBeenCalled();
    expect(ports.workspaces).not.toHaveBeenCalled();
  });

  it('should answer an admission refusal with its status and without reading workspaces', async () => {
    const { ports, rpc } = fixture({ authorize: vi.fn(async () => ({ allowed: false as const, reason: 'wrong_author' })) });
    const response = await rpc('c', 'tools/call', { name: 'workspaces_list' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'c', error: { code: -32003, message: 'invocation_refused' } });
    expect(ports.workspaces).not.toHaveBeenCalled();
  });

  it('(i) should still list workspaces_list when the default workspace cannot be bound', async () => {
    const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
    const bind = vi.fn(async () => { throw new ArtifactOperationError('access_denied'); });
    const denied = createArtifactTransport({ profile, bind } as never);
    const { ports, rpc } = fixture({ transport: vi.fn(async () => denied) });
    const response = await rpc('i', 'tools/list');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'i', result: { tools: [{ name: 'workspaces_list',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] } });
    expect(bind).toHaveBeenCalledExactlyOnceWith(identity, 'workspace-a');
    expect(ports.workspaces).not.toHaveBeenCalled();
    // Only access_denied is a discovery outcome; any other bind failure stays an internal error.
    for (const failure of [new ArtifactOperationError('admission_unavailable'), new Error('database down')]) {
      bind.mockRejectedValueOnce(failure);
      expect(await (await rpc('j', 'tools/list')).json())
        .toEqual({ jsonrpc: '2.0', id: 'j', error: { code: -32603, message: 'Internal error' } });
    }
  });

  it('should answer a denied current credential with access_denied rather than an empty list', async () => {
    const { rpc } = fixture({ workspaces: vi.fn(async () => null) });
    const response = await rpc('f', 'tools/call', { name: 'workspaces_list' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'f', error: { code: -32003, message: 'access_denied' } });
  });
});
