import { Hono } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { createJwksService } from './jwks-service.js';

/** The OIDC core scopes every deployment of this authorization server can grant. */
export const DEFAULT_SCOPES_SUPPORTED: readonly string[] = Object.freeze(['openid', 'profile', 'email']);

export interface CreateWellKnownRouterOptions {
  issuer: string;
  oauthPathPrefix?: string;
  ports: AuthHonoPorts;
  /**
   * Scope values this authorization server can grant, beyond the OIDC core (RFC 8414
   * `scopes_supported`). Supplied by the HOST, never enumerated here: this package is the generic
   * OAuth core and must not know the vocabularies of the resource servers built on top of it —
   * the same separation `@sentropic/mcp-auth` keeps for its own scope grammar.
   *
   * A client that cross-checks the scopes it requests against this list is refused when a
   * grantable scope is missing from it, so anything a deployment's clients are allowlisted for
   * belongs here. Deduplicated, order preserved.
   */
  additionalScopesSupported?: readonly string[];
}

/**
 * Single source of truth for the authorization-server / OpenID Provider metadata document.
 * Served verbatim at BOTH `/.well-known/openid-configuration` (OIDC Discovery) and
 * `/.well-known/oauth-authorization-server` (RFC 8414 alias — some clients, e.g. claude.ai,
 * only probe the 8414 path). NO `registration_endpoint` is advertised: Dynamic Client
 * Registration (RFC 7591) is deferred; go-live uses pre-registered static clients.
 */
export const buildAuthorizationServerMetadata = (
  issuer: string,
  oauthPrefix: string,
  additionalScopesSupported: readonly string[] = [],
): Record<string, unknown> => ({
  authorization_endpoint: `${issuer}${oauthPrefix}/authorize`,
  // RFC 9207 (authorization-response `iss`): advertised so a mix-up-defending client (claude.ai)
  // knows this AS emits, and it can validate, the `iss` parameter on the authorization response.
  authorization_response_iss_parameter_supported: true,
  claims_supported: ['sub', 'aud', 'iss', 'exp', 'iat', 'nonce', 'auth_time', 'acr', 'email', 'email_verified', 'name', 'tid'],
  code_challenge_methods_supported: ['S256'],
  dpop_signing_alg_values_supported: ['EdDSA'],
  end_session_endpoint: `${issuer}${oauthPrefix}/end_session`,
  grant_types_supported: ['authorization_code', 'client_credentials'],
  id_token_signing_alg_values_supported: ['EdDSA'],
  introspection_endpoint: `${issuer}${oauthPrefix}/introspect`,
  issuer,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
  response_types_supported: ['code'],
  revocation_endpoint: `${issuer}${oauthPrefix}/revoke`,
  scopes_supported: [...new Set([...DEFAULT_SCOPES_SUPPORTED, ...additionalScopesSupported])],
  subject_types_supported: ['public'],
  token_endpoint: `${issuer}${oauthPrefix}/token`,
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  userinfo_endpoint: `${issuer}${oauthPrefix}/userinfo`,
});

export const createWellKnownRouter = (options: CreateWellKnownRouterOptions): Hono => {
  const router = new Hono();
  const issuer = trimTrailingSlash(options.issuer);
  const oauthPrefix = normalizePathPrefix(options.oauthPathPrefix ?? '/api/v1/auth/oauth');
  const metadata = buildAuthorizationServerMetadata(
    issuer,
    oauthPrefix,
    options.additionalScopesSupported ?? [],
  );

  // OIDC Discovery + the RFC 8414 alias resolve to the identical metadata document.
  router.get('/openid-configuration', (c) => c.json(metadata));
  router.get('/oauth-authorization-server', (c) => c.json(metadata));

  router.get('/jwks.json', async (c) => {
    const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(await jwks.getPublicJwks());
  });

  return router;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');

const normalizePathPrefix = (value: string): string => {
  const trimmed = value.replace(/^\/+|\/+$/gu, '');
  return trimmed ? `/${trimmed}` : '';
};
