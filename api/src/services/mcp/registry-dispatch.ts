import { Hono, type Context } from 'hono';
import type { ArtifactHostIdentity } from '../artifacts/authorization';
import type { ArtifactTransport } from '../artifacts/transport';

export interface RegistryDispatchPorts {
  transport(): Promise<ArtifactTransport>;
  enabled(): boolean;
  authenticate(context: Context, scopes: string[], workspace?: string): Promise<Response | {
    identity: ArtifactHostIdentity; workspaceId: string; scopes: readonly string[];
  }>;
  authorize(): Promise<{ allowed: true } | { allowed: false; reason: string; status?: 403 | 409 | 503 }>;
}

/** Add the compiled plan at the existing MCP URL; legacy connector calls continue downstream. */
export function createRegistryDispatchRouter(ports: RegistryDispatchPorts): Hono {
  const router = new Hono();
  const handler = (rpc: boolean) => async (context: Context, next: () => Promise<void>) => {
    const raw = await context.req.raw.clone().json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next();
    const body = raw as Record<string, unknown>;
    const id = body.id ?? null;
    const candidate = rpc ? body.params : body;
    const params = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown> : undefined;
    const discover = rpc && body.method === 'tools/list';
    const call = rpc ? body.method === 'tools/call' && typeof params?.name === 'string'
      : params?.connectorId === 'sentropic.artifacts';
    if (!discover && !call) return next();
    // On the RPC path every handled outcome is a terminal JSON-RPC envelope carrying the
    // request id; on the REST path the historical bodies and statuses are kept.
    const refuse = (code: number, rest: { error: string }, status: 400 | 403 | 404 | 409 | 503) =>
      rpc
        ? context.json({ jsonrpc: '2.0', id, error: { code, message: rest.error } }, status)
        : context.json(rest, status);
    try {
      if (!ports.enabled()) return refuse(-32001, { error: 'not_found' }, 404);
      if (rpc && body.jsonrpc !== '2.0') return refuse(-32600, { error: 'invalid_request' }, 400);
      const tool = rpc ? params?.name : params?.capabilityRef;
      if (call && typeof tool !== 'string') return refuse(-32600, { error: 'invalid_request' }, 400);
      const principal = await ports.authenticate(context, [discover ? 'mcp:discover' : 'mcp:tools:invoke'],
        typeof params?.workspaceRef === 'string' ? params.workspaceRef : undefined);
      if (principal instanceof Response) {
        // REST path: historical passthrough of the auth refusal. RPC path: the refusal
        // becomes a terminal JSON-RPC envelope carrying the request id — never a bare
        // HTTP error body — while keeping the challenge status and WWW-Authenticate.
        if (!rpc) return principal;
        const detail: unknown = await principal.clone().json().catch(() => null);
        const error = detail && typeof detail === 'object' ? (detail as { error?: unknown }).error : null;
        const message = typeof error === 'string' ? error
          : error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'access_denied';
        const headers = new Headers(principal.headers);
        headers.set('content-type', 'application/json');
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32003, message } }),
          { status: principal.status, headers },
        );
      }
      const admission = await ports.authorize();
      if (!admission.allowed) return refuse(-32003, { error: 'invocation_refused' }, admission.status ?? 503);
      const transport = await ports.transport();
      if (discover) return context.json({ jsonrpc: '2.0', id,
        result: { tools: await transport.discover(principal.identity, principal.workspaceId, principal.scopes) } });
      const result = await transport.invoke(principal.identity, principal.workspaceId, principal.scopes,
        tool as string, (rpc ? params?.arguments : params?.input) ?? {});
      if (!rpc) return context.newResponse(JSON.stringify(result.body), result.status as 200,
        { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return context.json({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: JSON.stringify(result.body) }], isError: result.status >= 400,
      } });
    } catch {
      // A throw must still answer the request: a JSON-RPC error object with a stable code
      // and the request id on the RPC path, the historical refusal body on the REST path.
      return rpc
        ? context.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } })
        : context.json({ error: 'artifact_request_refused' }, 403);
    }
  };
  router.post('/', handler(true));
  router.post('/invoke', handler(false));
  return router;
}
