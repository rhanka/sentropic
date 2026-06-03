import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import type { Context, MiddlewareHandler } from 'hono';

import type { AuthHonoClockPort } from '../ports.js';
import { sha256Base64url } from './crypto-utils.js';
import type { JwksPort, OauthStateStorePort } from './state-store-types.js';

/**
 * Narrow port set for resource-server verification (BR39d-D6). Resource servers
 * must not construct users/credentials/sessions/email ports just to verify a
 * bearer or DPoP-bound access token.
 */
export interface ServiceAuthPorts {
  clock: AuthHonoClockPort;
  jwks: JwksPort;
  dpopReplay?: Pick<OauthStateStorePort, 'recordDpopJti'>;
}

export interface ServiceAuthContext {
  clientId: string;
  scopes: string[];
  jkt: string | null;
}

export interface CreateRequireServiceAuthOptions {
  issuer: string;
  requiredScopes?: string[];
  resource: string;
  ports: ServiceAuthPorts;
  /** DPoP proof iat acceptance window in seconds (default 60). */
  dpopIatSkewSeconds?: number;
  /** Context key the verified service-client context is stored under (default 'serviceClient'). */
  contextKey?: string;
}

class ServiceAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
    message: string,
    readonly scheme: 'Bearer' | 'DPoP' = 'Bearer'
  ) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}

export const createRequireServiceAuth = (
  options: CreateRequireServiceAuthOptions
): MiddlewareHandler => {
  const issuer = trimTrailingSlash(options.issuer);
  const requiredScopes = options.requiredScopes ?? [];
  const contextKey = options.contextKey ?? 'serviceClient';

  return async (c, next) => {
    try {
      const { scheme, token } = parseAuthorization(c.req.header('authorization'));
      const payload = await verifyAccessToken(token, options.ports, issuer, options.resource);
      const scopes = parseScopes(payload.scope);
      assertScopes(scopes, requiredScopes);

      const jkt = await enforceDpop(c, payload, token, scheme, options);

      const serviceContext: ServiceAuthContext = {
        clientId: typeof payload.client_id === 'string' ? payload.client_id : String(payload.sub ?? ''),
        jkt,
        scopes,
      };
      c.set(contextKey, serviceContext);

      await next();
    } catch (error) {
      if (error instanceof ServiceAuthError) {
        return serviceAuthErrorResponse(c, error);
      }
      throw error;
    }
  };
};

const parseAuthorization = (header: string | undefined): { scheme: 'Bearer' | 'DPoP'; token: string } => {
  if (!header) {
    throw new ServiceAuthError(401, 'invalid_token', 'Authorization header is required.');
  }
  const [scheme, token] = header.split(/\s+/, 2);
  if (!token) {
    throw new ServiceAuthError(401, 'invalid_token', 'Authorization header is malformed.');
  }
  if (scheme === 'Bearer') return { scheme: 'Bearer', token };
  if (scheme === 'DPoP') return { scheme: 'DPoP', token };
  throw new ServiceAuthError(401, 'invalid_token', 'Unsupported authorization scheme.');
};

const verifyAccessToken = async (
  token: string,
  ports: ServiceAuthPorts,
  issuer: string,
  resource: string
): Promise<JWTPayload & { scope?: unknown; client_id?: unknown; cnf?: { jkt?: string } }> => {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    throw new ServiceAuthError(401, 'invalid_token', 'Access token header is invalid.');
  }
  if (!kid) {
    throw new ServiceAuthError(401, 'invalid_token', 'Access token is missing a key id.');
  }

  const key = await ports.jwks.findKeyByKid(kid);
  if (!key) {
    throw new ServiceAuthError(401, 'invalid_token', 'Access token signing key is unknown.');
  }

  const publicKey = await importJWK(key.publicJwk, key.alg);
  const currentDate = ports.clock.now();
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      audience: resource,
      currentDate,
      issuer,
    });
    return payload;
  } catch {
    throw new ServiceAuthError(401, 'invalid_token', 'Access token is invalid, expired, or has the wrong audience.');
  }
};

const parseScopes = (scope: unknown): string[] =>
  typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : [];

const assertScopes = (scopes: string[], requiredScopes: string[]): void => {
  const granted = new Set(scopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new ServiceAuthError(403, 'insufficient_scope', `Missing required scope: ${missing.join(' ')}.`);
  }
};

const enforceDpop = async (
  c: Context,
  payload: { cnf?: { jkt?: string } },
  accessToken: string,
  scheme: 'Bearer' | 'DPoP',
  options: CreateRequireServiceAuthOptions
): Promise<string | null> => {
  const boundJkt = payload.cnf?.jkt;
  if (!boundJkt) return null;

  if (scheme !== 'DPoP') {
    throw new ServiceAuthError(401, 'invalid_token', 'DPoP-bound token requires the DPoP authorization scheme.', 'DPoP');
  }

  const proof = c.req.header('dpop');
  if (!proof) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP proof is required.', 'DPoP');
  }

  const verifiedJkt = await verifyServiceDpopProof({
    accessToken,
    htm: c.req.method,
    htu: c.req.url,
    iatSkewSeconds: options.dpopIatSkewSeconds,
    ports: options.ports,
    proof,
  });

  if (verifiedJkt !== boundJkt) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP proof key does not match the bound token.', 'DPoP');
  }

  return verifiedJkt;
};

interface VerifyServiceDpopProofOptions {
  accessToken: string;
  htm: string;
  htu: string;
  iatSkewSeconds?: number;
  ports: ServiceAuthPorts;
  proof: string;
}

const verifyServiceDpopProof = async (options: VerifyServiceDpopProofOptions): Promise<string> => {
  const header = decodeProtectedHeader(options.proof);
  const publicJwk = header.jwk as JWK | undefined;
  if (!publicJwk || !header.alg || header.typ !== 'dpop+jwt') {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP proof header is invalid.', 'DPoP');
  }

  const key = await importJWK(publicJwk, header.alg);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(options.proof, key));
  } catch {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP proof signature is invalid.', 'DPoP');
  }

  const skew = options.iatSkewSeconds ?? 60;
  if (payload.htm !== options.htm.toUpperCase()) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP htm claim does not match the request method.', 'DPoP');
  }
  if (payload.htu !== options.htu) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP htu claim does not match the request URL.', 'DPoP');
  }
  if (!payload.jti || typeof payload.jti !== 'string') {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP jti claim is required.', 'DPoP');
  }
  if (typeof payload.iat !== 'number') {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP iat claim is required.', 'DPoP');
  }
  const nowSeconds = Math.floor(options.ports.clock.now().getTime() / 1000);
  if (Math.abs(payload.iat - nowSeconds) > skew) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP iat claim is outside the allowed skew.', 'DPoP');
  }

  // RFC 9449 §4.3: bind the proof to the access token (BR39d-D7).
  if (payload.ath !== (await sha256Base64url(options.accessToken))) {
    throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP ath claim does not match the access token.', 'DPoP');
  }

  if (options.ports.dpopReplay) {
    const expiresAt = options.ports.clock.addSeconds(options.ports.clock.now(), skew);
    const recorded = await options.ports.dpopReplay.recordDpopJti(payload.jti, expiresAt);
    if (!recorded) {
      throw new ServiceAuthError(401, 'invalid_dpop_proof', 'DPoP proof jti was already used.', 'DPoP');
    }
  }

  return calculateJwkThumbprint(publicJwk);
};

const serviceAuthErrorResponse = (c: Context, error: ServiceAuthError): Response => {
  c.header('WWW-Authenticate', buildWwwAuthenticate(error));
  return c.json({ error: { code: error.code, message: error.message } }, error.status);
};

const buildWwwAuthenticate = (error: ServiceAuthError): string => {
  const params = [`error="${error.code}"`, `error_description="${error.message}"`];
  return `${error.scheme} ${params.join(', ')}`;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
