import { createMcpAuth, MCP_SCOPES, type McpAuth } from '@sentropic/mcp-auth';
import { mcpAuthRoutes, requireMcpAuth, getMcpAuthContext } from '@sentropic/mcp-auth/hono';
import { Hono } from 'hono';

import { env } from '../../config/env';
import { resolveOAuthIssuer } from '../auth/oauth';

/**
 * BR-39l Lot 3 — first real consumption of @sentropic/mcp-auth (activation-by-consumption).
 *
 * This is a SAMPLE MCP resource-server surface proving the library works end-to-end against
 * our own IdP (the api is co-located with the authorization server). It is gated OFF by
 * default (`MCP_RESOURCE_SERVER_ENABLED`) because it adds public app surface; enable it to
 * expose:
 *   - GET  /api/v1/mcp/.well-known/oauth-protected-resource  (RFC 9728 PRM)
 *   - POST /api/v1/mcp/invoke                                 (guarded; requires mcp:tools:invoke)
 *
 * The verify path delegates to @sentropic/oauth-verify. NOTE (Lot 1): oauth-verify's verify
 * primitives are a skeleton until Lot 1 merges — a real token round-trip activates then. The
 * unauthenticated paths (PRM serving, 401 challenge before key resolution) already work.
 */

// Read at request time (not import time) so the flag is dynamic per deployment and testable.
const isEnabled = (): boolean => {
  const flag = process.env.MCP_RESOURCE_SERVER_ENABLED ?? env.MCP_RESOURCE_SERVER_ENABLED;
  return flag === 'true' || flag === '1';
};

let cachedMcp: McpAuth | null = null;

const getMcpAuth = (request?: Request): McpAuth => {
  if (cachedMcp) return cachedMcp;
  const issuer = resolveOAuthIssuer(request);
  const resource = env.MCP_RESOURCE_URI ?? `${issuer}/api/v1/mcp`;
  cachedMcp = createMcpAuth({
    resource,
    authorizationServers: [issuer],
    scopesSupported: [MCP_SCOPES.DISCOVER, MCP_SCOPES.RESOURCES_READ, MCP_SCOPES.TOOLS_INVOKE],
  });
  return cachedMcp;
};

export const mcpRouter = new Hono();

// 404 the whole surface while disabled (no public surface change by default).
mcpRouter.use('*', async (c, next) => {
  if (!isEnabled()) return c.json({ error: { code: 'not_found', message: 'MCP resource server is disabled.' } }, 404);
  await next();
});

// RFC 9728 PRM well-known, served under the MCP prefix.
mcpRouter.route('/', mcpAuthRoutes(getMcpAuth()));

// Guarded sample MCP endpoint — requires the mcp:tools:invoke scope.
mcpRouter.use('/invoke', requireMcpAuth(getMcpAuth(), { requiredScopes: [MCP_SCOPES.TOOLS_INVOKE] }));
mcpRouter.post('/invoke', (c) => {
  const auth = getMcpAuthContext(c);
  return c.json({ ok: true, sub: auth.sub, tid: auth.tid, scopes: auth.scopes });
});
