import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export type McpConnectorIntent = {
  connectorId: string;
  capabilityRef: string;
  input: unknown;
  workspaceRef?: string;
  accountSelectorHint?: string;
};

export type McpPrincipal = {
  sub: string;
  clientId: string;
  tid: string | null;
  scopes: string[];
};

export type McpInvocation = McpConnectorIntent & {
  principal: McpPrincipal;
};

export interface McpConnectorPort {
  invoke(request: McpInvocation): Promise<unknown>;
  readResource(request: McpInvocation): Promise<unknown>;
}

export type McpInvocationDecision =
  | { allowed: true }
  | { allowed: false; reason: string; status?: 403 | 409 | 503 };

export interface McpInvocationPort {
  authorize(input: {
    operation: 'invoke' | 'read';
    request: McpInvocation;
  }): Promise<McpInvocationDecision>;
}

export interface McpSdkMount {
  /** SDK server with bridge tools already registered by the host. */
  server: Server;
  /** SDK transport factory (the host owns sessions via its options). */
  createTransport(): WebStandardStreamableHTTPServerTransport;
  /**
   * Stateful mount: one transport is created and connected at mount time and
   * reused across requests (the factory must enable sessions, e.g. with a
   * `sessionIdGenerator`). Stateless mount (default): one transport per
   * request, as the SDK requires.
   */
  stateful?: boolean;
}

export interface McpHonoOptions {
  auth: {
    routes: Hono;
    require(requiredScopes: string[]): MiddlewareHandler;
    context(c: Context): McpPrincipal;
    scopes: { discover: string; invoke: string; read: string };
  };
  connector: McpConnectorPort;
  invocation?: McpInvocationPort;
  enabled?: () => boolean;
  /** Optional real-SDK Streamable HTTP mount (Lot 5); absent means no `/mcp`. */
  mcp?: McpSdkMount;
}

const asIntent = (input: unknown): McpConnectorIntent | null => {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.connectorId !== 'string' || value.connectorId.length === 0) return null;
  if (typeof value.capabilityRef !== 'string' || value.capabilityRef.length === 0) return null;
  if (value.workspaceRef !== undefined && typeof value.workspaceRef !== 'string') return null;
  if (value.accountSelectorHint !== undefined && typeof value.accountSelectorHint !== 'string') return null;
  return {
    connectorId: value.connectorId,
    capabilityRef: value.capabilityRef,
    input: value.input ?? {},
    ...(value.workspaceRef ? { workspaceRef: value.workspaceRef } : {}),
    ...(value.accountSelectorHint ? { accountSelectorHint: value.accountSelectorHint } : {}),
  };
};

const parseIntent = async (c: Context): Promise<McpConnectorIntent | null> =>
  asIntent(await c.req.json().catch(() => undefined));

const statusFor = (result: unknown): 200 | 404 | 409 | 502 => {
  if (!result || typeof result !== 'object') return 404;
  const code = (result as { error?: { code?: unknown } }).error?.code;
  if (!code) return 200;
  if (code === 'connector_not_found') return 404;
  if (code === 'connector_secret_unavailable') return 409;
  return 502;
};

const respond = (c: Context, result: unknown): Response => {
  if (typeof result === 'string') return c.json({ ok: true, output: result }, 200);
  if (!result || typeof result !== 'object') {
    return c.json({ error: { code: 'connector_not_found', message: 'Connector capability not found.' } }, 404);
  }
  return c.json(result, statusFor(result));
};

/** JSON-RPC 2.0 reserved code for a handler-internal failure; the message never carries internals. */
const RPC_INTERNAL_ERROR = -32603;

const rpcError = (c: Context, id: unknown, code: number, message: string): Response =>
  c.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * Request id for a /mcp handler, read from a clone BEFORE the SDK consumes the body:
 * a mid-request throw must still answer with the request id, never with null. Never throws.
 */
const requestId = async (c: Context): Promise<unknown> => {
  try {
    const body: unknown = await c.req.raw.clone().json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return (body as Record<string, unknown>).id ?? null;
    }
  } catch { /* body unreadable or not JSON */ }
  return null;
};

export const createMcpPlatformHono = (options: McpHonoOptions): Hono => {
  const app = new Hono();
  const authorize = options.invocation?.authorize ?? (async () => ({ allowed: true as const }));

  app.use('*', async (c, next) => {
    if (options.enabled && !options.enabled()) {
      return c.json({ error: { code: 'not_found', message: 'MCP resource server is disabled.' } }, 404);
    }
    await next();
  });
  app.route('/', options.auth.routes);

  const dispatch = async (operation: 'invoke' | 'read', c: Context, intent: McpConnectorIntent) => {
    const context = options.auth.context(c);
    const request: McpInvocation = {
      ...intent,
      principal: {
        sub: context.sub,
        clientId: context.clientId,
        tid: context.tid,
        scopes: context.scopes,
      },
    };
    const decision = await authorize({ operation, request });
    if (!decision.allowed) return { allowed: false as const, decision };
    const result = operation === 'invoke'
      ? await options.connector.invoke(request)
      : await options.connector.readResource(request);
    return { allowed: true as const, result };
  };

  const handle = (operation: 'invoke' | 'read') => async (c: Context): Promise<Response> => {
    const intent = await parseIntent(c);
    if (!intent) return c.json({ error: { code: 'invalid_request', message: 'Request body is invalid.' } }, 400);
    let outcome: Awaited<ReturnType<typeof dispatch>>;
    try {
      outcome = await dispatch(operation, c, intent);
    } catch {
      // REST surface: terminal JSON error with a stable code, never a hang, never internals.
      return c.json({ error: { code: 'internal_error', message: 'Internal error.' } }, 500);
    }
    if (!outcome.allowed) {
      return c.json(
        { error: { code: 'invocation_refused', message: outcome.decision.reason } },
        outcome.decision.status ?? 503,
      );
    }
    return respond(c, outcome.result);
  };

  app.use('/invoke', options.auth.require([options.auth.scopes.invoke]));
  app.post('/invoke', handle('invoke'));
  app.use('/resources/read', options.auth.require([options.auth.scopes.read]));
  app.post('/resources/read', handle('read'));

  if (options.mcp) {
    // Real-SDK Streamable HTTP mount. B1: authentication is enforced at this
    // mount (invoke scope); per-request identity stays host-owned through its
    // registered server and mount identity — never client headers.
    const mount = options.mcp;
    app.use('/mcp', options.auth.require([options.auth.scopes.invoke]));
    if (mount.stateful) {
      const transport = mount.createTransport();
      let ready: Promise<void>;
      try {
        ready = mount.server.connect(transport);
      } catch (error) {
        ready = Promise.reject(error);
      }
      // Rejection is observed here and rethrown per request below, where it is
      // answered with a terminal JSON-RPC response instead of hanging the stream.
      void ready.catch(() => undefined);
      app.all('/mcp', async (c) => {
        // Capture the id before the SDK consumes the body, so a mid-request throw
        // still answers with the request id.
        const id = await requestId(c);
        try {
          await ready;
          return await transport.handleRequest(c.req.raw);
        } catch {
          // One transport serves every session: a single request's throw must not
          // close the shared transport — the envelope is that request's terminal
          // response.
          return rpcError(c, id, RPC_INTERNAL_ERROR, 'Internal error');
        }
      });
    } else {
      // Stateless: the SDK requires a fresh transport per request.
      app.all('/mcp', async (c) => {
        const id = await requestId(c);
        let transport: WebStandardStreamableHTTPServerTransport | undefined;
        try {
          transport = mount.createTransport();
          await mount.server.connect(transport);
          return await transport.handleRequest(c.req.raw);
        } catch {
          // Per-request transport: close it so the SSE stream ends after the
          // terminal response.
          await transport?.close().catch(() => undefined);
          return rpcError(c, id, RPC_INTERNAL_ERROR, 'Internal error');
        }
      });
    }
  }

  app.use('/', options.auth.require([]));
  app.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const rpc = body && typeof body === 'object' ? body as Record<string, unknown> : null;
    const id = rpc?.id ?? null;
    if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } }, 400);
    }
    if (rpc.method === 'initialize') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { resources: {}, tools: {} },
          serverInfo: { name: '@sentropic/mcp-platform', version: '0.3.0' },
        },
      });
    }
    const operation = rpc.method === 'tools/call'
      ? 'invoke'
      : rpc.method === 'resources/read' ? 'read' : null;
    if (!operation) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
    const intent = asIntent(rpc.params);
    if (!intent) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } }, 400);
    }
    try {
      const principal = options.auth.context(c);
      const scope = operation === 'invoke' ? options.auth.scopes.invoke : options.auth.scopes.read;
      if (!principal.scopes.includes(scope)) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: 'Insufficient scope' } }, 403);
      }
      const outcome = await dispatch(operation, c, intent);
      if (!outcome.allowed) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: outcome.decision.reason } }, outcome.decision.status ?? 503);
      }
      return c.json({ jsonrpc: '2.0', id, result: outcome.result });
    } catch {
      // Every JSON-RPC request gets a terminal envelope carrying its id.
      return rpcError(c, id, RPC_INTERNAL_ERROR, 'Internal error');
    }
  });
  return app;
};
