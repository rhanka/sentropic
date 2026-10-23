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
  | 'minted_signature_invalid'
  | 'minted_token_invalid'
  | 'minted_token_type_unsupported'
  | 'minted_issuer_invalid'
  | 'minted_audience_invalid'
  | 'minted_subject_invalid'
  | 'minted_actor_invalid'
  | 'minted_scope_invalid'
  | 'minted_ttl_invalid'
  | 'exchange_invalidated';

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

/**
 * Cryptographic port consumed by the RFC 8693 HTTP binding. Supplied by the host
 * (tests inject the real library through a fixture); `src/` keeps no static
 * reference to any JWT library, preserving root-graph isolation of optional peers.
 */
export interface TokenExchangeCryptoPort {
  /** Build a verification key set from a JWKS document (parsed JSON). */
  createKeySet(jwks: unknown): unknown;
  /** Verify a JWT and return its payload; throws the library error on failure. */
  verifyJwt(
    token: string,
    key: unknown,
    options: { issuer: string; audience?: string; subject?: string; currentDate: Date },
  ): Promise<Record<string, unknown>>;
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
}

/**
 * RFC 8693 exchange client. Fail-closed on every path: any refusal rejects with
 * TokenExchangeRefusedError, the subject token is never returned as the access token,
 * expired cache entries are never served, and no fallback or retry with the original
 * Bearer [REDACTED] happens. The caller never supplies an actor: the mandatory `act`
 * comes from the configured workload identity and the minted token is fully
 * validated (issuer, exact audience, subject, client, actor, scope subset, TTL caps,
 * token types) before admission.
 */
export function createTokenExchangeClient(input: TokenExchangeClientInput): TokenExchangeClient {
  if (input.audiences.length === 0) {
    throw new TypeError('token exchange audiences must list at least one exact target audience');
  }
  requireConfigured(input.subjectAudience, 'subjectAudience');
  requireConfigured(input.workloadClientId, 'workloadClientId');
  requireConfigured(input.workloadActorSub, 'workloadActorSub');
  requireConfigured(input.environment, 'environment');
  if (input.maxTtlSec !== undefined && !(input.maxTtlSec > 0)) {
    throw new TypeError('token exchange maxTtlSec must be positive');
  }
  if (input.maxEntries !== undefined && (!Number.isInteger(input.maxEntries) || input.maxEntries < 1)) {
    throw new TypeError('token exchange maxEntries must be a positive integer');
  }
  if (input.expiryMarginMs !== undefined && !(input.expiryMarginMs >= 0)) {
    throw new TypeError('token exchange expiryMarginMs must not be negative');
  }

  const nowMs = input.nowMs ?? Date.now;
  const maxTtlSec = Math.min(input.maxTtlSec ?? DEFAULT_TOKEN_EXCHANGE_MAX_TTL_SEC, TOKEN_EXCHANGE_MAX_TTL_SEC);
  const maxEntries = input.maxEntries ?? DEFAULT_TOKEN_EXCHANGE_CACHE_MAX_ENTRIES;
  const marginMs = input.expiryMarginMs ?? DEFAULT_TOKEN_EXCHANGE_EXPIRY_MARGIN_MS;
  const policyRevision = input.policyRevision ?? '';
  const cache = new Map<string, CachedExchange>();
  const inflight = new Map<string, Promise<CachedExchange>>();
  // O2 invalidation generations: every invalidate() call bumps the global
  // sequence and records its scope. In-flight exchanges capture their floor
  // before verify/mint and refuse before admit when a matching invalidation
  // landed mid-flight, so revoked work can neither insert nor return success.
  let invalidationSequence = 0;
  let allInvalidationSequence = 0;
  const subjectInvalidationSequences = new Map<string, number>();
  const tenantInvalidationSequences = new Map<string, number>();
  const inflightIdentities = new Map<string, { subject: string; tenantId: string }>();

  function identityFor(request: TokenExchangeRequest, subject: VerifiedSubjectToken): TokenExchangeCacheIdentity {
    return {
      subjectTokenFingerprint: fingerprintTokenExchangeSubject(request.subjectToken),
      originClientId: subject.clientId ?? '',
      workloadClientId: input.workloadClientId,
      environment: input.environment,
      tenantId: subject.tenantId ?? '',
      policyRevision,
    };
  }

  function matches(
    entry: { readonly subject: string; readonly tenantId: string },
    filter: TokenExchangeCacheInvalidation | 'all',
  ): boolean {
    if (filter === 'all') return true;
    if (filter.subject !== undefined && entry.subject !== filter.subject) return false;
    if (filter.tenantId !== undefined && entry.tenantId !== (filter.tenantId ?? '')) return false;
    return true;
  }

  function evict(key: string): void {
    cache.delete(key);
    inflight.delete(key);
    inflightIdentities.delete(key);
  }

  function admit(key: string, entry: CachedExchange): void {
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    cache.set(key, entry);
  }

  function checkMinted(minted: MintedToken, request: TokenExchangeRequest, subject: VerifiedSubjectToken, nowSec: number): void {
    if (minted.accessToken === request.subjectToken) refuse('mint_passthrough');
    if ('refreshToken' in (minted as unknown as Record<string, unknown>)) refuse('mint_refresh_present');
    if (minted.tokenType !== undefined && minted.tokenType !== 'Bearer') refuse('minted_token_type_unsupported');
    if (minted.issuedTokenType !== undefined && minted.issuedTokenType !== ACCESS_TOKEN_TYPE) {
      refuse('minted_token_type_unsupported');
    }
    const verified = (minted as Partial<MintedToken>).verified;
    if (verified === undefined) refuse('minted_token_invalid', 'Token exchange refused: minted token carries no verified claims');
    if (verified.issuer !== subject.issuer) refuse('minted_issuer_invalid');
    if (verified.audience !== request.audience) refuse('minted_audience_invalid');
    if (verified.subject.length === 0 || verified.subject !== subject.subject) refuse('minted_subject_invalid');
    if (verified.actorSub !== input.workloadActorSub || verified.clientId !== input.workloadClientId) {
      refuse('minted_actor_invalid');
    }
    for (const scope of verified.scope) {
      if (!request.scope.includes(scope)) refuse('minted_scope_invalid');
    }
    if (!(verified.expiresAtSec > nowSec)) refuse('ttl_non_positive');
    if (verified.expiresAtSec > subject.expiresAtSec) refuse('minted_ttl_invalid');
    if (verified.expiresAtSec - verified.issuedAtSec > TOKEN_EXCHANGE_MAX_TTL_SEC) refuse('minted_ttl_invalid');
    if (minted.expiresAtSec !== verified.expiresAtSec) refuse('minted_ttl_invalid');
    if ([...minted.scope].sort().join(' ') !== [...verified.scope].sort().join(' ')) refuse('minted_scope_invalid');
  }

  async function perform(request: TokenExchangeRequest, subject: VerifiedSubjectToken, key: string): Promise<CachedExchange> {
    const nowSec = Math.floor(nowMs() / 1000);
    if (subject.expiresAtSec <= nowSec) {
      evict(key);
      refuse('subject_expired');
    }
    const ttlSec = Math.min(subject.expiresAtSec - nowSec, maxTtlSec);
    if (ttlSec <= 0) refuse('ttl_non_positive');
    const tenantId = subject.tenantId ?? '';
    const mintFloor = {
      all: allInvalidationSequence,
      subject: subjectInvalidationSequences.get(subject.subject) ?? 0,
      tenant: tenantInvalidationSequences.get(tenantId) ?? 0,
    };
    let minted: MintedToken;
    try {
      minted = await input.issuer.mint({
        subject,
        subjectToken: request.subjectToken,
        audience: request.audience,
        scope: [...request.scope],
        actorSub: input.workloadActorSub,
        workloadClientId: input.workloadClientId,
        ttlSec,
        nowSec,
      });
    } catch (error) {
      if (error instanceof TokenExchangeRefusedError) throw error;
      refuse('mint_failed');
    }
    const completedSec = Math.floor(nowMs() / 1000);
    checkMinted(minted, request, subject, completedSec);
    const insertedAtMs = nowMs();
    const expiresAtMs = resolveTokenExchangeCacheTtlMs({
      mintedExpiresAtSec: minted.expiresAtSec,
      subjectExpiresAtSec: subject.expiresAtSec,
      insertedAtMs,
      marginMs,
    });
    if (!(expiresAtMs > insertedAtMs)) {
      evict(key);
      refuse('ttl_non_positive');
    }
    const entry: CachedExchange = {
      accessToken: minted.accessToken,
      scope: [...minted.scope],
      expiresAtMs,
      subject: subject.subject,
      tenantId: subject.tenantId ?? '',
    };
    // O2: a matching invalidation landed during the in-flight mint/verify.
    // Refuse before admit: the revoked result is neither inserted (no evict of
    // a retry's entry either) nor returned to this flight's waiters.
    if (
      allInvalidationSequence !== mintFloor.all ||
      (subjectInvalidationSequences.get(subject.subject) ?? 0) !== mintFloor.subject ||
      (tenantInvalidationSequences.get(tenantId) ?? 0) !== mintFloor.tenant
    ) {
      refuse('exchange_invalidated');
    }
    admit(key, entry);
    return entry;
  }

  function toResponse(entry: CachedExchange): TokenExchangeResponse {
    return {
      accessToken: entry.accessToken,
      issuedTokenType: ACCESS_TOKEN_TYPE,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, Math.floor((entry.expiresAtMs - nowMs()) / 1000)),
      scope: [...entry.scope],
    };
  }

  return {
    async exchange(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
      if (request.grantType !== RFC8693_GRANT_TYPE) refuse('grant_type_unsupported');
      if (request.subjectTokenType !== ACCESS_TOKEN_TYPE) refuse('subject_token_type_unsupported');
      if (request.requestedTokenType !== undefined && request.requestedTokenType !== ACCESS_TOKEN_TYPE) {
        refuse('requested_token_type_unsupported');
      }
      if (request.subjectToken.length === 0) refuse('subject_token_missing');
      if (request.audience.length === 0) refuse('audience_missing');
      if (!input.audiences.includes(request.audience)) refuse('audience_not_allowed');
      if ('actor' in (request as unknown as Record<string, unknown>)) refuse('actor_invalid');
      if (request.scope.length === 0) refuse('scope_empty');

      const verifySequence = invalidationSequence;
      let subject: VerifiedSubjectToken;
      try {
        subject = await input.issuer.verify(request.subjectToken);
      } catch (error) {
        if (error instanceof SubjectVerificationError && error.verification === 'expired') {
          refuse('subject_expired');
        }
        refuse('subject_unverified');
      }
      // O2: invalidated during subject verification — refuse before minting.
      if (invalidationSequence !== verifySequence) refuse('exchange_invalidated');
      const nowSec = Math.floor(nowMs() / 1000);
      if (subject.expiresAtSec <= nowSec) refuse('subject_expired');
      if (subject.subject.length === 0) refuse('subject_unverified', 'Token exchange refused: verified subject is empty');
      if (subject.audience.length !== 1 || subject.audience[0] !== input.subjectAudience) {
        refuse('subject_audience_invalid');
      }
      for (const scope of request.scope) {
        if (!subject.scope.includes(scope)) refuse('scope_not_granted');
      }

      const key = buildTokenExchangeCacheKey(request, subject, identityFor(request, subject));
      const hit = cache.get(key);
      if (hit !== undefined) {
        if (hit.expiresAtMs > nowMs()) return toResponse(hit);
        cache.delete(key);
      }

      const flight = inflight.get(key);
      if (flight !== undefined) return toResponse(await flight);
      const pending = perform(request, subject, key);
      inflight.set(key, pending);
      inflightIdentities.set(key, { subject: subject.subject, tenantId: subject.tenantId ?? '' });
      try {
        return toResponse(await pending);
      } finally {
        if (inflight.get(key) === pending) {
          inflight.delete(key);
          inflightIdentities.delete(key);
        }
      }
    },

    invalidateTokenExchangeCache(filter: TokenExchangeCacheInvalidation | 'all' = 'all'): number {
      let evicted = 0;
      for (const [key, entry] of cache) {
        if (matches(entry, filter)) {
          cache.delete(key);
          evicted += 1;
        }
      }
      invalidationSequence += 1;
      if (filter === 'all') {
        allInvalidationSequence = invalidationSequence;
        evicted += inflight.size;
        inflight.clear();
        inflightIdentities.clear();
      } else {
        if (filter.subject !== undefined) subjectInvalidationSequences.set(filter.subject, invalidationSequence);
        if (filter.tenantId !== undefined) {
          tenantInvalidationSequences.set(filter.tenantId ?? '', invalidationSequence);
        }
        // O2: detach matching flights so new work cannot join an invalidated
        // request; the detached flight refuses at its own admit check.
        for (const [key, identity] of inflightIdentities) {
          if (matches(identity, filter)) {
            inflight.delete(key);
            inflightIdentities.delete(key);
          }
        }
        if (
          subjectInvalidationSequences.size >= maxEntries ||
          tenantInvalidationSequences.size >= maxEntries
        ) {
          // Fail closed and bounded: collapse scoped history into a global
          // invalidation instead of growing without bound.
          subjectInvalidationSequences.clear();
          tenantInvalidationSequences.clear();
          allInvalidationSequence = invalidationSequence;
          evicted += inflight.size;
          inflight.clear();
          inflightIdentities.clear();
        }
      }
      return evicted;
    },

    readTokenExchangeCacheStats(): { readonly entries: number; readonly inflight: number } {
      return { entries: cache.size, inflight: inflight.size };
    },
  };
}
