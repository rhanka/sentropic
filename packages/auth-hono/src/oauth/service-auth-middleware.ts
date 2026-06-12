// COMPAT WRAPPER (architect verdict E2/F8). The CANONICAL home of this RS middleware is now
// `@sentropic/mcp-auth/hono` (`createRequireServiceAuth`). auth-hono keeps this signature-stable
// wrapper — same behavior, sharing the SAME verification core (`@sentropic/oauth-verify`), no
// fourth copy of verify code — for ≥1 minor so pinned RPs are not forced to bump; it is dropped
// at auth-hono 1.0. The wrapper builds on oauth-verify primitives directly (NOT on mcp-auth) to
// respect the dependency DAG (auth-hono and mcp-auth never import each other).
import {
  DpopVerifyError,
  fromJwksPort,
  parseScopes,
  TokenVerifyError,
  verifyAccessToken,
  verifyDpopProof,
  type AccessTokenClaims,
} from '@sentropic/oauth-verify';
import type { Context, MiddlewareHandler } from 'hono';

import type { AuthHonoClockPort } from '../ports.js';
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
      const payload = await verifyServiceAccessToken(token, options.ports, issuer, options.resource);
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

/**
 * RS-side access-token verification. Delegates to `@sentropic/oauth-verify`'s shared
 * `verifyAccessToken` over an in-process JWKS key source, mapping any failure onto the
 * RFC 6750 `invalid_token` 401 the middleware emits.
 */
const verifyServiceAccessToken = async (
  token: string,
  ports: ServiceAuthPorts,
  issuer: string,
  resource: string
): Promise<AccessTokenClaims> => {
  try {
    return await verifyAccessToken({
      audience: resource,
      issuer,
      keySource: fromJwksPort(ports.jwks),
      now: ports.clock.now(),
      token,
    });
  } catch (error) {
    if (error instanceof TokenVerifyError) {
      throw new ServiceAuthError(401, 'invalid_token', 'Access token is invalid, expired, or has the wrong audience.');
    }
    throw error;
  }
};

const assertScopes = (scopes: string[], requiredScopes: string[]): void => {
  const granted = new Set(scopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new ServiceAuthError(403, 'insufficient_scope', `Missing required scope: ${missing.join(' ')}.`);
  }
};

const enforceDpop = async (
  c: Context,
  payload: { cnf?: { jkt: string } },
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

/**
 * RS-side DPoP proof verification. Delegates to `@sentropic/oauth-verify`'s shared
 * `verifyDpopProof`, wiring the optional RS replay port and remapping failures onto the
 * RFC 9449 `invalid_dpop_proof` 401. The `jkt`↔`cnf.jkt` binding is enforced by the caller
 * (`enforceDpop`) AFTER replay recording, preserving the original consume-then-compare order.
 */
const verifyServiceDpopProof = async (options: VerifyServiceDpopProofOptions): Promise<string> => {
  const iatSkewSec = options.iatSkewSeconds ?? 60;
  try {
    const { jkt } = await verifyDpopProof({
      accessToken: options.accessToken,
      htm: options.htm,
      htu: options.htu,
      iatSkewSec,
      now: options.ports.clock.now(),
      proof: options.proof,
      replay: options.ports.dpopReplay
        ? (jti) =>
            options.ports.dpopReplay!.recordDpopJti(
              jti,
              options.ports.clock.addSeconds(options.ports.clock.now(), iatSkewSec)
            )
        : undefined,
    });
    return jkt;
  } catch (error) {
    if (error instanceof DpopVerifyError) {
      throw new ServiceAuthError(401, 'invalid_dpop_proof', error.message, 'DPoP');
    }
    throw error;
  }
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
