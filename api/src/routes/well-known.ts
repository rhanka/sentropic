import { createWellKnownRouter } from '@sentropic/auth-hono';
import { ALL_MCP_SCOPES } from '@sentropic/mcp-auth';
import { Hono, type Context } from 'hono';

import { getSentropicOAuthPorts, resolveOAuthIssuer } from './auth/oauth';

export const wellKnownRouter = new Hono();

wellKnownRouter.get('/openid-configuration', (c) =>
  forwardToWellKnownRouter(c, '/openid-configuration'),
);
wellKnownRouter.get('/jwks.json', (c) => forwardToWellKnownRouter(c, '/jwks.json'));
wellKnownRouter.get('/oauth-authorization-server', (c) =>
  forwardToWellKnownRouter(c, '/oauth-authorization-server'),
);

const forwardToWellKnownRouter = (c: Context, path: string): Response | Promise<Response> => {
  const url = new URL(c.req.url);
  url.pathname = path;
  url.search = '';

  const router = createWellKnownRouter({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: getSentropicOAuthPorts(),
    // This authorization server grants the MCP scope grammar to allowlisted clients, so RFC 8414
    // requires it to say so: a client that cross-checks its requested scopes against
    // `scopes_supported` refuses a scope missing from the list, even though `authorize` would
    // have granted it (`authorize-handler.ts:358` gates on the client's own allowlist, not on
    // this document). Advertising without granting is safe — the per-client allowlist still
    // decides — whereas granting without advertising is what breaks discovery.
    //
    // Unconditional, NOT gated on MCP_RESOURCE_SERVER_ENABLED. That flag lives in the `api`
    // ConfigMap; the standalone IdP that actually serves this document in a deployed tier has its
    // own ConfigMap and never sets it, so gating would leave the deployed AS advertising nothing.
    // `scopes_supported` describes what this AS can grant, not whether some resource server is
    // currently mounted.
    additionalScopesSupported: ALL_MCP_SCOPES,
  });

  return router.fetch(
    new Request(url, {
      headers: c.req.raw.headers,
      method: 'GET',
    }),
  );
};
