// @sentropic/oauth-verify — PUBLIC CONTRACT (skeleton).
//
// This file is the shared contract between Lot 1 (implements it, moving auth-hono's
// duplicated verify paths here) and Lot 3 (@sentropic/mcp-auth consumes it). Keep the
// EXPORTED signatures stable; coordinate any change. Architect verdict §10:
// verify-only — NO issuer/signing/PRM logic, NO MCP scope grammar (that lives in mcp-auth).

import type { JWK, JWTPayload, KeyLike } from 'jose';

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

/** Remote JWKS key source (cached) — for external MCP resource servers. */
export function fromRemoteJwks(
  jwksUri: string,
  _opts?: { cacheMaxAgeSec?: number },
): TokenKeySource {
  void jwksUri;
  throw new Error('@sentropic/oauth-verify: fromRemoteJwks not implemented (Lot 1)');
}

/** In-process JWKS key source — wraps an existing provider (e.g. auth-hono JwksPort). */
export function fromJwksPort(
  jwksProvider: { getActiveKey(): Promise<{ jwk: JWK } | null>; listKeys?(): Promise<{ jwk: JWK }[]> },
): TokenKeySource {
  void jwksProvider;
  throw new Error('@sentropic/oauth-verify: fromJwksPort not implemented (Lot 1)');
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
export function verifyAccessToken(_opts: VerifyAccessTokenOptions): Promise<AccessTokenClaims> {
  throw new Error('@sentropic/oauth-verify: verifyAccessToken not implemented (Lot 1)');
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
export function verifyDpopProof(_opts: VerifyDpopProofOptions): Promise<VerifiedDpop> {
  throw new Error('@sentropic/oauth-verify: verifyDpopProof not implemented (Lot 1)');
}
