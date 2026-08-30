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
  // The authorization server is NOT always this api. `authorizationServers` is used twice: it is
  // published in the RFC 9728 PRM, where a client reads it to find the RFC 8414 metadata it must
  // fetch, AND it is the expected `iss` of every access token (mcp-auth `core.ts:158`). Both only
  // work if it names the host that actually issues the tokens and serves the metadata.
  //
  // Where a standalone IdP is deployed on its own host, that IdP is the AS and this api is only
  // the resource server. Defaulting to this api's issuer then advertises a host that serves no
  // AS metadata at all — on preprod the product host proxies ONLY `^/api/v1/.*` to the api
  // (`ui/nginx/default.conf:22`), so `/.well-known/*` never reaches this router and answers 404.
  // Absent ⇒ the co-located shape (dev/test), which is what the fallback preserves.
  const authorizationServer = env.MCP_AUTHORIZATION_SERVER_URL ?? issuer;
  cachedMcp = createMcpAuth({
    resource,
    authorizationServers: [authorizationServer],
    // Verify with the LOCAL signing-key port rather than a loopback JWKS request. This stays
    // correct when the AS is the standalone IdP: it runs the same image against the same database
    // and shares the JWKS rows and OAUTH_SIGNING_KEK (`deploy/k8s/base/35-auth-idp.yaml`), so the
    // keys resolved here are the very keys that signed the token.
    keySource: fromJwksPort(createJwksAdapter()),
    scopesSupported: [MCP_SCOPES.DISCOVER, MCP_SCOPES.RESOURCES_READ, MCP_SCOPES.TOOLS_INVOKE],
  });
  return cachedMcp;
};
