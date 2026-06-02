import { createAuthUiError } from './errors.js';

export type OAuthFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OAuthDiscoveryDocument {
  authorization_endpoint: string;
  revocation_endpoint?: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer' | 'DPoP' | (string & {});
  expires_in?: number;
  id_token?: string;
  scope?: string;
}

export interface OAuthAuthorizationRequest {
  codeChallenge: string;
  codeVerifier: string;
  nonce?: string;
  state?: string;
  url: string;
}

export interface OAuthStartAuthorizationInput {
  codeVerifier?: string;
  nonce?: string;
  state?: string;
}

export interface OAuthDpopKeyPair {
  privateKey?: CryptoKey;
  publicJwk: JsonWebKey;
  sign?: (data: Uint8Array) => Promise<ArrayBuffer | Uint8Array>;
}

export interface OAuthDpopStore {
  get(): Promise<OAuthDpopKeyPair | null> | OAuthDpopKeyPair | null;
  set(keyPair: OAuthDpopKeyPair): Promise<void> | void;
}

export interface OAuthDpopOptions {
  generateKeyPair?: () => Promise<OAuthDpopKeyPair>;
  jti?: () => string;
  now?: () => Date;
  store: OAuthDpopStore;
}

export interface CreateOAuthClientOptions {
  clientId: string;
  dpop?: OAuthDpopOptions;
  fetch?: OAuthFetchLike;
  issuer: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthClient {
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokenResponse>;
  revoke(token: string): Promise<void>;
  startAuthorization(input?: OAuthStartAuthorizationInput): Promise<OAuthAuthorizationRequest>;
  userInfo<T = Record<string, unknown>>(token: string): Promise<T>;
}

export const createOAuthClient = (options: CreateOAuthClientOptions): OAuthClient => {
  const issuer = options.issuer.replace(/\/+$/u, '');
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (!fetchImpl) {
    throw createAuthUiError('invalid_input', 'No global fetch found; pass options.fetch when constructing the OAuth client.');
  }

  let discoveryPromise: Promise<OAuthDiscoveryDocument> | null = null;
  const getDiscovery = (): Promise<OAuthDiscoveryDocument> => {
    discoveryPromise ??= requestJson<OAuthDiscoveryDocument>(
      fetchImpl,
      `${issuer}/.well-known/openid-configuration`,
      { headers: { Accept: 'application/json' }, method: 'GET' }
    );
    return discoveryPromise;
  };

  return {
    async startAuthorization(input = {}) {
      const [discovery, dpopJkt] = await Promise.all([
        getDiscovery(),
        options.dpop ? getDpopJkt(options.dpop) : Promise.resolve<string | null>(null),
      ]);
      const codeVerifier = input.codeVerifier ?? generateCodeVerifier();
      const codeChallenge = await sha256Base64url(codeVerifier);
      const url = new URL(discovery.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', options.redirectUri);
      url.searchParams.set('scope', options.scopes.join(' '));
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      if (input.state) url.searchParams.set('state', input.state);
      if (input.nonce) url.searchParams.set('nonce', input.nonce);
      if (dpopJkt) url.searchParams.set('dpop_jkt', dpopJkt);

      return {
        codeChallenge,
        codeVerifier,
        nonce: input.nonce,
        state: input.state,
        url: url.toString(),
      };
    },

    async exchangeCode(code, codeVerifier) {
      const discovery = await getDiscovery();
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (options.dpop) {
        headers.DPoP = await createDpopProof(options.dpop, {
          htm: 'POST',
          htu: discovery.token_endpoint,
        });
      }

      return requestJson<OAuthTokenResponse>(fetchImpl, discovery.token_endpoint, {
        body: formBody({
          client_id: options.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: options.redirectUri,
        }),
        headers,
        method: 'POST',
      });
    },

    async userInfo(token) {
      const discovery = await getDiscovery();
      if (!discovery.userinfo_endpoint) {
        throw createAuthUiError('invalid_input', 'OAuth discovery document is missing userinfo_endpoint.');
      }
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `${options.dpop ? 'DPoP' : 'Bearer'} ${token}`,
      };
      if (options.dpop) {
        headers.DPoP = await createDpopProof(options.dpop, {
          accessToken: token,
          htm: 'GET',
          htu: discovery.userinfo_endpoint,
        });
      }
      return requestJson(fetchImpl, discovery.userinfo_endpoint, { headers, method: 'GET' });
    },

    async revoke(token) {
      const discovery = await getDiscovery();
      if (!discovery.revocation_endpoint) {
        throw createAuthUiError('invalid_input', 'OAuth discovery document is missing revocation_endpoint.');
      }
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (options.dpop) {
        headers.DPoP = await createDpopProof(options.dpop, {
          accessToken: token,
          htm: 'POST',
          htu: discovery.revocation_endpoint,
        });
      }
      await requestJson(fetchImpl, discovery.revocation_endpoint, {
        body: formBody({ token }),
        headers,
        method: 'POST',
      });
    },
  };
};

const requestJson = async <T>(
  fetchImpl: OAuthFetchLike,
  url: string,
  init: RequestInit
): Promise<T> => {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    throw createAuthUiError('transport_error', 'Network request failed', { retryable: true, cause });
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    throw createAuthUiError('transport_error', extractErrorMessage(payload, `Request failed with status ${response.status}`), {
      cause: payload,
      retryable: response.status >= 500,
    });
  }

  return payload as T;
};

const safeJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error) return record.error;
    if (typeof record.message === 'string' && record.message) return record.message;
  }
  return fallback;
};

const createDpopProof = async (
  options: OAuthDpopOptions,
  input: { accessToken?: string; htm: string; htu: string }
): Promise<string> => {
  const keyPair = await getDpopKeyPair(options);
  const header = base64urlJson({
    alg: 'EdDSA',
    jwk: keyPair.publicJwk,
    typ: 'dpop+jwt',
  });
  const payload = base64urlJson({
    ...(input.accessToken ? { ath: await sha256Base64url(input.accessToken) } : {}),
    htm: input.htm,
    htu: input.htu,
    iat: Math.floor((options.now?.() ?? new Date()).getTime() / 1000),
    jti: options.jti?.() ?? randomToken(16),
  });
  const signingInput = `${header}.${payload}`;
  const signature = keyPair.sign
    ? await keyPair.sign(textEncoder.encode(signingInput))
    : await crypto.subtle.sign('Ed25519', requirePrivateKey(keyPair), textEncoder.encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
};

const getDpopKeyPair = async (options: OAuthDpopOptions): Promise<OAuthDpopKeyPair> => {
  const existing = await options.store.get();
  if (existing) return existing;
  const generated = options.generateKeyPair ? await options.generateKeyPair() : await generateDefaultDpopKeyPair();
  await options.store.set(generated);
  return generated;
};

const getDpopJkt = async (options: OAuthDpopOptions): Promise<string> =>
  sha256Base64url(canonicalizeJwk((await getDpopKeyPair(options)).publicJwk));

const generateDefaultDpopKeyPair = async (): Promise<OAuthDpopKeyPair> => {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return {
    privateKey: keyPair.privateKey,
    publicJwk: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
  };
};

const requirePrivateKey = (keyPair: OAuthDpopKeyPair): CryptoKey => {
  if (!keyPair.privateKey) {
    throw createAuthUiError('invalid_input', 'OAuth DPoP key pair is missing private key material.');
  }
  return keyPair.privateKey;
};

const canonicalizeJwk = (jwk: JsonWebKey): string => {
  const keys = ['crv', 'kty', 'x', 'e', 'n'].filter((key) => typeof (jwk as Record<string, unknown>)[key] === 'string');
  return `{${keys.sort().map((key) => `"${key}":"${(jwk as Record<string, string>)[key]}"`).join(',')}}`;
};

const formBody = (input: Record<string, string>): string => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    form.set(key, value);
  }
  return form.toString();
};

const generateCodeVerifier = (): string => randomToken(32);

const randomToken = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
};

const sha256Base64url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return base64urlEncode(new Uint8Array(digest));
};

const base64urlJson = (value: unknown): string =>
  base64urlEncode(textEncoder.encode(JSON.stringify(value)));

const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const textEncoder = new TextEncoder();
