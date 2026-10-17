import {
  SubjectVerificationError,
  TokenExchangeRefusedError,
  type MintedToken,
  type MintExchangedTokenInput,
  type TokenExchangeCryptoPort,
  type TokenExchangeIssuer,
  type VerifiedSubjectToken,
} from '../token-exchange.js';
import { ACCESS_TOKEN_TYPE, RFC8693_GRANT_TYPE } from '../trust.js';

/** Default bound on the issuer HTTP request (no streaming token responses). */
export const TOKEN_EXCHANGE_HTTP_TIMEOUT_MS = 10_000;

/** Default bound on the issuer HTTP response body. */
export const TOKEN_EXCHANGE_HTTP_MAX_RESPONSE_BYTES = 64 * 1024;

/** Minimal fetch surface consumed by the adapter (injectable for tests). */
/** Minimal WHATWG reader surface consumed by the bounded body reader. */
export interface TokenExchangeBodyReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  releaseLock(): void;
}

export interface TokenExchangeFetch {
  (url: string, init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal: AbortSignal;
    readonly redirect: 'manual';
  }): Promise<{
    readonly status: number;
    readonly headers: { get(name: string): string | null };
    readonly body?: { getReader(): TokenExchangeBodyReader } | null;
    text(): Promise<string>;
  }>;
}

export interface TokenExchangeHttpIssuerOptions {
  /** Exact trusted token endpoint (https). The subject token reaches only this URL. */
  readonly tokenEndpoint: string;
  /** Expected token issuer (`iss`), matched exactly after trailing-slash trim. */
  readonly issuer: string;
  /** Static JWKS document of the issuer (preferred in tests and pinned deploys). */
  readonly jwks?: unknown;
  /** Issuer JWKS URL, fetched once then cached (bounded, no redirects). */
  readonly jwksUri?: string;
  /** Workload client id authenticated via `client_secret_basic`. */
  readonly workloadClientId: string;
  /** Workload secret. Server-side only: never logged, never thrown, never cached. */
  readonly clientSecret: string;
  /** Expected `act.sub` asserted by the issuer on every exchanged token. */
  readonly actorSub: string;
  /** Cryptographic port: JWT verification without a static library reference. */
  readonly crypto: TokenExchangeCryptoPort;
  /** Bounded network timeout per issuer call. */
  readonly requestTimeoutMs?: number;
  /** Bound on the issuer response body. */
  readonly maxResponseBytes?: number;
  /** Injectable clock (milliseconds); defaults to Date.now. */
  readonly nowMs?: () => number;
  /** Injectable fetch; defaults to the global fetch. */
  readonly fetchFn?: TokenExchangeFetch;
  /**
   * Test-only escape hatch allowing `http://127.0.0.1`/`localhost` endpoints for
   * hermetic doubles. Never enabled outside tests: production endpoints are https.
   */
  readonly allowLoopbackHttp?: boolean;
}

function claimString(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' ? value : undefined;
}

function claimStringList(payload: Record<string, unknown>, name: string): string[] {
  const value = payload[name];
  if (typeof value === 'string') return value.split(' ').filter(Boolean);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function claimAudience(payload: Record<string, unknown>): string[] {
  const value = payload.aud;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/**
 * Bounded issuer body read. Prefers the WHATWG stream so an oversized document
 * is refused after a bounded prefix instead of being buffered by `text()`;
 * falls back to `text()` when the fetch double exposes no stream. `tooLarge`
 * maps the refusal to the caller error (mint vs JWKS) without token material.
 */
async function readBoundedBody(
  response: Pick<Awaited<ReturnType<TokenExchangeFetch>>, 'text' | 'body'>,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return response.text();
  const decoder = new TextDecoder();
  let text = '';
  let byteCount = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) throw tooLarge();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

/**
 * Production RFC 8693 binding to the #674 issuer. Authenticates the confidential
 * workload with `client_secret_basic`, sends the raw subject token only to the
 * configured trusted endpoint, and fully validates the returned token (signature,
 * issuer, exact audience, subject, client, mandatory actor, scope subset, TTL caps,
 * token types) before handing it to the exchange client. Every failure is a
 * redacted `TokenExchangeRefusedError` or `SubjectVerificationError`: no token,
 * secret, or credential ever enters a message, diagnostic, or cache key.
 */
export class TokenExchangeHttpIssuer implements TokenExchangeIssuer {
  private readonly options: TokenExchangeHttpIssuerOptions;
  private readonly nowMs: () => number;
  private readonly fetchFn: TokenExchangeFetch;
  private jwksPromise: Promise<unknown> | undefined;

  constructor(options: TokenExchangeHttpIssuerOptions) {
    const loopback = options.allowLoopbackHttp === true && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//u.test(options.tokenEndpoint);
    if (!options.tokenEndpoint.startsWith('https://') && !loopback) {
      throw new TypeError('token exchange tokenEndpoint must be an https URL');
    }
    if (options.issuer.trim().length === 0) throw new TypeError('token exchange issuer must be non-empty');
    if (options.jwks === undefined && options.jwksUri === undefined) {
      throw new TypeError('token exchange binding requires jwks or jwksUri');
    }
    if (options.workloadClientId.trim().length === 0) {
      throw new TypeError('token exchange workloadClientId must be non-empty');
    }
    if (options.clientSecret.length === 0) throw new TypeError('token exchange clientSecret must be non-empty');
    if (options.actorSub.trim().length === 0) throw new TypeError('token exchange actorSub must be non-empty');
    this.options = options;
    this.nowMs = options.nowMs ?? Date.now;
    this.fetchFn = options.fetchFn ?? (fetch as unknown as TokenExchangeFetch);
  }

  private async jwks(): Promise<unknown> {
    if (this.jwksPromise === undefined) {
      this.jwksPromise = (async () => {
        if (this.options.jwks !== undefined) {
          return this.options.crypto.createKeySet(this.options.jwks);
        }
        const timeoutMs = this.options.requestTimeoutMs ?? TOKEN_EXCHANGE_HTTP_TIMEOUT_MS;
        const maxBytes = this.options.maxResponseBytes ?? TOKEN_EXCHANGE_HTTP_MAX_RESPONSE_BYTES;
        const response = await this.fetchFn(this.options.jwksUri as string, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        });
        if (response.status < 200 || response.status >= 300) {
          throw new SubjectVerificationError('invalid_issuer', 'Issuer JWKS is unavailable.');
        }
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) > maxBytes) {
          throw new SubjectVerificationError('invalid_issuer', 'Issuer JWKS response is oversized.');
        }
        const text = await readBoundedBody(response, maxBytes, () => new SubjectVerificationError(
          'invalid_issuer',
          'Issuer JWKS response is oversized.',
        ));
        if (text.length > maxBytes) {
          throw new SubjectVerificationError('invalid_issuer', 'Issuer JWKS response is oversized.');
        }
        return this.options.crypto.createKeySet(JSON.parse(text) as unknown);
      })();
    }
    return this.jwksPromise;
  }

  private expectedIssuer(): string {
    return this.options.issuer.replace(/\/+$/u, '');
  }

  async verify(subjectToken: string): Promise<VerifiedSubjectToken> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.options.crypto.verifyJwt(subjectToken, await this.jwks(), {
        issuer: this.expectedIssuer(),
        currentDate: new Date(this.nowMs()),
      });
    } catch (error) {
      if (error instanceof SubjectVerificationError) throw error;
      if (error instanceof Error && 'code' in error) {
        const code = (error as { code?: string }).code;
        if (code === 'ERR_JWT_EXPIRED') throw new SubjectVerificationError('expired');
        if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
          throw new SubjectVerificationError('invalid_signature');
        }
        if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
          const claim = (error as { claim?: string }).claim;
          if (claim === 'iss') throw new SubjectVerificationError('invalid_issuer');
          if (claim === 'aud') throw new SubjectVerificationError('invalid_audience');
        }
      }
      throw new SubjectVerificationError('malformed');
    }
    const subject = claimString(payload, 'sub');
    if (subject === undefined || subject.length === 0) {
      throw new SubjectVerificationError('missing_subject');
    }
    if (payload.act != null) throw new SubjectVerificationError('actor_chained');
    if (payload.cnf != null) throw new SubjectVerificationError('proof_bound');
    const expiresAtSec = payload.exp;
    const issuedAtSec = payload.iat;
    if (typeof expiresAtSec !== 'number' || typeof issuedAtSec !== 'number') {
      throw new SubjectVerificationError('malformed');
    }
    return {
      issuer: claimString(payload, 'iss') ?? '',
      subject,
      audience: claimAudience(payload),
      issuedAtSec,
      expiresAtSec,
      scope: claimStringList(payload, 'scope'),
      ...(claimString(payload, 'client_id') !== undefined ? { clientId: claimString(payload, 'client_id') } : {}),
      ...(claimString(payload, 'tid') !== undefined ? { tenantId: claimString(payload, 'tid') } : {}),
      ...(claimString(payload, 'jti') !== undefined ? { jti: claimString(payload, 'jti') } : {}),
    };
  }

  async mint(input: MintExchangedTokenInput): Promise<MintedToken> {
    const timeoutMs = this.options.requestTimeoutMs ?? TOKEN_EXCHANGE_HTTP_TIMEOUT_MS;
    const maxBytes = this.options.maxResponseBytes ?? TOKEN_EXCHANGE_HTTP_MAX_RESPONSE_BYTES;
    const form = new URLSearchParams({
      grant_type: RFC8693_GRANT_TYPE,
      subject_token: input.subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
      resource: input.audience,
      scope: [...input.scope].join(' '),
    });
    // RFC 6749 §2.3.1: user-id and password are form-encoded before the join.
    const credentials = `${encodeURIComponent(this.options.workloadClientId)}:${encodeURIComponent(this.options.clientSecret)}`;
    let response;
    try {
      response = await this.fetchFn(this.options.tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    } catch {
      throw new TokenExchangeRefusedError('mint_failed', 'Token exchange failed: issuer is unreachable.');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new TokenExchangeRefusedError('mint_failed', 'Token exchange failed: issuer redirect refused.');
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) > maxBytes) {
      throw new TokenExchangeRefusedError('mint_failed', 'Token exchange failed: issuer response is oversized.');
    }
    const text = await readBoundedBody(response, maxBytes, () => new TokenExchangeRefusedError(
      'mint_failed',
      'Token exchange failed: issuer response is oversized.',
    ));
    if (text.length > maxBytes) {
      throw new TokenExchangeRefusedError('mint_failed', 'Token exchange failed: issuer response is oversized.');
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TokenExchangeRefusedError('mint_failed', 'Token exchange failed: issuer response is not JSON.');
    }
    if (response.status < 200 || response.status >= 300) {
      throw this.refuseIssuerError(body);
    }
    return this.validateMinted(body, input);
  }

  private refuseIssuerError(body: Record<string, unknown>): TokenExchangeRefusedError {
    const code = typeof body.error === 'string' ? body.error : 'exchange_failed';
    if (code === 'invalid_scope') return new TokenExchangeRefusedError('scope_not_granted');
    if (code === 'invalid_target') return new TokenExchangeRefusedError('audience_not_allowed');
    return new TokenExchangeRefusedError('mint_failed', `Token exchange failed: issuer refused (${code}).`);
  }

  private async validateMinted(body: Record<string, unknown>, input: MintExchangedTokenInput): Promise<MintedToken> {
    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new TokenExchangeRefusedError('minted_token_invalid');
    }
    if (body.access_token === input.subjectToken) throw new TokenExchangeRefusedError('mint_passthrough');
    if (body.refresh_token !== undefined) throw new TokenExchangeRefusedError('mint_refresh_present');
    if (body.id_token !== undefined) throw new TokenExchangeRefusedError('minted_token_invalid');
    if (body.token_type !== 'Bearer') throw new TokenExchangeRefusedError('minted_token_type_unsupported');
    if (body.issued_token_type !== undefined && body.issued_token_type !== ACCESS_TOKEN_TYPE) {
      throw new TokenExchangeRefusedError('minted_token_type_unsupported');
    }
    const nowSec = Math.floor(this.nowMs() / 1000);
    let payload: Record<string, unknown>;
    try {
      payload = await this.options.crypto.verifyJwt(body.access_token, await this.jwks(), {
        issuer: this.expectedIssuer(),
        audience: input.audience,
        subject: input.subject.subject,
        currentDate: new Date(this.nowMs()),
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as { code?: string }).code;
        if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
          const claim = (error as { claim?: string }).claim;
          if (claim === 'aud') throw new TokenExchangeRefusedError('minted_audience_invalid');
          if (claim === 'sub') throw new TokenExchangeRefusedError('minted_subject_invalid');
          if (claim === 'iss') throw new TokenExchangeRefusedError('minted_issuer_invalid');
          if (claim === 'exp' || claim === 'nbf' || claim === 'iat') {
            throw new TokenExchangeRefusedError('minted_ttl_invalid');
          }
        }
      }
      throw new TokenExchangeRefusedError('minted_signature_invalid');
    }
    // Exact single-audience match: the crypto-audience check admits any superset,
    // so a minted `aud` array wider than the requested audience is refused here.
    const mintedAudience = claimAudience(payload);
    if (mintedAudience.length !== 1 || mintedAudience[0] !== input.audience) {
      throw new TokenExchangeRefusedError('minted_audience_invalid');
    }
    const act = payload.act as { sub?: unknown } | undefined;
    if (act == null || typeof act.sub !== 'string') throw new TokenExchangeRefusedError('minted_actor_invalid');
    if (act.sub !== this.options.actorSub) throw new TokenExchangeRefusedError('minted_actor_invalid');
    if (payload.client_id !== this.options.workloadClientId) {
      throw new TokenExchangeRefusedError('minted_actor_invalid');
    }
    const issuedScope = claimStringList(payload, 'scope');
    for (const scope of issuedScope) {
      if (!input.scope.includes(scope)) throw new TokenExchangeRefusedError('minted_scope_invalid');
    }
    const expiresAtSec = payload.exp;
    const issuedAtSec = payload.iat;
    if (typeof expiresAtSec !== 'number' || typeof issuedAtSec !== 'number' || !(expiresAtSec > nowSec)) {
      throw new TokenExchangeRefusedError('minted_ttl_invalid');
    }
    if (expiresAtSec > input.subject.expiresAtSec) throw new TokenExchangeRefusedError('minted_ttl_invalid');
    if (expiresAtSec - issuedAtSec > 300) throw new TokenExchangeRefusedError('minted_ttl_invalid');
    const responseScope = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [];
    if ([...responseScope].sort().join(' ') !== [...issuedScope].sort().join(' ')) {
      throw new TokenExchangeRefusedError('minted_scope_invalid');
    }
    return {
      accessToken: body.access_token,
      tokenType: 'Bearer',
      issuedTokenType: ACCESS_TOKEN_TYPE,
      expiresAtSec,
      scope: issuedScope,
      verified: {
        issuer: this.expectedIssuer(),
        subject: input.subject.subject,
        audience: input.audience,
        clientId: this.options.workloadClientId,
        actorSub: this.options.actorSub,
        scope: issuedScope,
        issuedAtSec,
        expiresAtSec,
        ...(claimString(payload, 'jti') !== undefined ? { jti: claimString(payload, 'jti') } : {}),
      },
    };
  }
}
