import { Hono } from 'hono';
import { createMcpAuth, MCP_SCOPES, type McpAuth } from '@sentropic/mcp-auth';
import { fromJwksPort } from '@sentropic/oauth-verify';
import {
  buildCanonicalPerAppTools,
  isWriteTool,
  type AppArtifactsRegistration,
  type CanonicalPerAppTool,
} from '../../services/artifacts/app-registration';
import { isToolPermitted } from '../../services/mcp/client-policy';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { getWorkspaceRole } from '../../services/workspace-access';
import { resolveOAuthIssuer } from '../auth/oauth';

export const isPerAppMcpEnabled = (): boolean => process.env.CM_PER_APP_MCP_ENABLED === '1';

export interface VerifiedPerAppPrincipal {
  sub: string;
  clientId: string;
  tid: string | null;
  scopes: readonly string[];
}

export interface PerAppMcpDeps {
  load: (slug: string) => AppArtifactsRegistration | undefined;
  verifyBearer?: (req: Request, registration: AppArtifactsRegistration) => Promise<VerifiedPerAppPrincipal>;
  isMember?: (sub: string, workspaceId: string) => Promise<boolean>;
}

/** Served definitions: selected capabilities with the registration wording overlay. */
export function buildPerAppToolList(registration: AppArtifactsRegistration): CanonicalPerAppTool[] {
  return buildCanonicalPerAppTools(
    [...registration.profile.selectedCapabilities],
    registration.presentation.toolSummaries,
  );
}

/** Canonical bytes of the served list, for the byte-identical acceptance check. */
export function perAppToolsBytes(registration: AppArtifactsRegistration): string {
  return JSON.stringify(buildPerAppToolList(registration));
}

const perAppAuthCache = new Map<string, McpAuth>();

function perAppMcpAuth(registration: AppArtifactsRegistration): McpAuth {
  const cached = perAppAuthCache.get(registration.mcp.resource);
  if (cached) return cached;
  const issuer = resolveOAuthIssuer();
  const auth = createMcpAuth({
    resource: registration.mcp.resource,
    authorizationServers: [issuer],
    keySource: fromJwksPort(createJwksAdapter()),
    scopesSupported: [MCP_SCOPES.DISCOVER, MCP_SCOPES.TOOLS_INVOKE],
    requireTid: true,
  });
  perAppAuthCache.set(registration.mcp.resource, auth);
  return auth;
}

async function defaultVerifyBearer(req: Request, registration: AppArtifactsRegistration): Promise<VerifiedPerAppPrincipal> {
  const auth = perAppMcpAuth(registration);
  const verified = await auth.verify(req, { requiredScopes: [] });
  return { sub: verified.sub, clientId: verified.clientId, tid: verified.tid, scopes: verified.scopes };
}

async function defaultIsMember(sub: string, workspaceId: string): Promise<boolean> {
  return (await getWorkspaceRole(sub, workspaceId)) !== null;
}

/** Additive per-app router. Mounted behind CM_PER_APP_MCP_ENABLED, generic /mcp untouched. */
export function createPerAppMcpRouter(
  load: (slug: string) => AppArtifactsRegistration | undefined,
  overrides?: Pick<PerAppMcpDeps, 'verifyBearer' | 'isMember'>,
): Hono {
  const deps: PerAppMcpDeps = { load, verifyBearer: overrides?.verifyBearer, isMember: overrides?.isMember };
  const router = new Hono();

  const authenticate = async (req: Request, registration: AppArtifactsRegistration):
    Promise<{ ok: true; principal: VerifiedPerAppPrincipal } | { ok: false; status: 401 | 403; error: string; challenge?: Response }> => {
    const verify = deps.verifyBearer ?? defaultVerifyBearer;
    const checkMember = deps.isMember ?? defaultIsMember;
    let principal: VerifiedPerAppPrincipal;
    try {
      principal = await verify(req, registration);
    } catch (error) {
      const status = (error as { status?: number })?.status === 403 ? 403 : 401;
      if (status === 401) {
        try {
          return { ok: false, status, error: 'wrong_audience', challenge: perAppMcpAuth(registration).challenge(error) };
        } catch {
          return { ok: false, status, error: 'wrong_audience' };
        }
      }
      return { ok: false, status, error: 'non_member' };
    }
    if (!principal.tid || principal.tid !== registration.tenantId) {
      return { ok: false, status: 403, error: 'tenant_pinned' };
    }
    if (!principal.sub || !(await checkMember(principal.sub, registration.workspaceId))) {
      return { ok: false, status: 403, error: 'non_member' };
    }
    return { ok: true, principal };
  };

  router.get('/api/v1/mcp/apps/:slug/tools', async (c) => {
    if (!isPerAppMcpEnabled()) return c.json({ error: 'disabled' }, 404);
    const registration = deps.load(c.req.param('slug'));
    if (!registration) return c.json({ error: 'unknown_app' }, 404);
    const auth = await authenticate(c.req.raw, registration);
    if (!auth.ok) {
      if (auth.challenge) return auth.challenge as unknown as Response;
      return c.json({ error: auth.error }, auth.status);
    }
    if (!auth.principal.scopes.includes(MCP_SCOPES.DISCOVER) &&
      !auth.principal.scopes.includes(MCP_SCOPES.TOOLS_INVOKE)) {
      return c.json({ error: 'insufficient_scope' }, 403);
    }
    return c.json({ tools: buildPerAppToolList(registration) });
  });

  router.post('/api/v1/mcp/apps/:slug', async (c) => {
    if (!isPerAppMcpEnabled()) return c.json({ error: 'disabled' }, 404);
    const registration = deps.load(c.req.param('slug'));
    if (!registration) return c.json({ error: 'unknown_app' }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse_error' } }, 400);
    }
    const envelope = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const id = envelope.id ?? null;
    if (envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid_request' } }, 400);
    }
    const params = (envelope.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (envelope.method === 'tools/list') {
      const auth = await authenticate(c.req.raw, registration);
      if (!auth.ok) {
        if (auth.challenge) return auth.challenge as unknown as Response;
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: auth.error } }, auth.status);
      }
      if (!auth.principal.scopes.includes(MCP_SCOPES.DISCOVER) &&
        !auth.principal.scopes.includes(MCP_SCOPES.TOOLS_INVOKE)) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: 'insufficient_scope' } }, 403);
      }
      return c.json({ jsonrpc: '2.0', id, result: { tools: buildPerAppToolList(registration) } });
    }
    if (envelope.method === 'tools/call') {
      const auth = await authenticate(c.req.raw, registration);
      if (!auth.ok) {
        if (auth.challenge) return auth.challenge as unknown as Response;
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: auth.error } }, auth.status);
      }
      const tool = params.name;
      if (typeof tool !== 'string') {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid_params' } }, 400);
      }
      const listed = buildPerAppToolList(registration).some((entry) => entry.name === tool);
      if (!listed) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown_tool' } }, 404);
      }
      if (!isToolPermitted(auth.principal.clientId, tool)) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: 'tool_not_permitted' } }, 403);
      }
      const needsInvoke = isWriteTool(tool);
      if (needsInvoke && !auth.principal.scopes.includes(MCP_SCOPES.TOOLS_INVOKE)) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: 'insufficient_scope' } }, 403);
      }
      if (!needsInvoke && !auth.principal.scopes.includes(MCP_SCOPES.DISCOVER) &&
        !auth.principal.scopes.includes(MCP_SCOPES.TOOLS_INVOKE)) {
        return c.json({ jsonrpc: '2.0', id, error: { code: -32003, message: 'insufficient_scope' } }, 403);
      }
      return c.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'tool_not_wired' } }, 501);
    }
    return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_found' } }, 404);
  });

  router.get('/api/v1/mcp/apps/:slug/.well-known/oauth-protected-resource', (c) => {
    const registration = deps.load(c.req.param('slug'));
    if (!registration || !isPerAppMcpEnabled()) return c.json({ error: 'unknown_app' }, 404);
    return c.json(perAppMcpAuth(registration).metadata());
  });

  return router;
}
