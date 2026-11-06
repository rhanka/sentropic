import { createOAuthRouter, createWellKnownRouter, TOKEN_EXCHANGE_GRANT_TYPE } from '@sentropic/auth-hono';
import { ALL_MCP_SCOPES } from '@sentropic/mcp-auth';
import { Hono, type Context } from 'hono';
import { runCmAuthHttp } from './auth/cm-http';

import {
  createSentropicOAuthOptions,
  resolveOAuthIssuer,
} from '../auth/oauth';

const OAUTH_ROUTES = [
  ['GET', '/authorize'],
  ['GET', '/consent'],
  ['POST', '/consent/decision'],
  ['POST', '/token'],
  ['GET', '/userinfo'],
  ['POST', '/userinfo'],
  ['POST', '/revoke'],
  ['POST', '/introspect'],
  ['GET', '/end_session'],
] as const;

export const createSentropicOAuthIngress = (publicPath: string): Hono => {
  const ingress = new Hono();
  const forward = (c: Context) => runCmAuthHttp(c, null, binding => createOAuthRouter({
    ...createSentropicOAuthOptions(c.req.raw),
    ports: binding.ports,
    routePrefix: publicPath,
  }), undefined, { readOnly: c.req.method === 'GET' && c.req.path.endsWith('/consent') });

  for (const [method, path] of OAUTH_ROUTES) ingress.on(method, path, forward);
  return ingress;
};

export const createSentropicWellKnownIngress = (oauthPublicPath: string): Hono => {
  const ingress = new Hono();
  const forward = (path: string) => (c: Context): Response | Promise<Response> => {
    const url = new URL(c.req.url);
    const clientId = url.searchParams.get('client_id');
    url.pathname = path;
    url.search = '';
    if (clientId) url.searchParams.set('client_id', clientId);
    const target = new Request(url, { headers: c.req.raw.headers, method: 'GET' });
    // The store ports are attempt-bound like every other OAuth route: the host
    // bag has no transaction, so metadata reads run inside the CM attempt and
    // see the canonical path through a single-route shell.
    return runCmAuthHttp(c, null, binding => {
      const wellKnown = createWellKnownRouter({
        issuer: resolveOAuthIssuer(c.req.raw),
        oauthPathPrefix: oauthPublicPath,
        ports: binding.ports,
        // MCP Protected Resource Metadata remains owned by createMcpAuth; this AS
        // projection only advertises the MCP scopes its allowlisted clients may receive.
        // 2-IdP: the host side of Lot 3's scope correction — the union of generic MCP
        // scopes and the grantable Immo scopes. Metadata is descriptive and never
        // replaces client `allowedScopes`. The artifact scopes are granted by the
        // preprod immo-mcp client only (idp-identity-sync preprod divergence).
        additionalGrantTypesSupported: [TOKEN_EXCHANGE_GRANT_TYPE],
        additionalScopesSupported: [
          ...ALL_MCP_SCOPES,
          'immo:read',
          'immo:search',
          'immo:documents:read',
          'immo:artifacts:read',
          'immo:artifacts:write',
        ],
      });
      const shell = new Hono();
      shell.all('*', () => wellKnown.fetch(target.clone()));
      return shell;
    });
  };

  ingress.get('/openid-configuration', forward('/openid-configuration'));
  ingress.get('/oauth-authorization-server', forward('/oauth-authorization-server'));
  ingress.get('/jwks.json', forward('/jwks.json'));
  return ingress;
};
