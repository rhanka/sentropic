import type { Context } from 'hono';
import type { JWTPayload } from 'jose';

import type { AuthHonoPorts } from '../ports.js';
import { OAuthDpopProofError, verifyOAuthDpopProof } from './dpop.js';
import { oauthJsonError } from './http-utils.js';
import { createJwksService } from './jwks-service.js';
import type { TokenMeta } from './state-store-types.js';

export interface OAuthUserInfoHandlerOptions {
  dpopIatSkewSeconds?: number;
  issuer: string;
  ports: AuthHonoPorts;
}

export const createOAuthUserInfoHandler =
  (options: OAuthUserInfoHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const authorization = parseAccessToken(c.req.header('authorization'));
    if (!authorization) return unauthorized(c, 'Access token is required.');

    const payload = await verifyAccessToken(c, options, authorization.token);
    if (payload instanceof Response) return payload;

    const meta = await resolveActiveTokenMeta(c, options.ports, payload);
    if (meta instanceof Response) return meta;
    if (meta.dpopJkt) {
      const dpop = await verifyBoundDpop(c, options, authorization, meta);
      if (dpop instanceof Response) return dpop;
    }

    const scopes = meta.scope.split(/\s+/).filter(Boolean);
    if (scopes.some((scope) => !['openid', 'profile', 'email'].includes(scope))) {
      return unauthorized(c, 'Access token contains unsupported scopes.');
    }

    const user = await options.ports.users.findById(meta.userId);
    if (!user) return unauthorized(c, 'Access token user is invalid.');

    return c.json({
      sub: user.id,
      ...(scopes.includes('profile') ? { name: user.displayName } : {}),
      ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified } : {}),
    });
  };

const verifyAccessToken = async (
  c: Context,
  options: OAuthUserInfoHandlerOptions,
  token: string
): Promise<JWTPayload | Response> => {
  try {
    const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
    const result = await jwks.verifyJwt(token, {
      audience: `${trimTrailingSlash(options.issuer)}/api/v1/auth/oauth/userinfo`,
      currentDate: options.ports.clock.now(),
      issuer: trimTrailingSlash(options.issuer),
    });
    return result.payload;
  } catch {
    return unauthorized(c, 'Access token is invalid.');
  }
};

const resolveActiveTokenMeta = async (
  c: Context,
  ports: AuthHonoPorts,
  payload: JWTPayload
): Promise<TokenMeta | Response> => {
  const jti = payload.jti;
  if (!jti) return unauthorized(c, 'Access token jti is missing.');

  const meta = await ports.oauthStateStore.findTokenMeta(jti);
  if (
    !meta ||
    meta.tokenType !== 'access_token' ||
    meta.expiresAt <= ports.clock.now() ||
    (await ports.oauthStateStore.isTokenRevoked(jti))
  ) {
    return unauthorized(c, 'Access token is inactive.');
  }

  return meta;
};

const verifyBoundDpop = async (
  c: Context,
  options: OAuthUserInfoHandlerOptions,
  authorization: { scheme: 'Bearer' | 'DPoP'; token: string },
  meta: TokenMeta
): Promise<null | Response> => {
  const proof = c.req.header('dpop');
  if (authorization.scheme !== 'DPoP' || !proof) {
    return unauthorized(c, 'DPoP proof is required for this access token.');
  }

  try {
    const verified = await verifyOAuthDpopProof({
      accessToken: authorization.token,
      htm: c.req.method,
      htu: c.req.url,
      iatSkewSeconds: options.dpopIatSkewSeconds,
      ports: options.ports,
      proof,
    });
    if (verified.jkt !== meta.dpopJkt) {
      return unauthorized(c, 'DPoP proof key does not match the access token.');
    }
    return null;
  } catch (error) {
    if (error instanceof OAuthDpopProofError) {
      return unauthorized(c, error.message);
    }
    throw error;
  }
};

const parseAccessToken = (
  authorization: string | undefined
): { scheme: 'Bearer' | 'DPoP'; token: string } | null => {
  const [scheme, token, extra] = authorization?.split(/\s+/) ?? [];
  if (extra || !token || (scheme !== 'Bearer' && scheme !== 'DPoP')) return null;
  return { scheme, token };
};

const unauthorized = (c: Context, message: string): Response =>
  oauthJsonError(c, 401, 'invalid_token', message);

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
