import type { Context } from 'hono';
import type { JWTPayload } from 'jose';

import type { AuthHonoPorts } from '../ports.js';
import { oauthJsonError } from './http-utils.js';
import { createJwksService } from './jwks-service.js';

export interface OAuthIntrospectHandlerOptions {
  issuer: string;
  ports: AuthHonoPorts;
}

export const createOAuthIntrospectHandler =
  (options: OAuthIntrospectHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const authenticated = await authenticateIntrospectionClient(c, options.ports);
    if (authenticated instanceof Response) return authenticated;

    const form = new URLSearchParams(await c.req.text());
    const token = form.get('token');
    if (!token) return c.json({ active: false });

    const payload = await verifyToken(options, token);
    if (!payload?.jti) return c.json({ active: false });

    const meta = await options.ports.oauthStateStore.findTokenMeta(payload.jti);
    if (
      !meta ||
      meta.expiresAt <= options.ports.clock.now() ||
      (await options.ports.oauthStateStore.isTokenRevoked(payload.jti))
    ) {
      return c.json({ active: false });
    }

    return c.json({
      active: true,
      aud: meta.audience,
      client_id: meta.clientId,
      ...(meta.dpopJkt ? { cnf: { jkt: meta.dpopJkt } } : {}),
      exp: toEpochSeconds(meta.expiresAt),
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      jti: meta.jti,
      scope: meta.scope,
      sub: meta.userId,
      token_type: meta.tokenType,
    });
  };

const authenticateIntrospectionClient = async (
  c: Context,
  ports: AuthHonoPorts
): Promise<true | Response> => {
  const authorization = c.req.header('authorization');
  if (!authorization?.startsWith('Basic ')) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication is required.');
  }

  const decoded = atob(authorization.slice('Basic '.length));
  const separator = decoded.indexOf(':');
  const clientId = separator >= 0 ? decoded.slice(0, separator) : decoded;
  const secret = separator >= 0 ? decoded.slice(separator + 1) : '';
  const client = await ports.oauthStateStore.findClient(clientId);
  if (!client?.clientSecretHash || (await ports.tokens.hashSecret(secret)) !== client.clientSecretHash) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  }

  return true;
};

const verifyToken = async (
  options: OAuthIntrospectHandlerOptions,
  token: string
): Promise<JWTPayload | null> => {
  try {
    const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
    const result = await jwks.verifyJwt(token, {
      currentDate: options.ports.clock.now(),
      issuer: trimTrailingSlash(options.issuer),
    });
    return result.payload;
  } catch {
    return null;
  }
};

const toEpochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
