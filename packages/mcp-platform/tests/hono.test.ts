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
        authorization: 'Bearer valid',
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

describe('createMcpPlatformHono terminal responses on injected throws', () => {
  const INTERNAL = { code: -32603, message: 'Internal error' };

  it('answers a tools/call whose connector.invoke throws with a JSON-RPC error carrying the same id', async () => {
    const { app, connector } = build();
    connector.invoke.mockRejectedValueOnce(new Error('provider 503: bucket secret'));
    const response = await post(app, '/', {
      jsonrpc: '2.0', id: 'call-throw', method: 'tools/call', params: request,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: '2.0', id: 'call-throw', error: INTERNAL });
    expect(JSON.stringify(body)).not.toContain('bucket secret');
  });

  it('answers a tools/call whose invocation port throws with a JSON-RPC error carrying the same id', async () => {
    const { app, connector } = build({
      invocation: { authorize: async () => { throw new Error('authorizer down'); } },
    });
    const response = await post(app, '/', {
      jsonrpc: '2.0', id: 42, method: 'tools/call', params: request,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 42, error: INTERNAL });
    expect(connector.invoke).not.toHaveBeenCalled();
  });

  it('answers a resources/read whose connector.readResource throws with a JSON-RPC error carrying the same id', async () => {
    const { app, connector } = build();
    connector.readResource.mockRejectedValueOnce(new Error('read boom'));
    const response = await post(app, '/', {
      jsonrpc: '2.0', id: 'read-throw', method: 'resources/read', params: request,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'read-throw', error: INTERNAL });
  });

  it('answers a REST /invoke whose connector.invoke throws with a stable JSON error and never hangs', async () => {
    const { app, connector } = build();
    connector.invoke.mockRejectedValueOnce(new Error('invoke secret'));
    const response = await post(app, '/invoke', request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'internal_error', message: 'Internal error.' } });
    expect(JSON.stringify(body)).not.toContain('invoke secret');
  });

  it('answers a REST /resources/read whose invocation port throws with a stable JSON error', async () => {
    const { app } = build({
      invocation: { authorize: async () => { throw new Error('gate secret'); } },
    });
    const response = await post(app, '/resources/read', request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal_error', message: 'Internal error.' } });
  });

  describe('/mcp mount', () => {
    const mcpPost = (app: Hono, body: unknown) => app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });

    const mountWith = (
      stateful: boolean,
      hooks: {
        connect?: () => Promise<void>;
        createTransport?: () => WebStandardStreamableHTTPServerTransport;
        handleRequest?: (transport: WebStandardStreamableHTTPServerTransport) => void;
      },
    ) => {
      const transports: WebStandardStreamableHTTPServerTransport[] = [];
      const server = {
        connect: vi.fn(async () => { await hooks.connect?.(); }),
      } as unknown as Server;
      const createTransport = () => {
        if (hooks.createTransport) return hooks.createTransport();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        if (hooks.handleRequest) hooks.handleRequest(transport);
        transports.push(transport);
        return transport;
      };
      const { app } = build({ mcp: { server, stateful, createTransport } });
      return { app, transports };
    };

    it('answers a terminal JSON-RPC error with the id when the stateful connect rejects, without closing the shared transport', async () => {
      const { app, transports } = mountWith(true, {
        connect: async () => { throw new Error('connect secret'); },
      });
      const close = vi.spyOn(transports[0], 'close');
      const response = await mcpPost(app, { jsonrpc: '2.0', id: 'init-throw', method: 'initialize', params: {} });
      expect(response.status).toBe(200);
      // The body is read once and fully delivered: nothing stays pending on the stream.
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 'init-throw', error: INTERNAL });
      expect(text).toContain('init-throw');
      expect(text).not.toContain('connect secret');
      expect(close).not.toHaveBeenCalled();
    });

    it('answers a terminal JSON-RPC error with the id when the stateless connect rejects, and closes that request transport', async () => {
      const { app, transports } = mountWith(false, {
        connect: async () => { throw new Error('connect secret'); },
        handleRequest: (transport) => { vi.spyOn(transport, 'close'); },
      });
      const response = await mcpPost(app, { jsonrpc: '2.0', id: 'init-throw-2', method: 'initialize', params: {} });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 'init-throw-2', error: INTERNAL });
      expect(text).toContain('init-throw-2');
      expect(transports).toHaveLength(1);
      expect(transports[0].close).toHaveBeenCalledTimes(1);
    });

    it('answers a terminal JSON-RPC error with the id when handleRequest consumes the body then throws, without closing the shared transport', async () => {
      const { app, transports } = mountWith(true, {
        handleRequest: (transport) => {
          vi.spyOn(transport, 'handleRequest').mockImplementation(async (req: Request) => {
            await req.text(); // the SDK reads the body before it can throw
            throw new Error('stream secret');
          });
        },
      });
      const close = vi.spyOn(transports[0], 'close');
      const response = await mcpPost(app, { jsonrpc: '2.0', id: 'call-throw-mcp', method: 'tools/call', params: {} });
      expect(response.status).toBe(200);
      const text = await response.text();
      // The id is captured before the body is consumed: the envelope carries it, not null.
      expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 'call-throw-mcp', error: INTERNAL });
      expect(text).toContain('call-throw-mcp');
      expect(text).not.toContain('stream secret');
      expect(close).not.toHaveBeenCalled();
    });

    it('answers a terminal JSON-RPC error with the id when the stateless transport factory throws', async () => {
      const { app, transports } = mountWith(false, {
        createTransport: () => { throw new Error('factory secret'); },
      });
      const response = await mcpPost(app, { jsonrpc: '2.0', id: 'factory-throw', method: 'tools/call', params: {} });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 'factory-throw', error: INTERNAL });
      expect(text).not.toContain('factory secret');
      expect(transports).toHaveLength(0);
    });

    it('closes the per-request transport and answers with the id when the stateless handleRequest consumes the body then throws', async () => {
      const { app, transports } = mountWith(false, {
        handleRequest: (transport) => {
          vi.spyOn(transport, 'close');
          vi.spyOn(transport, 'handleRequest').mockImplementation(async (req: Request) => {
            await req.text();
            throw new Error('stream secret');
          });
        },
      });
      const response = await mcpPost(app, { jsonrpc: '2.0', id: 'stateless-throw', method: 'tools/call', params: {} });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 'stateless-throw', error: INTERNAL });
      expect(text).not.toContain('stream secret');
      expect(transports).toHaveLength(1);
      expect(transports[0].close).toHaveBeenCalledTimes(1);
    });

    it('answers a terminal JSON-RPC error with id null when the /mcp throw body is not JSON', async () => {
      const { app } = mountWith(true, {
        connect: async () => { throw new Error('connect secret'); },
      });
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer valid', 'content-type': 'text/plain', accept: 'application/json, text/event-stream' },
        body: 'not-json',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: null, error: INTERNAL });
    });
  });
});
