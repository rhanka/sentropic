import { createHash, randomUUID } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CreateAuthClientOptions {
  /** OAuth2 issuer base URL (e.g. https://api.example.com). */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Default scopes requested by getToken when none are given. */
  scope?: string | string[];
  /** Default resource indicator (RFC 8707) requested by getToken. */
  resource?: string;
  /** Opt-in DPoP-bound access tokens (BR39d-D1). */
  dpop?: boolean;
  /** Explicit token endpoint; defaults to `${issuer}/api/v1/auth/oauth/token`. */
  tokenEndpoint?: string;
  /** Refresh tokens this many seconds before they expire (default 30). */
  refreshSkewSeconds?: number;
  /** Injectable fetch (defaults to global fetch) and clock for testing. */
  fetch?: FetchLike;
  now?: () => Date;
}

export interface GetTokenOptions {
  scope?: string | string[];
  resource?: string;
  /** Force a refresh even if a cached token is still valid. */
  forceRefresh?: boolean;
}

export interface ServiceAccessToken {
  access_token: string;
  token_type: 'Bearer' | 'DPoP' | (string & {});
  expires_at: number;
  scope: string;
}

export interface BuildDpopProofOptions {
  htm: string;
  htu: string;
  accessToken?: string;
}

export interface AuthClient {
  getToken(options?: GetTokenOptions): Promise<ServiceAccessToken>;
  /** Build a DPoP proof for an outbound request bound to an access token (RFC 9449). */
  buildDpopProof(options: BuildDpopProofOptions): Promise<string>;
  /** Drop the in-memory cache (e.g. after a 401). */
  clearCache(): void;
}

interface TokenEndpointResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface DpopKeyMaterial {
  privateKey: KeyLike;
  publicJwk: JWK;
}

export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'AuthClientError';
  }
}

export const createAuthClient = (options: CreateAuthClientOptions): AuthClient => {
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new AuthClientError('No fetch implementation is available; pass options.fetch.');
  }
  const now = options.now ?? (() => new Date());
  const refreshSkewSeconds = options.refreshSkewSeconds ?? 30;
  const tokenEndpoint = options.tokenEndpoint ?? `${trimTrailingSlash(options.issuer)}/api/v1/auth/oauth/token`;
  const defaultScope = normalizeScope(options.scope);

  const cache = new Map<string, ServiceAccessToken>();
  let dpopKeyPromise: Promise<DpopKeyMaterial> | null = null;

  const getDpopKey = (): Promise<DpopKeyMaterial> => {
    dpopKeyPromise ??= (async () => {
      const { privateKey, publicKey } = await generateKeyPair('EdDSA');
      return { privateKey, publicJwk: await exportJWK(publicKey) };
    })();
    return dpopKeyPromise;
  };

  const buildDpopProof = async (proofOptions: BuildDpopProofOptions): Promise<string> => {
    const { privateKey, publicJwk } = await getDpopKey();
    const builder = new SignJWT({
      htm: proofOptions.htm.toUpperCase(),
      htu: proofOptions.htu,
      ...(proofOptions.accessToken ? { ath: sha256Base64url(proofOptions.accessToken) } : {}),
    })
      .setProtectedHeader({ alg: 'EdDSA', jwk: publicJwk, typ: 'dpop+jwt' })
      .setIssuedAt(Math.floor(now().getTime() / 1000))
      .setJti(randomUUID());
    return builder.sign(privateKey);
  };

  const requestToken = async (scope: string, resource: string | undefined): Promise<ServiceAccessToken> => {
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scope) body.set('scope', scope);
    if (resource) body.set('resource', resource);

    const headers: Record<string, string> = {
      authorization: basicAuth(options.clientId, options.clientSecret),
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (options.dpop) {
      headers.dpop = await buildDpopProof({ htm: 'POST', htu: tokenEndpoint });
    }

    const response = await fetchImpl(tokenEndpoint, { body: body.toString(), headers, method: 'POST' });
    const payload = (await response.json().catch(() => null)) as (TokenEndpointResponse & { error?: unknown }) | null;
    if (!response.ok || !payload?.access_token) {
      const code = extractErrorCode(payload);
      throw new AuthClientError(
        `Token request failed (${response.status}${code ? ` ${code}` : ''}).`,
        response.status,
        code
      );
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 900;
    return {
      access_token: payload.access_token,
      expires_at: Math.floor(now().getTime() / 1000) + expiresIn,
      scope: payload.scope ?? scope,
      token_type: (payload.token_type as ServiceAccessToken['token_type']) ?? 'Bearer',
    };
  };

  return {
    buildDpopProof,
    clearCache() {
      cache.clear();
    },
    async getToken(getOptions = {}) {
      const scope = normalizeScope(getOptions.scope) || defaultScope;
      const resource = getOptions.resource ?? options.resource;
      const cacheKey = `${scope}::${resource ?? ''}`;

      if (!getOptions.forceRefresh) {
        const cached = cache.get(cacheKey);
        const nowSeconds = Math.floor(now().getTime() / 1000);
        if (cached && cached.expires_at - refreshSkewSeconds > nowSeconds) {
          return cached;
        }
      }

      const token = await requestToken(scope, resource);
      cache.set(cacheKey, token);
      return token;
    },
  };
};

const normalizeScope = (scope: string | string[] | undefined): string => {
  if (!scope) return '';
  return Array.isArray(scope) ? scope.filter(Boolean).join(' ') : scope.trim();
};

const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

const sha256Base64url = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const extractErrorCode = (payload: { error?: unknown } | null): string | undefined => {
  if (!payload || typeof payload.error === 'undefined') return undefined;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.error === 'object' && payload.error && 'code' in payload.error) {
    const code = (payload.error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
