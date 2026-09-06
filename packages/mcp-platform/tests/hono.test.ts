import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createMcpPlatformHono, type McpHonoOptions } from '../src/hono.js';

const scopes = {
  discover: 'mcp:discover',
  invoke: 'mcp:tools:invoke',
  read: 'mcp:resources:read',
};

const auth = (): McpHonoOptions['auth'] => {
  const routes = new Hono().get('/.well-known/oauth-protected-resource', (c) =>
    c.json({ resource: 'https://mcp.test' }));
  return {
    routes,
    scopes,
    require: () => async (c, next) => {
      if (c.req.header('authorization') !== 'Bearer valid') {
        return c.json({ error: 'invalid_token' }, 401);
      }
      c.set('mcpPrincipal', {
        sub: 'user-1',
        clientId: 'client-1',
        tid: 'tenant-1',
        scopes: [scopes.discover, scopes.invoke, scopes.read],
      });
      await next();
    },
    context: (c) => c.get('mcpPrincipal'),
  };
};

const request = {
  connectorId: 'google-drive',
  capabilityRef: 'files.list',
  input: { folder: 'root' },
};

const build = (overrides: Partial<McpHonoOptions> = {}) => {
  const connector = {
    invoke: vi.fn(async () => ({ ok: true, output: 'invoked' })),
    readResource: vi.fn(async () => ({ ok: true, output: 'read' })),
  };
  return {
    connector,
    app: createMcpPlatformHono({ auth: auth(), connector, ...overrides }),
  };
};

const post = (app: Hono, path: string, body: unknown) => app.request(path, {
  method: 'POST',
  headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('createMcpPlatformHono', () => {
  it('mounts injected PRM routes and keeps the complete surface disableable', async () => {
    const enabled = build();
    expect((await enabled.app.request('/.well-known/oauth-protected-resource')).status).toBe(200);

    const disabled = build({ enabled: () => false });
    expect((await disabled.app.request('/.well-known/oauth-protected-resource')).status).toBe(404);
  });

  it('authorizes a validated intent before one provider invocation', async () => {
    const authorize = vi.fn(async () => ({ allowed: true as const }));
    const { app, connector } = build({ invocation: { authorize } });
    const response = await post(app, '/invoke', request);

    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ operation: 'invoke' }));
    expect(connector.invoke).toHaveBeenCalledTimes(1);
    expect(connector.invoke).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({ sub: 'user-1', tid: 'tenant-1' }),
    }));
  });

  it('fails closed before provider effects when the invocation port refuses', async () => {
    const { app, connector } = build({
      invocation: { authorize: async () => ({ allowed: false, reason: 'missing-registration', status: 503 }) },
    });
    const response = await post(app, '/resources/read', request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'invocation_refused' } });
    expect(connector.readResource).not.toHaveBeenCalled();
  });

  it('returns deterministic protocol metadata without provider effects', async () => {
    const { app, connector } = build();
    const initialize = { jsonrpc: '2.0', id: 7, method: 'initialize' };
    const first = await (await post(app, '/', initialize)).json();
    const second = await (await post(app, '/', initialize)).json();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      result: { protocolVersion: '2025-06-18', serverInfo: { name: '@sentropic/mcp-platform' } },
    });
    expect(connector.invoke).not.toHaveBeenCalled();
    expect(connector.readResource).not.toHaveBeenCalled();
  });

  it('dispatches a protocol tool call exactly once', async () => {
    const { app, connector } = build();
    const response = await post(app, '/', {
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: request,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 'call-1', result: { ok: true } });
    expect(connector.invoke).toHaveBeenCalledTimes(1);
  });
});
