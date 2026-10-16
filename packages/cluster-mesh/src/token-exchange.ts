import { ACCESS_TOKEN_TYPE, RFC8693_GRANT_TYPE } from './trust.js';
import type {
  TokenExchangePort,
  TokenExchangeRequest,
  TokenExchangeResponse,
} from './trust.js';

/** Hard cap on exchanged-token cache residency: entries never live longer than 60s. */
export const TOKEN_EXCHANGE_CACHE_TTL_MS = 60_000;

/** Default ceiling applied to minted-token TTL when no explicit ceiling is configured. */
export const DEFAULT_TOKEN_EXCHANGE_MAX_TTL_SEC = 300;

/** Subject-token verification failure modes reported by the issuer binding. */
export type SubjectVerificationCode =
  | 'malformed'
  | 'invalid_signature'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'missing_subject'
  | 'expired';

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
}

/** Token material minted by the issuer binding. Never carries refresh material. */
export interface MintedToken {
  readonly accessToken: string;
  readonly expiresAtSec: number;
  readonly scope: readonly string[];
}

export interface MintExchangedTokenInput {
  readonly subject: VerifiedSubjectToken;
  readonly audience: string;
  readonly scope: readonly string[];
  readonly actor?: { readonly sub: string; readonly iss: string; readonly h2aEngagement: string };
  readonly ttlSec: number;
  readonly nowSec: number;
}

/**
 * Issuer binding port. The cluster-mesh client owns policy (grant type, Bearer-only,
 * scope intersection, TTL ceiling, caching, never-passthrough); the binding owns
 * cryptographic trust (subject verification, token minting). Until lot 2-IdP wires the
 * real IdP, tests inject a fake binding; no fake lives in `src/`.
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
  | 'actor_invalid'
  | 'scope_not_granted'
  | 'ttl_non_positive'
  | 'mint_passthrough'
  | 'mint_refresh_present';

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
  /** Allowed exchange audiences; when set, the requested audience must be a member. */
  readonly audiences?: readonly string[];
  /** Ceiling applied to minted-token TTL. Defaults to DEFAULT_TOKEN_EXCHANGE_MAX_TTL_SEC. */
  readonly maxTtlSec?: number;
  /** Injectable clock (milliseconds); defaults to Date.now. */
  readonly nowMs?: () => number;
}

interface CachedExchange {
  readonly response: TokenExchangeResponse;
  readonly expiresAtMs: number;
}

/**
 * Build the 12-field cache key. The key is derived from request policy fields plus the
 * verified subject claims; raw token material never enters the key.
 */
export function buildTokenExchangeCacheKey(
  request: TokenExchangeRequest,
  subject: VerifiedSubjectToken,
): readonly [string, string, string, string, string, string, string, string, string, string, string, string] {
  return [
    request.grantType,
    request.subjectTokenType,
    request.requestedTokenType ?? '',
    request.audience,
    [...request.scope].sort().join(' '),
    request.actor?.sub ?? '',
    request.actor?.iss ?? '',
    request.actor?.h2aEngagement ?? '',
    subject.issuer,
    subject.subject,
    [...subject.audience].sort().join(' '),
    [...subject.scope].sort().join(' '),
  ];
}

/** Mandatory cache residency: min(minted exp, subject exp, insertedAt + 60s). */
export function resolveTokenExchangeCacheTtlMs(input: {
  readonly mintedExpiresAtSec: number;
  readonly subjectExpiresAtSec: number;
  readonly insertedAtMs: number;
}): number {
  return Math.min(
    input.mintedExpiresAtSec * 1000,
    input.subjectExpiresAtSec * 1000,
    input.insertedAtMs + TOKEN_EXCHANGE_CACHE_TTL_MS,
  );
}

function refuse(reason: TokenExchangeRefusalReason, detail?: string): never {
  throw new TokenExchangeRefusedError(reason, detail);
}

/**
 * RFC 8693 exchange client. Fail-closed on every path: any refusal rejects with
 * TokenExchangeRefusedError, the subject token is never returned as the access token,
 * expired cache entries are never served, and no fallback or retry with the original
 * Bearer credential ever happens (the client performs no upstream call at all).
 */
export function createTokenExchangeClient(input: TokenExchangeClientInput): TokenExchangePort {
  const nowMs = input.nowMs ?? Date.now;
  const maxTtlSec = input.maxTtlSec ?? DEFAULT_TOKEN_EXCHANGE_MAX_TTL_SEC;
  const cache = new Map<string, CachedExchange>();

  return {
    async exchange(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
      if (request.grantType !== RFC8693_GRANT_TYPE) refuse('grant_type_unsupported');
      if (request.subjectTokenType !== ACCESS_TOKEN_TYPE) refuse('subject_token_type_unsupported');
      if (request.requestedTokenType !== undefined && request.requestedTokenType !== ACCESS_TOKEN_TYPE) {
        refuse('requested_token_type_unsupported');
      }
      if (request.subjectToken.length === 0) refuse('subject_token_missing');
      if (request.audience.length === 0) refuse('audience_missing');
      if (input.audiences !== undefined && !input.audiences.includes(request.audience)) {
        refuse('audience_not_allowed');
      }
      if (
        request.actor !== undefined &&
        (request.actor.sub.length === 0 || request.actor.iss.length === 0 || request.actor.h2aEngagement.length === 0)
      ) {
        refuse('actor_invalid');
      }

      let subject: VerifiedSubjectToken | undefined;
      try {
        subject = await input.issuer.verify(request.subjectToken);
      } catch (error) {
        if (error instanceof SubjectVerificationError && error.verification === 'expired') {
          refuse('subject_expired');
        }
        refuse('subject_unverified');
      }
      if (subject === undefined) refuse('subject_unverified');
      const nowSec = Math.floor(nowMs() / 1000);
      if (subject.expiresAtSec <= nowSec) refuse('subject_expired');
      if (subject.subject.length === 0) refuse('subject_unverified', 'Token exchange refused: verified subject is empty');
      if (request.actor !== undefined && request.actor.iss !== subject.issuer) refuse('actor_invalid');

      const grantedScope: readonly string[] =
        request.scope.length === 0 ? [...subject.scope] : [...request.scope];
      for (const scope of grantedScope) {
        if (!subject.scope.includes(scope)) refuse('scope_not_granted');
      }

      const key = JSON.stringify(buildTokenExchangeCacheKey(request, subject));
      const hit = cache.get(key);
      if (hit !== undefined) {
        if (hit.expiresAtMs > nowMs()) return hit.response;
        cache.delete(key);
      }

      const ttlSec = Math.min(subject.expiresAtSec - nowSec, maxTtlSec);
      if (ttlSec <= 0) refuse('ttl_non_positive');
      const minted = await input.issuer.mint({
        subject,
        audience: request.audience,
        scope: grantedScope,
        actor: request.actor,
        ttlSec,
        nowSec,
      });
      if (minted.accessToken === request.subjectToken) refuse('mint_passthrough');
      if ('refreshToken' in (minted as unknown as Record<string, unknown>)) refuse('mint_refresh_present');
      if (minted.expiresAtSec <= nowSec) refuse('ttl_non_positive');

      const insertedAtMs = nowMs();
      const response: TokenExchangeResponse = {
        accessToken: minted.accessToken,
        issuedTokenType: ACCESS_TOKEN_TYPE,
        tokenType: 'Bearer',
        expiresIn: minted.expiresAtSec - Math.floor(insertedAtMs / 1000),
        scope: [...minted.scope],
      };
      cache.set(key, {
        response,
        expiresAtMs: resolveTokenExchangeCacheTtlMs({
          mintedExpiresAtSec: minted.expiresAtSec,
          subjectExpiresAtSec: subject.expiresAtSec,
          insertedAtMs,
        }),
      });
      return response;
    },
  };
}

