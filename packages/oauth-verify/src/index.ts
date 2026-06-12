// @sentropic/oauth-verify — PUBLIC CONTRACT.
//
// This file is the shared contract between Lot 1 (implements it, moving auth-hono's
// duplicated verify paths here) and Lot 3 (@sentropic/mcp-auth consumes it). Keep the
// EXPORTED signatures stable; coordinate any change. Architect verdict §10:
// verify-only — NO issuer/signing/PRM logic, NO MCP scope grammar (that lives in mcp-auth).

import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type KeyLike,
} from 'jose';

// ---------------------------------------------------------------------------
// Canonical claim types (shared by issuer auth-hono AND resource-server mcp-auth)
// ---------------------------------------------------------------------------

export type IdentityType = 'user' | 'service' | 'agent' | 'nhi' | 'mcp_connector';

/** Delegation actor. `h2a_eng` is an OPAQUE engagement reference — never parsed/validated here (IdP↔h2a seam). */
export interface ActClaim {
  sub: string;
  iss: string;
  h2a_eng?: string;
}

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  scope?: string;
  client_id?: string;
  /** Tenant claim (BR-39e). */
  tid?: string;
  /** Delegation chain (RFC 8693). */
  act?: ActClaim;
  /** DPoP confirmation thumbprint (RFC 9449). */
  cnf?: { jkt: string };
  acr?: string;
  auth_time?: number;
}

// ---------------------------------------------------------------------------
// Key source port — BYO: a remote JWKS (external resource servers) or an
// in-process JWKS provider (auth-hono's DB-backed JwksPort).
// ---------------------------------------------------------------------------

export interface TokenKeyHeader {
  kid?: string;
  alg?: string;
}

export interface TokenKeySource {
  /** Resolve the verification key for a token's protected header. */
  resolveKey(header: TokenKeyHeader): Promise<KeyLike | Uint8Array>;
}

/**
 * In-process JWKS provider shape (e.g. auth-hono's DB-backed JwksPort). Resolution is by
 * `kid`: the access-token protected header carries a `kid` and the provider returns the
 * matching key. `findKeyByKid` is the canonical lookup; `getActiveKey` is the fallback when
 * a token omits `kid` (single active signing key).
 */
export interface JwksProviderLike {
  findKeyByKid(kid: string): Promise<JwksProviderKey | null>;
  getActiveKey(): Promise<JwksProviderKey | null>;
}

export interface JwksProviderKey {
  alg: string;
  publicJwk: JWK;
}

/** Remote JWKS key source (cached) — for external MCP resource servers. */
export function fromRemoteJwks(
  jwksUri: string,
  opts?: { cacheMaxAgeSec?: number },
): TokenKeySource {
  const remoteSet = createRemoteJWKSet(new URL(jwksUri), {
    ...(opts?.cacheMaxAgeSec !== undefined
      ? { cacheMaxAge: opts.cacheMaxAgeSec * 1000 }
      : {}),
  });
  return {
    async resolveKey(header) {
      try {
        return await remoteSet({ alg: header.alg, kid: header.kid });
      } catch (error) {
        throw new TokenVerifyError(
          `Unable to resolve signing key from remote JWKS: ${(error as Error).message}`,
        );
      }
    },
  };
}

/** In-process JWKS key source — wraps an existing provider (e.g. auth-hono JwksPort). */
export function fromJwksPort(jwksProvider: JwksProviderLike): TokenKeySource {
  return {
    async resolveKey(header) {
      const record = header.kid
        ? await jwksProvider.findKeyByKid(header.kid)
        : await jwksProvider.getActiveKey();
      if (!record) {
        throw new TokenVerifyError('Access token signing key is unknown.');
      }
      return importJWK(record.publicJwk, record.alg);
    },
  };
}

// ---------------------------------------------------------------------------
// Verification primitives
// ---------------------------------------------------------------------------

export class TokenVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenVerifyError';
  }
}

export class DpopVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DpopVerifyError';
  }
}

export interface VerifyAccessTokenOptions {
  token: string;
  keySource: TokenKeySource;
  /** Expected issuer(s). */
  issuer?: string | string[];
  /** Expected audience(s) — e.g. an MCP resource URI, or the userinfo endpoint. */
  audience?: string | string[];
  /** Scopes that must all be present. */
  requiredScopes?: string[];
  now?: Date;
}

/** Verify a signed access token; returns its validated claims or throws TokenVerifyError. */
export async function verifyAccessToken(
  opts: VerifyAccessTokenOptions,
): Promise<AccessTokenClaims> {
  let header: TokenKeyHeader;
  try {
    header = decodeProtectedHeader(opts.token);
  } catch {
    throw new TokenVerifyError('Access token header is invalid.');
  }

  const key = await opts.keySource.resolveKey(header);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(opts.token, key, {
      ...(opts.issuer !== undefined ? { issuer: opts.issuer } : {}),
      ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
      ...(opts.now !== undefined ? { currentDate: opts.now } : {}),
    }));
  } catch {
    throw new TokenVerifyError(
      'Access token is invalid, expired, or has the wrong issuer or audience.',
    );
  }

  const claims = payload as AccessTokenClaims;

  if (opts.requiredScopes && opts.requiredScopes.length > 0) {
    const granted = new Set(parseScopes(claims.scope));
    const missing = opts.requiredScopes.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new TokenVerifyError(`Missing required scope: ${missing.join(' ')}.`);
    }
  }

  return claims;
}

/** Split an OAuth `scope` string into its individual scope tokens. */
export function parseScopes(scope: unknown): string[] {
  return typeof scope === 'string' ? scope.split(/\s+/u).filter(Boolean) : [];
}

export interface VerifyDpopProofOptions {
  proof: string;
  htm: string;
  htu: string;
  /** Bind to an access token (ath claim) when present. */
  accessToken?: string;
  /** Expected key thumbprint (from the access token's cnf.jkt). */
  expectedJkt?: string;
  iatSkewSec?: number;
  now?: Date;
  /** Single-use jti guard; returns false if already seen. */
  replay?: (jti: string, expiresAt: Date) => Promise<boolean> | boolean;
}

export interface VerifiedDpop {
  jkt: string;
  jti: string;
}

/** Verify a DPoP proof (RFC 9449); returns the key thumbprint + jti or throws DpopVerifyError. */
export async function verifyDpopProof(
  opts: VerifyDpopProofOptions,
): Promise<VerifiedDpop> {
  let header: { jwk?: JWK; alg?: string; typ?: string };
  try {
    header = decodeProtectedHeader(opts.proof);
  } catch {
    throw new DpopVerifyError('DPoP proof header is invalid.');
  }

  const publicJwk = header.jwk;
  if (!publicJwk || !header.alg || header.typ !== 'dpop+jwt') {
    throw new DpopVerifyError('DPoP proof header is invalid.');
  }

  const key = await importJWK(publicJwk, header.alg);
  let payload: JWTPayload & { htm?: unknown; htu?: unknown; ath?: unknown };
  try {
    ({ payload } = await jwtVerify(opts.proof, key));
  } catch {
    throw new DpopVerifyError('DPoP proof signature is invalid.');
  }

  const skewSec = opts.iatSkewSec ?? 60;
  if (payload.htm !== opts.htm.toUpperCase()) {
    throw new DpopVerifyError('DPoP htm claim does not match the request method.');
  }
  if (payload.htu !== opts.htu) {
    throw new DpopVerifyError('DPoP htu claim does not match the request URL.');
  }
  if (!payload.jti || typeof payload.jti !== 'string') {
    throw new DpopVerifyError('DPoP jti claim is required.');
  }
  if (typeof payload.iat !== 'number') {
    throw new DpopVerifyError('DPoP iat claim is required.');
  }

  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(payload.iat - nowSeconds) > skewSec) {
    throw new DpopVerifyError('DPoP iat claim is outside the allowed skew.');
  }

  if (opts.accessToken !== undefined) {
    const expectedAth = await sha256Base64url(opts.accessToken);
    if (payload.ath !== expectedAth) {
      throw new DpopVerifyError('DPoP ath claim does not match the access token.');
    }
  }

  const jkt = await calculateJwkThumbprint(publicJwk);
  if (opts.expectedJkt !== undefined && jkt !== opts.expectedJkt) {
    throw new DpopVerifyError('DPoP proof key does not match the bound token.');
  }

  if (opts.replay) {
    const expiresAt = new Date(((opts.now ?? new Date()).getTime()) + skewSec * 1000);
    const recorded = await opts.replay(payload.jti, expiresAt);
    if (!recorded) {
      throw new DpopVerifyError('DPoP proof jti was already used.');
    }
  }

  return { jkt, jti: payload.jti };
}

const textEncoder = new TextEncoder();

const sha256Base64url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};
