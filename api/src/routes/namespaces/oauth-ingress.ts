import { createOAuthRouter, createWellKnownRouter } from '@sentropic/auth-hono';
import { ALL_MCP_SCOPES } from '@sentropic/mcp-auth';
import { Hono, type Context } from 'hono';

import {
  createSentropicOAuthOptions,
  getSentropicOAuthPorts,
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
  const forward = (c: Context) => createOAuthRouter({
    ...createSentropicOAuthOptions(c.req.raw),
    routePrefix: publicPath,
  }).fetch(c.req.raw);

  for (const [method, path] of OAUTH_ROUTES) ingress.on(method, path, forward);
  return ingress;
};

export const createSentropicWellKnownIngress = (oauthPublicPath: string): Hono => {
  const ingress = new Hono();
  const forward = (path: string) => (c: Context): Response | Promise<Response> => {
    const url = new URL(c.req.url);
    url.pathname = path;
    url.search = '';
    return createWellKnownRouter({
      issuer: resolveOAuthIssuer(c.req.raw),
      oauthPathPrefix: oauthPublicPath,
      ports: getSentropicOAuthPorts(),
      // MCP Protected Resource Metadata remains owned by createMcpAuth; this AS
      // projection only advertises the MCP scopes its allowlisted clients may receive.
      additionalScopesSupported: ALL_MCP_SCOPES,
    }).fetch(new Request(url, { headers: c.req.raw.headers, method: 'GET' }));
  };

  ingress.get('/openid-configuration', forward('/openid-configuration'));
  ingress.get('/oauth-authorization-server', forward('/oauth-authorization-server'));
  ingress.get('/jwks.json', forward('/jwks.json'));
  return ingress;
};
