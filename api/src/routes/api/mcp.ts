import { createMcpAuth, MCP_SCOPES, type McpAuth } from '@sentropic/mcp-auth';
import { mcpAuthRoutes, requireMcpAuth, getMcpAuthContext } from '@sentropic/mcp-auth/hono';
import { fromJwksPort } from '@sentropic/oauth-verify';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { env } from '../../config/env';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { createGmailConnectorHost } from '../../services/connector-host/gmail';
import { createGoogleConnectorHost } from '../../services/connector-host/google-drive';
import { resolveDefaultWorkspaceId } from '../../services/workspace-access';
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
    // The resource server and authorization server are co-located in this API. Reuse the
    // existing signing-key port rather than making a loopback JWKS request for every verifier.
    keySource: fromJwksPort(createJwksAdapter()),
    scopesSupported: [MCP_SCOPES.DISCOVER, MCP_SCOPES.RESOURCES_READ, MCP_SCOPES.TOOLS_INVOKE],
  });
  return cachedMcp;
};

export const mcpRouter = new Hono();

const connectorRequestSchema = z.object({
  connectorId: z.string().min(1),
  capabilityRef: z.string().min(1),
  input: z.unknown().optional(),
  accountSelectorHint: z.string().min(1).optional(),
  workspaceRef: z.string().min(1).optional(),
});

type ConnectorRequest = z.infer<typeof connectorRequestSchema>;

const missingConnectorResult = () => ({
  ok: false as const,
  auditId: 'connector-host-missing',
  redactionClass: 'none' as const,
  error: {
    code: 'connector_not_found',
    message: 'Connector capability not found.',
    retriable: false as const,
  },
});

const parseConnectorRequest = async (c: Context): Promise<ConnectorRequest | null> => {
  const body = await c.req.json().catch(() => undefined);
  const parsed = connectorRequestSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data;
};

const statusForConnectorResult = (result: { error?: { code?: unknown } }): 200 | 404 | 409 | 502 => {
  if (!result.error) return 200;
  if (result.error.code === 'connector_not_found') return 404;
  if (result.error.code === 'connector_secret_unavailable') return 409;
  return 502;
};

const connectorResponse = (c: Context, result: unknown): Response => {
  if (typeof result === 'string') return c.json({ ok: true, output: result }, 200);
  if (!result || typeof result !== 'object') return c.json(missingConnectorResult(), 404);
  return c.json(result, statusForConnectorResult(result as { error?: { code?: unknown } }));
};

const resolveConnectorRequest = async (c: Context, request: ConnectorRequest) => {
  const auth = getMcpAuthContext(c);
  // User access tokens set `sub` from `codePayload.userId` in
  // packages/auth-hono/src/oauth/token-handler.ts; this app maps that userId to `users.id` in
  // api/src/routes/auth/oauth.ts. Never read the cookie-session context on this public route.
  const userId = auth.sub;
  const workspaceId = request.workspaceRef ?? await resolveDefaultWorkspaceId(userId) ?? '';
  const sessionUser = { userId, workspaceId };
  const driver = request.connectorId === 'google-drive'
    ? createGoogleConnectorHost({ sessionUser })
    : createGmailConnectorHost({ sessionUser });

  return {
    driver,
    request: {
      sessionPrincipalSub: userId,
      requestedWorkspaceRef: request.workspaceRef,
      connectorId: request.connectorId,
      capabilityRef: request.capabilityRef,
      input: request.input ?? {},
      hints: request.accountSelectorHint ? { accountSelectorHint: request.accountSelectorHint } : undefined,
    },
  };
};

const invalidRequest = (c: Context): Response =>
  c.json({ error: { code: 'invalid_request', message: 'Request body is invalid.' } }, 400);

// 404 the whole surface while disabled (no public surface change by default).
mcpRouter.use('*', async (c, next) => {
  if (!isEnabled()) return c.json({ error: { code: 'not_found', message: 'MCP resource server is disabled.' } }, 404);
  await next();
});

// RFC 9728 PRM well-known, served under the MCP prefix.
mcpRouter.route('/', mcpAuthRoutes(getMcpAuth()));

// Guarded MCP tool endpoint — requires the mcp:tools:invoke scope.
mcpRouter.use('/invoke', requireMcpAuth(getMcpAuth(), { requiredScopes: [MCP_SCOPES.TOOLS_INVOKE] }));
mcpRouter.post('/invoke', async (c) => {
  const request = await parseConnectorRequest(c);
  if (!request) return invalidRequest(c);
  const { driver, request: hostRequest } = await resolveConnectorRequest(c, request);
  return connectorResponse(c, await driver.invoke(hostRequest));
});

// Guarded MCP resource endpoint — requires the mcp:resources:read scope.
mcpRouter.use('/resources/read', requireMcpAuth(getMcpAuth(), { requiredScopes: [MCP_SCOPES.RESOURCES_READ] }));
mcpRouter.post('/resources/read', async (c) => {
  const request = await parseConnectorRequest(c);
  if (!request) return invalidRequest(c);
  const { driver, request: hostRequest } = await resolveConnectorRequest(c, request);
  return connectorResponse(c, await driver.readResource(hostRequest));
});
