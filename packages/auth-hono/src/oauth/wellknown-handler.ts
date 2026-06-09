import { Hono } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { createJwksService } from './jwks-service.js';

export interface CreateWellKnownRouterOptions {
  issuer: string;
  oauthPathPrefix?: string;
  ports: AuthHonoPorts;
}

export const createWellKnownRouter = (options: CreateWellKnownRouterOptions): Hono => {
  const router = new Hono();
  const issuer = trimTrailingSlash(options.issuer);
  const oauthPrefix = normalizePathPrefix(options.oauthPathPrefix ?? '/api/v1/auth/oauth');

  router.get('/openid-configuration', (c) =>
    c.json({
      authorization_endpoint: `${issuer}${oauthPrefix}/authorize`,
      claims_supported: ['sub', 'aud', 'iss', 'exp', 'iat', 'nonce', 'auth_time', 'acr', 'email', 'email_verified', 'name', 'tid'],
      code_challenge_methods_supported: ['S256'],
      dpop_signing_alg_values_supported: ['EdDSA'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      introspection_endpoint: `${issuer}${oauthPrefix}/introspect`,
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      revocation_endpoint: `${issuer}${oauthPrefix}/revoke`,
      scopes_supported: ['openid', 'profile', 'email'],
      subject_types_supported: ['public'],
      token_endpoint: `${issuer}${oauthPrefix}/token`,
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      userinfo_endpoint: `${issuer}${oauthPrefix}/userinfo`,
    })
  );

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
