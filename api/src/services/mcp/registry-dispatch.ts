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
    const candidate = rpc ? body.params : body;
    const params = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown> : undefined;
    const discover = rpc && body.method === 'tools/list';
    const call = rpc ? body.method === 'tools/call' && typeof params?.name === 'string'
      : params?.connectorId === 'sentropic.artifacts';
    if (!discover && !call) return next();
    if (!ports.enabled()) return context.json({ error: 'not_found' }, 404);
    if (rpc && body.jsonrpc !== '2.0') return context.json({ error: 'invalid_request' }, 400);
    const tool = rpc ? params?.name : params?.capabilityRef;
    if (call && typeof tool !== 'string') return context.json({ error: 'invalid_request' }, 400);
    const principal = await ports.authenticate(context, [discover ? 'mcp:discover' : 'mcp:tools:invoke'],
      typeof params?.workspaceRef === 'string' ? params.workspaceRef : undefined);
    if (principal instanceof Response) return principal;
    const admission = await ports.authorize();
    if (!admission.allowed) return context.json({ error: 'invocation_refused' }, admission.status ?? 503);
    try {
      const transport = await ports.transport();
      if (discover) return context.json({ jsonrpc: '2.0', id: body.id ?? null,
        result: { tools: await transport.discover(principal.identity, principal.workspaceId, principal.scopes) } });
      const result = await transport.invoke(principal.identity, principal.workspaceId, principal.scopes,
        tool as string, (rpc ? params?.arguments : params?.input) ?? {});
      if (!rpc) return context.newResponse(JSON.stringify(result.body), result.status as 200,
        { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return context.json({ jsonrpc: '2.0', id: body.id ?? null, result: {
        content: [{ type: 'text', text: JSON.stringify(result.body) }], isError: result.status >= 400,
      } });
    } catch { return context.json({ error: 'artifact_request_refused' }, 403); }
  };
  router.post('/', handler(true));
  router.post('/invoke', handler(false));
  return router;
}
