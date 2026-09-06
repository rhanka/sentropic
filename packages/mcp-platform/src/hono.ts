import { Hono, type Context, type MiddlewareHandler } from 'hono';

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
    const outcome = await dispatch(operation, c, intent);
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
          serverInfo: { name: '@sentropic/mcp-platform', version: '0.2.0' },
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
  });
  return app;
};
