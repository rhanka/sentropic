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
    scopes: { invoke: string; read: string };
  };
  connector: McpConnectorPort;
  invocation?: McpInvocationPort;
  enabled?: () => boolean;
}

const parseIntent = async (c: Context): Promise<McpConnectorIntent | null> => {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
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

  const handle = (operation: 'invoke' | 'read') => async (c: Context): Promise<Response> => {
    const intent = await parseIntent(c);
    if (!intent) return c.json({ error: { code: 'invalid_request', message: 'Request body is invalid.' } }, 400);
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
    if (!decision.allowed) {
      return c.json(
        { error: { code: 'invocation_refused', message: decision.reason } },
        decision.status ?? 503,
      );
    }
    const result = operation === 'invoke'
      ? await options.connector.invoke(request)
      : await options.connector.readResource(request);
    return respond(c, result);
  };

  app.use('/invoke', options.auth.require([options.auth.scopes.invoke]));
  app.post('/invoke', handle('invoke'));
  app.use('/resources/read', options.auth.require([options.auth.scopes.read]));
  app.post('/resources/read', handle('read'));
  return app;
};
