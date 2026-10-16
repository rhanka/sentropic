import { createHash } from 'node:crypto';
import { ACCESS_TOKEN_TYPE, RFC8693_GRANT_TYPE } from './trust.js';
import type {
  TokenExchangePort,
  TokenExchangeRequest,
  TokenExchangeResponse,
} from './trust.js';

/** Hard cap on exchanged-token cache residency: entries never live longer than 60s. */
export const TOKEN_EXCHANGE_CACHE_TTL_MS = 60_000;

/** Hard ceiling on minted-token lifetime: no configuration may raise it. */
export const TOKEN_EXCHANGE_MAX_TTL_SEC = 300;

/** Default ceiling applied to minted-token TTL when no explicit ceiling is configured. */
export const DEFAULT_TOKEN_EXCHANGE_MAX_TTL_SEC = TOKEN_EXCHANGE_MAX_TTL_SEC;

/** Default bound on cached exchange entries (insertion-order eviction past capacity). */
export const DEFAULT_TOKEN_EXCHANGE_CACHE_MAX_ENTRIES = 1000;

/** Default early-use safety margin subtracted from every cache deadline. */
export const DEFAULT_TOKEN_EXCHANGE_EXPIRY_MARGIN_MS = 5_000;

/** Subject-token verification failure modes reported by the issuer binding. */
export type SubjectVerificationCode =
  | 'malformed'
  | 'invalid_signature'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'missing_subject'
  | 'expired'
  | 'actor_chained'
  | 'proof_bound';

/** Raised by the issuer binding when a subject token does not verify. */
export class SubjectVerificationError extends Error {
  constructor(public readonly verification: SubjectVerificationCode, detail?: string) {
    super(detail ?? `Subject token verification failed: ${verification}`);
    this.name = 'SubjectVerificationError';
  }
}

/** Verified subject-token claims consumed by exchange policy. */
export interface VerifiedSubjectToken {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: readonly string[];
  readonly issuedAtSec: number;
  readonly expiresAtSec: number;
  readonly scope: readonly string[];
  /** Originating client the subject token was issued to (`client_id`, when present). */
  readonly clientId?: string;
  /** Verified tenant/workspace membership context (when present). */
  readonly tenantId?: string | null;
  /** Subject-token identifier (when present). */
  readonly jti?: string;
}

/** Verified claims of a minted token, checked by the client before caching. */
export interface VerifiedMintedToken {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly clientId: string;
  readonly actorSub: string;
  readonly scope: readonly string[];
  readonly issuedAtSec: number;
  readonly expiresAtSec: number;
  readonly jti?: string;
}

/** Token material minted by the issuer binding. Never carries refresh material. */
export interface MintedToken {
  readonly accessToken: string;
  readonly tokenType?: 'Bearer';
  readonly issuedTokenType?: string;
  readonly expiresAtSec: number;
  readonly scope: readonly string[];
  /** Verified claims of the minted JWT; the client refuses the token without them. */
  readonly verified: VerifiedMintedToken;
}

export interface MintExchangedTokenInput {
  readonly subject: VerifiedSubjectToken;
  /** Raw subject token: only the trusted issuer call may carry it. */
  readonly subjectToken: string;
  readonly audience: string;
  readonly scope: readonly string[];
  /** Authenticated workload identity the issuer must assert as `act`. */
  readonly actorSub: string;
  /** Authenticated workload client id the issuer must assert as `client_id`. */
  readonly workloadClientId: string;
  readonly ttlSec: number;
  readonly nowSec: number;
}

/**
 * Issuer binding port. The cluster-mesh client owns policy (grant type, Bearer-only,
 * scope intersection, TTL ceiling, caching, never-passthrough); the binding owns
 * cryptographic trust (subject verification, token minting). The production binding
 * is the authenticated RFC 8693 HTTP adapter; test doubles implement this port.
 */
export interface TokenExchangeIssuer {
  verify(subjectToken: string): Promise<VerifiedSubjectToken>;
  mint(input: MintExchangedTokenInput): Promise<MintedToken>;
}

/** Every fail-closed refusal path of the exchange client. */
export type TokenExchangeRefusalReason =
  | 'grant_type_unsupported'
  | 'subject_token_type_unsupported'
  | 'requested_token_type_unsupported'
  | 'subject_token_missing'
  | 'audience_missing'
  | 'audience_not_allowed'
  | 'subject_unverified'
  | 'subject_expired'
  | 'subject_audience_invalid'
  | 'actor_invalid'
  | 'scope_empty'
  | 'scope_not_granted'
  | 'ttl_non_positive'
  | 'mint_failed'
  | 'mint_passthrough'
  | 'mint_refresh_present'
  | 'minted_token_invalid'
  | 'minted_token_type_unsupported'
  | 'minted_issuer_invalid'
  | 'minted_audience_invalid'
  | 'minted_subject_invalid'
  | 'minted_actor_invalid'
  | 'minted_scope_invalid'
  | 'minted_ttl_invalid';

/** Fail-closed refusal: no token material is ever attached to this error. */
export class TokenExchangeRefusedError extends Error {
  readonly code = 'token_exchange_refused';

  constructor(public readonly reason: TokenExchangeRefusalReason, detail?: string) {
    super(detail ?? `Token exchange refused: ${reason}`);
    this.name = 'TokenExchangeRefusedError';
  }
}

export interface TokenExchangeClientInput {
  readonly issuer: TokenExchangeIssuer;
  /** Exact target-audience allowlist; required non-empty, no wildcards. */
  readonly audiences: readonly string[];
  /** Exact expected subject-token audience (single-audience equality). */
  readonly subjectAudience: string;
  /** Authenticated workload client id asserted as minted `client_id`. */
  readonly workloadClientId: string;
  /** Workload identity asserted as mandatory minted `act.sub`. */
  readonly workloadActorSub: string;
  /** Exact environment binding isolating cache entries and policy. */
  readonly environment: string;
  /** Issuer-policy revision isolating cache entries across rotations. */
  readonly policyRevision?: string;
  /** Ceiling applied to minted-token TTL; hard-capped at 300, refused when <= 0. */
  readonly maxTtlSec?: number;
  /** Bound on cached entries; insertion-order eviction past capacity. */
  readonly maxEntries?: number;
  /** Early-use safety margin subtracted from every cache deadline. */
  readonly expiryMarginMs?: number;
  /** Injectable clock (milliseconds); defaults to Date.now. */
  readonly nowMs?: () => number;
}

/** Identity material isolating one cache entry; raw tokens never enter the key. */
export interface TokenExchangeCacheIdentity {
  readonly subjectTokenFingerprint: string;
  readonly originClientId: string;
  readonly workloadClientId: string;
  readonly environment: string;
  readonly tenantId: string;
  readonly policyRevision: string;
}

interface CachedExchange {
  readonly accessToken: string;
  readonly scope: readonly string[];
  readonly expiresAtMs: number;
  readonly subject: string;
  readonly tenantId: string;
}

/** Filter selecting cache entries (and in-flight exchanges) for eviction. */
export interface TokenExchangeCacheInvalidation {
  readonly subject?: string;
  readonly tenantId?: string | null;
}

/** Live exchange client with bounded cache management. */
export interface TokenExchangeClient extends TokenExchangePort {
  /** Evict matching entries (and flights); returns the evicted count. */
  invalidateTokenExchangeCache(filter?: TokenExchangeCacheInvalidation | 'all'): number;
  /** Current cache occupancy for capacity proofs. */
  readTokenExchangeCacheStats(): { readonly entries: number; readonly inflight: number };
}

/** Non-reversible subject-token fingerprint for cache identity (never the token). */
export function fingerprintTokenExchangeSubject(subjectToken: string): string {
  return createHash('sha256').update(subjectToken, 'utf8').digest('hex');
}

/**
 * Build the canonical cache key. Covers issuer, verified subject, subject-token
 * fingerprint/`jti`, originating and workload clients, environment, verified
 * tenant, exact target audience, canonical scopes, workload actor and policy
 * revision. Raw token material never enters the key.
 */
export function buildTokenExchangeCacheKey(
  request: TokenExchangeRequest,
  subject: VerifiedSubjectToken,
  identity: TokenExchangeCacheIdentity,
): string {
  const canonical = [
    'tex1',
    request.grantType,
    request.subjectTokenType,
    request.requestedTokenType ?? '',
    subject.issuer,
    subject.subject,
    identity.subjectTokenFingerprint,
    subject.jti ?? '',
    identity.originClientId,
    identity.workloadClientId,
    identity.environment,
    identity.tenantId,
    request.audience,
    [...request.scope].sort().join(' '),
    subject.audience.length === 1 ? subject.audience[0] : [...subject.audience].sort().join(' '),
    [...subject.scope].sort().join(' '),
    identity.policyRevision,
  ];
  return `tex1/${createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')}`;
}

/** Mandatory cache residency: min(minted exp, subject exp, insertedAt + 60s) minus margin. */
export function resolveTokenExchangeCacheTtlMs(input: {
  readonly mintedExpiresAtSec: number;
  readonly subjectExpiresAtSec: number;
  readonly insertedAtMs: number;
  readonly marginMs?: number;
}): number {
  return (
    Math.min(
      input.mintedExpiresAtSec * 1000,
      input.subjectExpiresAtSec * 1000,
      input.insertedAtMs + TOKEN_EXCHANGE_CACHE_TTL_MS,
    ) - (input.marginMs ?? 0)
  );
}

function refuse(reason: TokenExchangeRefusalReason, detail?: string): never {
  throw new TokenExchangeRefusedError(reason, detail);
}

function requireConfigured(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`token exchange ${name} must be a non-empty string`);
  }
