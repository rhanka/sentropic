import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createMcpPlatformHono, type McpHonoOptions } from '../src/hono.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerBridgeTools } from '../src/transport/streamable-http.js';

const scopes = {
  discover: 'mcp:discover',
  invoke: 'mcp:tools:invoke',
  read: 'mcp:resources:read',
};

const auth = (
  principalScopes: string[] = [scopes.discover, scopes.invoke, scopes.read],
): McpHonoOptions['auth'] => {
  const routes = new Hono().get('/.well-known/oauth-protected-resource', (c) =>
    c.json({ resource: 'https://mcp.test' }));
  return {
    routes,
    scopes,
    require: (required: string[]) => async (c, next) => {
      if (c.req.header('authorization') !== 'Bearer valid') {
        return c.json({ error: 'invalid_token' }, 401);
      }
      for (const scope of required) {
        if (!principalScopes.includes(scope)) {
          return c.json({ error: 'insufficient_scope' }, 403);
        }
      }
      c.set('mcpPrincipal', {
        sub: 'user-1',
        clientId: 'client-1',
        tid: 'tenant-1',
        scopes: [...principalScopes],
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

const build = (overrides: Partial<McpHonoOptions> = {}, principalScopes?: string[]) => {
  const connector = {
    invoke: vi.fn(async () => ({ ok: true, output: 'invoked' })),
    readResource: vi.fn(async () => ({ ok: true, output: 'read' })),
  };
  return {
    connector,
    app: createMcpPlatformHono({ auth: auth(principalScopes), connector, ...overrides }),
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

describe('createMcpPlatformHono /mcp SDK mount', () => {
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['surface'],
    properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
  };

  const mountApp = (seen: Array<unknown>, principalScopes?: string[]) => {
    const server = new Server({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerBridgeTools(
      server,
      [{ name: 'immo.price.estimate', description: 'Estimate a price', schema: SCHEMA }],
      {
        run: async (_tool, args, identity) => {
          seen.push(identity);
          return { ok: true, output: { echo: args }, auditId: 'a', redactionClass: 'low' };
        },
      },
    );
    const { connector, app } = build({
      mcp: {
        server,
        stateful: true,
        createTransport: () => new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        }),
      },
    }, principalScopes);
    return { app, connector };
  };

  const parseBody = async (response: Response): Promise<{ json: unknown; sessionId: string | null }> => {
    const sessionId = response.headers.get('mcp-session-id');
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    if (contentType.includes('application/json')) return { json: JSON.parse(text), sessionId };
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) throw new Error(`no SSE data in response: ${text.slice(0, 120)}`);
    return { json: JSON.parse(dataLine.slice('data:'.length).trim()), sessionId };
  };

  const rpc = (app: Hono, sessionId: string | null, body: unknown, headers: Record<string, string> = {}) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer [REDACTED]',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const initialize = async (app: Hono, headers: Record<string, string> = {}) => {
    const response = await rpc(app, null, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
    }, headers);
    expect(response.status).toBe(200);
    const { json, sessionId } = await parseBody(response);
    expect(json).toMatchObject({ result: { serverInfo: { name: 'probe' } } });
    if (sessionId === null) throw new Error('missing session id');
    const notified = await rpc(app, sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, headers);
    expect([200, 202]).toContain(notified.status);
    return sessionId;
  };

  it('serves the real SDK handshake, list and call over /mcp', async () => {
    const seen: Array<unknown> = [];
    const { app } = mountApp(seen);
    const sessionId = await initialize(app);
    const listed = await parseBody(
      await rpc(app, sessionId, { jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} }),
    );
    expect(listed.json).toMatchObject({ result: { tools: [{ name: 'immo.price.estimate' }] } });
    const called = await parseBody(
      await rpc(app, sessionId, {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'immo.price.estimate', arguments: { surface: 80 } },
      }),
    );
    expect(called.json).toMatchObject({
      result: { isError: false, content: [{ type: 'text', text: '{"echo":{"surface":80}}' }] },
    });
  });

  it('rejects SDK handshakes on /mcp without a bearer with 401', async () => {
    const { app } = mountApp([]);
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
      }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects bearers without the invoke scope on /mcp with 403', async () => {
    const { app } = mountApp([], [scopes.discover, scopes.read]);
    const response = await rpc(app, null, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
    });
    expect(response.status).toBe(403);
  });

  it('ignores forged client header identity on /mcp', async () => {
    const seen: Array<unknown> = [];
    const { app } = mountApp(seen);
    const forged = {
      'x-mcp-client-id': 'mallory',
      'x-mcp-tenant-ref': 't-9',
      'x-mcp-scopes': 'admin:* probe:use',
    };
    const sessionId = await initialize(app, forged);
    await rpc(app, sessionId, {
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'immo.price.estimate', arguments: { surface: 80 } },
    }, forged);
    expect(seen.length).toBeGreaterThan(0);
    for (const identity of seen) {
      expect(JSON.stringify(identity ?? null)).not.toContain('mallory');
      expect(JSON.stringify(identity ?? null)).not.toContain('t-9');
      expect(JSON.stringify(identity ?? null)).not.toContain('admin:*');
    }
  });

  it('answers 404 on /mcp without a mount', async () => {
    const { app } = build();
    const response = await rpc(app, null, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {},
    });
    expect(response.status).toBe(404);
  });
});
