import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { createRegistryDispatchRouter, type RegistryDispatchPorts } from '../../src/services/mcp/registry-dispatch';
import type { ArtifactTransport } from '../../src/services/artifacts/transport';

// Terminal-response contract: every handled JSON-RPC request (POST / with an id) gets a
// terminal envelope carrying that id — on a throw too — so no client request stays pending.
// The REST /invoke path keeps its historical bodies and statuses apart from never hanging.

const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'client-a', credentialId: 'token-a' };
const principal = { identity, workspaceId: 'workspace-a', scopes: ['mcp:discover', 'mcp:tools:invoke'] };

const transport = (overrides: Partial<ArtifactTransport> = {}): ArtifactTransport => ({
  ready: Promise.resolve({ tools: new Map() }),
  discover: async () => [{ name: 'artifacts_ensure', inputSchema: { type: 'object' } }],
  invoke: async () => ({ status: 200, body: { ok: true } }),
  http: async () => ({ status: 200, body: {} }),
  ...overrides,
} as unknown as ArtifactTransport);

const ports = (overrides: Partial<RegistryDispatchPorts> = {}): RegistryDispatchPorts => ({
  transport: async () => transport(),
  enabled: () => true,
  authenticate: async () => principal,
  authorize: async () => ({ allowed: true as const }),
  workspaces: async () => ({ workspaces: [] }),
  ...overrides,
});

const mount = (p: RegistryDispatchPorts) =>
  new Hono().route('/api/v1/mcp', createRegistryDispatchRouter(p));

const rpcPost = (app: Hono, body: unknown) => app.request('/api/v1/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const restPost = (app: Hono, body: unknown) => app.request('/api/v1/mcp/invoke', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const call = { jsonrpc: '2.0', id: 'call-1', method: 'tools/call',
  params: { name: 'artifacts_ensure', arguments: {} } };
const restCall = { connectorId: 'sentropic.artifacts', capabilityRef: 'artifacts.ensure', input: {} };

describe('registry dispatch terminal JSON-RPC responses', () => {
  const INTERNAL = { code: -32603, message: 'Internal error' };

  it('keeps the happy-path envelopes with their ids', async () => {
    const app = mount(ports());
    const list = await rpcPost(app, { jsonrpc: '2.0', id: 'list-1', method: 'tools/list' });
    expect(await list.json()).toMatchObject({
      jsonrpc: '2.0', id: 'list-1', result: { tools: [{ name: 'artifacts_ensure' }, { name: 'workspaces_list' }] },
    });
    const called = await rpcPost(app, call);
    expect(await called.json()).toMatchObject({ jsonrpc: '2.0', id: 'call-1', result: { isError: false } });
  });

  it('answers a tools/call whose transport() throws with a JSON-RPC error carrying the same id', async () => {
    const app = mount(ports({ transport: async () => { throw new Error('registry secret'); } }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: '2.0', id: 'call-1', error: INTERNAL });
    expect(JSON.stringify(body)).not.toContain('registry secret');
  });

  it('answers a tools/call whose transport.invoke throws with a JSON-RPC error carrying the same id', async () => {
    const app = mount(ports({
      transport: async () => transport({
        invoke: async () => { throw new Error('bind secret'); },
      }),
    }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'call-1', error: INTERNAL });
  });

  it('answers a tools/list whose transport.discover throws with a JSON-RPC error carrying the same id', async () => {
    const app = mount(ports({
      transport: async () => transport({
        discover: async () => { throw new Error('discover secret'); },
      }),
    }));
    const response = await rpcPost(app, { jsonrpc: '2.0', id: 'list-throw', method: 'tools/list' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'list-throw', error: INTERNAL });
  });

  it('answers a tools/call whose authenticate port throws with a JSON-RPC error carrying the same id', async () => {
    const app = mount(ports({ authenticate: async () => { throw new Error('auth secret'); } }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: '2.0', id: 'call-1', error: INTERNAL });
    expect(JSON.stringify(body)).not.toContain('auth secret');
  });

  it('answers a tools/call whose authorize port throws with a JSON-RPC error carrying the same id', async () => {
    const app = mount(ports({ authorize: async () => { throw new Error('gate secret'); } }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'call-1', error: INTERNAL });
  });

  it('answers an admission refusal on the RPC path with an envelope carrying the id', async () => {
    const app = mount(ports({
      authorize: async () => ({ allowed: false as const, reason: 'wrong_author', status: 503 as const }),
    }));
    const response = await rpcPost(app, { jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0', id: 7, error: { code: -32003, message: 'invocation_refused' },
    });
  });

  it('answers a disabled host on the RPC path with an envelope carrying the id', async () => {
    const app = mount(ports({ enabled: () => false }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0', id: 'call-1', error: { code: -32001, message: 'not_found' },
    });
  });

  it('answers a non-2.0 jsonrpc on the RPC path with an envelope carrying the id', async () => {
    const app = mount(ports());
    const response = await rpcPost(app, { jsonrpc: '1.0', id: 9, method: 'tools/list' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0', id: 9, error: { code: -32600, message: 'invalid_request' },
    });
  });

  it('keeps the REST /invoke refusal body on a transport throw and never hangs', async () => {
    const app = mount(ports({ transport: async () => { throw new Error('bind secret'); } }));
    const response = await restPost(app, restCall);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'artifact_request_refused' });
  });

  it('keeps the REST /invoke refusal body on an authenticate throw and never hangs', async () => {
    const app = mount(ports({ authenticate: async () => { throw new Error('auth secret'); } }));
    const response = await restPost(app, restCall);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'artifact_request_refused' });
  });

  it('keeps the REST /invoke projected result on success', async () => {
    const app = mount(ports());
    const response = await restPost(app, restCall);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('keeps the REST /invoke passthrough for non-artifact calls', async () => {
    const app = mount(ports()).post('/api/v1/mcp/invoke', (c) => c.json({ legacy: true }));
    const response = await restPost(app, { connectorId: 'gmail', capabilityRef: 'read', input: {} });
    expect(await response.json()).toEqual({ legacy: true });
  });

  it('answers an authenticate challenge Response on the RPC path with an envelope carrying the id, keeping status and WWW-Authenticate', async () => {
    const challenge = Response.json(
      { error: { code: 'invalid_token', message: 'Authorization failed.' } },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token", resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"' } },
    );
    const app = mount(ports({ authenticate: async () => challenge }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: '2.0', id: 'call-1', error: { code: -32003, message: 'invalid_token' } });
    expect(JSON.stringify(body)).not.toContain('Authorization failed.');
  });

  it('answers an access_denied Response on the RPC path with an envelope carrying the id', async () => {
    const app = mount(ports({
      authenticate: async () => new Response(JSON.stringify({ error: 'access_denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    }));
    const response = await rpcPost(app, call);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0', id: 'call-1', error: { code: -32003, message: 'access_denied' },
    });
  });

  it('keeps the REST /invoke passthrough of an authenticate challenge Response', async () => {
    const challenge = Response.json(
      { error: { code: 'invalid_token', message: 'Authorization failed.' } },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
    );
    const app = mount(ports({ authenticate: async () => challenge }));
    const response = await restPost(app, restCall);
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(await response.json()).toEqual({ error: { code: 'invalid_token', message: 'Authorization failed.' } });
  });
});
