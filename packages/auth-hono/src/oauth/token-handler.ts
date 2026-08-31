import type { Context } from 'hono';

import type { AuthHonoPorts, AuthHonoUserRecord } from '../ports.js';
import { createJwksService } from './jwks-service.js';
import { oauthJsonError } from './http-utils.js';
import { sha256Base64url } from './crypto-utils.js';
import { OAuthDpopProofError, verifyOAuthDpopProof } from './dpop.js';
import type { AuthCodePayload, OauthClientRecord, ServiceClientRecord, TokenMeta } from './state-store-types.js';

const DEFAULT_SERVICE_ACCESS_TOKEN_TTL_SECONDS = 900;

export interface OAuthTokenHandlerOptions {
  accessTokenTtlSeconds?: number;
  dpopIatSkewSeconds?: number;
  idTokenTtlSeconds?: number;
  issuer: string;
  ports: AuthHonoPorts;
  serviceAccessTokenTtlSeconds?: number;
}

interface ClientAuthentication {
  client: OauthClientRecord;
  secret?: string;
}

interface ServiceClientAuthentication {
  client: ServiceClientRecord;
  secret: string;
}

export const createOAuthTokenHandler =
  (options: OAuthTokenHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const form = new URLSearchParams(await c.req.text());
    const grantType = form.get('grant_type');
    if (grantType === 'client_credentials') {
      return handleClientCredentials(c, form, options);
    }
    if (grantType !== 'authorization_code') {
      return oauthJsonError(
        c,
        400,
        'unsupported_grant_type',
        'Only authorization_code and client_credentials grants are supported.'
      );
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

    const resourceError = validateTokenResource(c, form, codePayload);
    if (resourceError) return resourceError;

    const dpopJkt = await resolveDpopJkt(c, options, auth.client, codePayload);
    if (dpopJkt instanceof Response) return dpopJkt;

    const user = await options.ports.users.findById(codePayload.userId);
    if (!user) return oauthJsonError(c, 400, 'invalid_grant', 'Authorization code user is invalid.');

    const tokens = await issueTokens(
      options,
      auth.client,
      codePayload,
      user,
      dpopJkt,
      resolveUserinfoAudience(options.issuer, c.req.raw, '/token'),
    );
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

/**
 * RFC 8707 resource validation on the token leg of the `authorization_code` flow (BR-39l Lot 2).
 * - C1 single-aud: more than one `resource` value ⇒ `invalid_target`.
 * - C3 sealing: if the client re-sends `resource` on the token request (the MCP draft requires it
 *   on both legs), it MUST equal the value sealed at authorize time, else `invalid_grant`
 *   (audience downgrade/upgrade rejection). The `aud` is derived ONLY from the sealed value.
 * No `resource` on the token leg is accepted (the sealed value still governs `aud`).
 */
const validateTokenResource = (
  c: Context,
  form: URLSearchParams,
  codePayload: AuthCodePayload
): Response | null => {
  const requested = form.getAll('resource').filter((value) => value.length > 0);
  if (requested.length === 0) return null;
  if (requested.length > 1) {
    return oauthJsonError(c, 400, 'invalid_target', 'Only a single resource indicator is supported.');
  }
  if (requested[0] !== (codePayload.resource ?? null)) {
    return oauthJsonError(c, 400, 'invalid_grant', 'resource does not match the authorization request.');
  }
  return null;
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

const handleClientCredentials = async (
  c: Context,
  form: URLSearchParams,
  options: OAuthTokenHandlerOptions
): Promise<Response> => {
  const findServiceClient = options.ports.oauthStateStore.findServiceClient;
  if (!findServiceClient) {
    return oauthJsonError(c, 400, 'unsupported_grant_type', 'The client_credentials grant is not supported.');
  }

  const auth = await authenticateServiceClient(c, form, options.ports, findServiceClient);
  if (auth instanceof Response) return auth;

  const scope = resolveServiceScope(c, form, auth.client);
  if (scope instanceof Response) return scope;

  const resource = resolveResourceIndicator(c, form, auth.client);
  if (resource instanceof Response) return resource;

  const dpopJkt = await resolveServiceDpopJkt(c, options, auth.client);
  if (dpopJkt instanceof Response) return dpopJkt;

  // ARCH-11 G1c (spec §2.2): S2S on-behalf-of tenant. When no `serviceTenant` port is wired, or the
  // host policy returns `{ tid: null }` (alias/shadow), NO `tid` is emitted — byte-identical to the
  // pre-G1c stateless service token. Under strict the host validates `tenant` fail-closed.
  const oboTid = await resolveServiceObo(c, options, auth.client, form);
  if (oboTid instanceof Response) return oboTid;

  const tokens = await issueServiceToken(options, auth.client, scope, resource, dpopJkt, oboTid);
  return c.json(tokens);
};

const resolveServiceObo = async (
  c: Context,
  options: OAuthTokenHandlerOptions,
  client: ServiceClientRecord,
  form: URLSearchParams
): Promise<string | null | Response> => {
  if (!options.ports.serviceTenant) return null;
  const requested = form.get('tenant');
  const outcome = await options.ports.serviceTenant.resolveOboTenant({
    clientId: client.clientId,
    fixedTenantId: client.tenantId,
    requestedTenant: requested && requested.length > 0 ? requested : null,
  });
  if ('error' in outcome) {
    return oauthJsonError(c, 400, outcome.error, outcome.description);
  }
  return outcome.tid;
};

const authenticateServiceClient = async (
  c: Context,
  form: URLSearchParams,
  ports: AuthHonoPorts,
  findServiceClient: NonNullable<AuthHonoPorts['oauthStateStore']['findServiceClient']>
): Promise<ServiceClientAuthentication | Response> => {
  const credentials = parseClientCredentials(c.req.header('authorization'), form);
  if (!credentials.clientId || !credentials.secret) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication is required.');
  }

  const client = await findServiceClient(credentials.clientId);
  if (!client) return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');

  const secretHash = await ports.tokens.hashSecret(credentials.secret);
  if (secretHash !== client.clientSecretHash) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  }

  return { client, secret: credentials.secret };
};

const resolveServiceScope = (
  c: Context,
  form: URLSearchParams,
  client: ServiceClientRecord
): string | Response => {
  const requested = (form.get('scope') ?? '').split(/\s+/).filter(Boolean);
  if (requested.length === 0) {
    return client.allowedScopes.join(' ');
  }
  const allowed = new Set(client.allowedScopes);
  const unauthorized = requested.filter((scope) => !allowed.has(scope));
  if (unauthorized.length > 0) {
    return oauthJsonError(c, 400, 'invalid_scope', `Scope not allowed: ${unauthorized.join(' ')}.`);
  }
  return requested.join(' ');
};

const resolveResourceIndicator = (
  c: Context,
  form: URLSearchParams,
  client: ServiceClientRecord
): string | Response => {
  const requested = form.get('resource');
  const indicators = client.resourceIndicators;

  if (requested) {
    if (!indicators.includes(requested)) {
      return oauthJsonError(c, 400, 'invalid_target', 'Requested resource is not allowed for this client.');
    }
    return requested;
  }

  if (indicators.length === 1) {
    return indicators[0];
  }
  if (indicators.length === 0) {
    return oauthJsonError(c, 400, 'invalid_target', 'A resource indicator is required for this client.');
  }
  return oauthJsonError(c, 400, 'invalid_target', 'A resource indicator must be specified when multiple are allowed.');
};

const resolveServiceDpopJkt = async (
  c: Context,
  options: OAuthTokenHandlerOptions,
  client: ServiceClientRecord
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
    return verified.jkt;
  } catch (error) {
    if (error instanceof OAuthDpopProofError) {
      return oauthJsonError(c, 400, 'invalid_dpop_proof', error.message);
    }
    throw error;
  }
};

const issueServiceToken = async (
  options: OAuthTokenHandlerOptions,
  client: ServiceClientRecord,
  scope: string,
  resource: string,
  dpopJkt: string | null,
  oboTid: string | null
) => {
  const ttlSeconds = options.serviceAccessTokenTtlSeconds ?? DEFAULT_SERVICE_ACCESS_TOKEN_TTL_SECONDS;
  const now = options.ports.clock.now();
  const expiresAt = options.ports.clock.addSeconds(now, ttlSeconds);
  const cnf = dpopJkt ? { jkt: dpopJkt } : undefined;
  const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
  const accessJti = options.ports.random.uuid();
  const accessToken = await jwks.signJwt(
    {
      client_id: client.clientId,
      ...(cnf ? { cnf } : {}),
      // ARCH-11 G1c (§2.2): the validated on-behalf-of tenant. Absent (legacy/shadow) ⇒ no claim,
      // byte-identical to the pre-G1c token; mirrors the human-path `tid` (token-handler.ts:369).
      ...(oboTid ? { tid: oboTid } : {}),
      scope,
    },
    {
      audience: resource,
      expiresAt,
      issuer: trimTrailingSlash(options.issuer),
      jti: accessJti,
      subject: client.clientId,
      type: 'JWT',
    }
  );

  // Service tokens are stateless (BR39d-D5): no saveTokenMeta, no oauth_tokens row.
  return {
    access_token: accessToken,
    expires_in: ttlSeconds,
    scope,
    token_type: dpopJkt ? 'DPoP' : 'Bearer',
  };
};

const issueTokens = async (
  options: OAuthTokenHandlerOptions,
  client: OauthClientRecord,
  codePayload: AuthCodePayload,
  user: AuthHonoUserRecord,
  dpopJkt: string | null,
  userinfoAudience: string,
) => {
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 3600;
  const idTokenTtlSeconds = options.idTokenTtlSeconds ?? 3600;
  const now = options.ports.clock.now();
  const accessExpiresAt = options.ports.clock.addSeconds(now, accessTokenTtlSeconds);
  const idExpiresAt = options.ports.clock.addSeconds(now, idTokenTtlSeconds);
  const scopes = codePayload.scope.split(/\s+/).filter(Boolean);
  const cnf = dpopJkt ? { jkt: dpopJkt } : undefined;

  // BR-39e: bind the tenant claim to a STILL-`approved` membership at token time (lifecycle
  // gate). If the membership was suspended/revoked between authorize and token exchange, drop
  // the claim so no tenant-scoped token is issued for a non-member.
  let boundTenantId: string | null = codePayload.tenantId;
  if (boundTenantId && options.ports.tenant) {
    const stillApproved = await options.ports.tenant.isApprovedMember(codePayload.userId, boundTenantId);
    if (!stillApproved) boundTenantId = null;
  }

  const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
  const accessJti = options.ports.random.uuid();
  // BR-39l Lot 2 (C3/C4): variable RFC 8707 audience. The access-token `aud` is the resource
  // sealed at authorize time (single string), or the co-located userinfo URL by default. Deriving
  // it from the mounted token path keeps reusable composition roots distinct. The id_token `aud`
  // (client_id) is untouched.
  const accessAudience = codePayload.resource ?? userinfoAudience;
  const accessToken = await jwks.signJwt(
    {
      acr: codePayload.acr,
      auth_time: toEpochSeconds(codePayload.authTime),
      client_id: client.clientId,
      ...(cnf ? { cnf } : {}),
      ...(boundTenantId ? { tid: boundTenantId } : {}),
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
        ...(boundTenantId ? { tid: boundTenantId } : {}),
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

const resolveUserinfoAudience = (issuer: string, request: Request, suffix: string): string => {
  const path = new URL(request.url).pathname.replace(new RegExp(`${suffix}$`, 'u'), '/userinfo');
  return `${trimTrailingSlash(issuer)}${path}`;
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
