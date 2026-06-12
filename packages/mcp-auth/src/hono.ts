// @sentropic/mcp-auth/hono — Hono adapter over the fetch-style core.
//
// Successor of auth-hono's `createRequireServiceAuth` (architect verdict E2/F8): the
// canonical RS middleware lives HERE; auth-hono keeps only a delegating compat wrapper.
// `hono` is an OPTIONAL peer dependency — only this subpath imports it.

import { Hono, type Context, type MiddlewareHandler } from 'hono';

import type { McpAuth, McpAuthContext } from './core.js';

// CANONICAL home of the service (S2S) RS middleware relocated from @sentropic/auth-hono
// (architect verdict E2/F8). auth-hono now re-exports these via a thin delegating wrapper.
export {
  createRequireServiceAuth,
  type CreateRequireServiceAuthOptions,
  type ServiceAuthClockPort,
  type ServiceAuthContext,
  type ServiceAuthDpopReplayPort,
  type ServiceAuthPorts,
} from './service-auth.js';

/**
 * Mount the RFC 9728 PRM well-known (`/.well-known/oauth-protected-resource`) on a Hono
 * router. `app.route('/', mcpAuthRoutes(mcp))`.
 */
export const mcpAuthRoutes = (mcp: McpAuth): Hono => {
  const router = new Hono();
  router.get('/.well-known/oauth-protected-resource', (c) => c.json(mcp.metadata(), 200, {
    'Cache-Control': 'public, max-age=300',
  }));
  return router;
};

export interface RequireMcpAuthOptions {
  requiredScopes?: string[];
  /** Context key the verified McpAuthContext is stored under (default 'mcpAuth'). */
  contextKey?: string;
}

/**
 * Guard a route with MCP resource-server authorization. On failure it returns the proper
 * 401/403 Response with `WWW-Authenticate` (resource_metadata + scope). On success it stores
 * the McpAuthContext under `contextKey` and continues.
 *
 *   app.use('/mcp/*', requireMcpAuth(mcp, { requiredScopes: ['mcp:tools:invoke'] }));
 */
export const requireMcpAuth = (mcp: McpAuth, opts?: RequireMcpAuthOptions): MiddlewareHandler => {
  const contextKey = opts?.contextKey ?? 'mcpAuth';
  return async (c, next) => {
    let auth: McpAuthContext;
    try {
      auth = await mcp.verify(c.req.raw, { requiredScopes: opts?.requiredScopes });
    } catch (error) {
      return mcp.challenge(error);
    }
    c.set(contextKey, auth);
    await next();
  };
};

/** Read the verified context a `requireMcpAuth` guard stored (default key 'mcpAuth'). */
export const getMcpAuthContext = (c: Context, contextKey = 'mcpAuth'): McpAuthContext =>
  c.get(contextKey) as McpAuthContext;
