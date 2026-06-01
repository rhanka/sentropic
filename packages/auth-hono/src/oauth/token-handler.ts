import type { Context } from 'hono';

import type { AuthHonoPorts, AuthHonoUserRecord } from '../ports.js';
import { createJwksService } from './jwks-service.js';
import { oauthJsonError } from './http-utils.js';
import { sha256Base64url } from './crypto-utils.js';
import { OAuthDpopProofError, verifyOAuthDpopProof } from './dpop.js';
import type { AuthCodePayload, OauthClientRecord, TokenMeta } from './state-store-types.js';

export interface OAuthTokenHandlerOptions {
  accessTokenTtlSeconds?: number;
  dpopIatSkewSeconds?: number;
  idTokenTtlSeconds?: number;
  issuer: string;
  ports: AuthHonoPorts;
}

interface ClientAuthentication {
  client: OauthClientRecord;
  secret?: string;
}

export const createOAuthTokenHandler =
  (options: OAuthTokenHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const form = new URLSearchParams(await c.req.text());
    if (form.get('grant_type') !== 'authorization_code') {
      return oauthJsonError(c, 400, 'unsupported_grant_type', 'Only authorization_code grant is supported.');
    }

    const auth = await authenticateClient(c, form, options.ports);
    if (auth instanceof Response) return auth;

    const codePayload = await options.ports.oauthStateStore.consumeAuthCode(form.get('code') ?? '');
    if (!codePayload || codePayload.clientId !== auth.client.clientId) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Authorization code is invalid or already used.');
    }
    if (form.get('redirect_uri') !== codePayload.redirectUri) {
      return oauthJsonError(c, 400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
    }
    if ((await sha256Base64url(form.get('code_verifier') ?? '')) !== codePayload.codeChallenge) {
      return oauthJsonError(c, 400, 'invalid_grant', 'PKCE verification failed.');
    }

    const dpopJkt = await resolveDpopJkt(c, options, auth.client, codePayload);
    if (dpopJkt instanceof Response) return dpopJkt;

    const user = await options.ports.users.findById(codePayload.userId);
    if (!user) return oauthJsonError(c, 400, 'invalid_grant', 'Authorization code user is invalid.');

    const tokens = await issueTokens(options, auth.client, codePayload, user, dpopJkt);
    return c.json(tokens);
  };

const authenticateClient = async (
  c: Context,
  form: URLSearchParams,
  ports: AuthHonoPorts
): Promise<ClientAuthentication | Response> => {
  const credentials = parseClientCredentials(c.req.header('authorization'), form);
  if (!credentials.clientId) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication is required.');
  }

  const client = await ports.oauthStateStore.findClient(credentials.clientId);
  if (!client) return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');

  if (client.tokenEndpointAuthMethod === 'none') {
    return { client };
  }

  if (!credentials.secret || !client.clientSecretHash) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client secret is required.');
  }

  const secretHash = await ports.tokens.hashSecret(credentials.secret);
  if (secretHash !== client.clientSecretHash) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  }

  return { client, secret: credentials.secret };
};

const parseClientCredentials = (
  authorization: string | undefined,
  form: URLSearchParams
): { clientId: string | null; secret?: string } => {
  if (authorization?.startsWith('Basic ')) {
    const decoded = atob(authorization.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    return {
      clientId: separator >= 0 ? decoded.slice(0, separator) : decoded,
      secret: separator >= 0 ? decoded.slice(separator + 1) : '',
    };
  }

  return {
    clientId: form.get('client_id'),
    secret: form.get('client_secret') ?? undefined,
  };
};

const resolveDpopJkt = async (
  c: Context,
  options: OAuthTokenHandlerOptions,
  client: OauthClientRecord,
  codePayload: AuthCodePayload
): Promise<string | null | Response> => {
  if (!client.dpopBoundAccessTokens) return null;

  const proof = c.req.header('dpop');
  if (!proof) return oauthJsonError(c, 400, 'invalid_dpop_proof', 'DPoP proof is required.');

  try {
    const verified = await verifyOAuthDpopProof({
      htm: 'POST',
      htu: c.req.url,
      iatSkewSeconds: options.dpopIatSkewSeconds,
      ports: options.ports,
      proof,
    });
    if (codePayload.dpopJkt && codePayload.dpopJkt !== verified.jkt) {
      return oauthJsonError(c, 400, 'invalid_grant', 'DPoP key does not match the authorization code.');
    }
    return verified.jkt;
  } catch (error) {
    if (error instanceof OAuthDpopProofError) {
      return oauthJsonError(c, 400, 'invalid_dpop_proof', error.message);
    }
    throw error;
  }
};

const issueTokens = async (
  options: OAuthTokenHandlerOptions,
  client: OauthClientRecord,
  codePayload: AuthCodePayload,
  user: AuthHonoUserRecord,
  dpopJkt: string | null
) => {
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 3600;
  const idTokenTtlSeconds = options.idTokenTtlSeconds ?? 3600;
  const now = options.ports.clock.now();
  const accessExpiresAt = options.ports.clock.addSeconds(now, accessTokenTtlSeconds);
  const idExpiresAt = options.ports.clock.addSeconds(now, idTokenTtlSeconds);
  const scopes = codePayload.scope.split(/\s+/).filter(Boolean);
  const cnf = dpopJkt ? { jkt: dpopJkt } : undefined;
  const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
  const accessJti = options.ports.random.uuid();
  const accessAudience = `${trimTrailingSlash(options.issuer)}/api/v1/auth/oauth/userinfo`;
  const accessToken = await jwks.signJwt(
    {
      acr: codePayload.acr,
      auth_time: toEpochSeconds(codePayload.authTime),
      client_id: client.clientId,
      ...(cnf ? { cnf } : {}),
      scope: codePayload.scope,
    },
    {
      audience: accessAudience,
      expiresAt: accessExpiresAt,
      issuer: trimTrailingSlash(options.issuer),
      jti: accessJti,
      subject: codePayload.userId,
      type: 'JWT',
    }
  );

  await options.ports.oauthStateStore.saveTokenMeta(
    accessJti,
    tokenMeta({
      audience: accessAudience,
      client,
      codePayload,
      dpopJkt,
      expiresAt: accessExpiresAt,
      jti: accessJti,
      tokenType: 'access_token',
    }),
    accessTokenTtlSeconds
  );

  const response: Record<string, unknown> = {
    access_token: accessToken,
    expires_in: accessTokenTtlSeconds,
    scope: codePayload.scope,
    token_type: dpopJkt ? 'DPoP' : 'Bearer',
  };

  if (scopes.includes('openid')) {
    const idJti = options.ports.random.uuid();
    const idToken = await jwks.signJwt(
      {
        acr: codePayload.acr,
        auth_time: toEpochSeconds(codePayload.authTime),
        ...(cnf ? { cnf } : {}),
        ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified } : {}),
        ...(scopes.includes('profile') ? { name: user.displayName } : {}),
        ...(codePayload.nonce ? { nonce: codePayload.nonce } : {}),
      },
      {
        audience: client.clientId,
        expiresAt: idExpiresAt,
        issuer: trimTrailingSlash(options.issuer),
        jti: idJti,
        subject: codePayload.userId,
        type: 'JWT',
      }
    );
    response.id_token = idToken;
    await options.ports.oauthStateStore.saveTokenMeta(
      idJti,
      tokenMeta({
        audience: client.clientId,
        client,
        codePayload,
        dpopJkt,
        expiresAt: idExpiresAt,
        jti: idJti,
        tokenType: 'id_token',
      }),
      idTokenTtlSeconds
    );
  }

  return response;
};

const tokenMeta = (input: {
  audience: string;
  client: OauthClientRecord;
  codePayload: AuthCodePayload;
  dpopJkt: string | null;
  expiresAt: Date;
  jti: string;
  tokenType: 'access_token' | 'id_token';
}): TokenMeta => ({
  audience: input.audience,
  clientId: input.client.clientId,
  createdAt: input.codePayload.createdAt,
  dpopJkt: input.dpopJkt,
  expiresAt: input.expiresAt,
  jti: input.jti,
  scope: input.codePayload.scope,
  tenantId: input.codePayload.tenantId,
  tokenType: input.tokenType,
  userId: input.codePayload.userId,
});

const toEpochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
