import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, requiresOAuthProductionSecrets } from '../config/env';
import { decryptSecretOrNull } from './secret-crypto';
import { settingsService } from './settings';

export const GOOGLE_DRIVE_PROVIDER = 'google_drive' as const;

export const GOOGLE_DRIVE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
] as const;

export const GOOGLE_DRIVE_OAUTH_CLIENT_ID_SETTING_KEY = 'google_drive_oauth_client_id';
export const GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY = 'google_drive_oauth_client_secret';
export const GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY =
  'google_drive_oauth_callback_base_url';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const REVOKE_TIMEOUT_MS = 5_000;
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleDriveOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleOAuthStateProvider = 'google-drive' | 'gmail';

export type GoogleDriveOAuthStatePayload = {
  userId: string;
  workspaceId: string;
  nonce: string;
  returnPath: string;
  iat: number;
  exp: number;
  provider?: GoogleOAuthStateProvider;
};

export type GoogleDriveOAuthStartResult = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type GoogleDriveTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  expiresIn: number | null;
  scope: string | null;
  scopes: string[];
  obtainedAt: string;
  expiresAt: string | null;
};

export type GoogleDriveAccountIdentity = {
  accountEmail: string | null;
  accountSubject: string | null;
};

type FetchImpl = typeof fetch;

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

/**
 * A token-endpoint rejection from Google, carrying the MACHINE-READABLE OAuth error code.
 *
 * Callers must be able to tell "Google says this grant is dead" (`invalid_grant`) apart from
 * "Google was unreachable / returned 5xx / we are misconfigured". Both used to arrive as a bare
 * `Error` whose message was a human description, so the only way to distinguish them was string
 * matching — and the caller consequently treated EVERY failure as a dead grant and erased the
 * stored refresh token. A transient outage then cost the user their connection permanently.
 */
export class GoogleDriveTokenEndpointError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, options: { code: string | null; status: number }) {
    super(message);
    this.name = 'GoogleDriveTokenEndpointError';
    this.code = options.code;
    this.status = options.status;
  }

  /** True only when Google itself declares the grant no longer usable — the one unrecoverable case. */
  get isUnrecoverableGrant(): boolean {
    return this.code === 'invalid_grant';
  }
}

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const splitScopes = (scope: string | null): string[] =>
  scope
    ? scope
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [...GOOGLE_DRIVE_OAUTH_SCOPES];

const normalizeReturnPath = (value: unknown): string => {
  const raw = normalizeText(value);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
};

const normalizeOAuthStateProvider = (value: unknown): GoogleOAuthStateProvider =>
  normalizeText(value) === 'gmail' ? 'gmail' : 'google-drive';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';

const isLoopbackCallbackBaseUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

const normalizeCallbackBaseUrl = (value: unknown): string | null => {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  const normalized = trimTrailingSlash(raw);
  if (isProductionRuntime() && isLoopbackCallbackBaseUrl(normalized)) return null;
  return normalized;
};

export const resolveGoogleDriveOAuthClientId = async (): Promise<string | null> =>
  Promise.resolve(
    normalizeOptionalText(process.env.GOOGLE_DRIVE_CLIENT_ID) ||
      normalizeOptionalText(env.GOOGLE_CLIENT_ID),
  ).then(async (value) =>
    value ||
    normalizeOptionalText(
      await settingsService.get(GOOGLE_DRIVE_OAUTH_CLIENT_ID_SETTING_KEY, {
        fallbackToGlobal: true,
      }),
    ),
  );

export const resolveCallbackBaseUrl = async (
  options: { requestApiBaseUrl?: string | null } = {},
): Promise<string | null> => {
  const setting = await settingsService.get(GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY, {
    fallbackToGlobal: true,
  });
  const candidates = [
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL,
    setting,
    options.requestApiBaseUrl,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCallbackBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
};

const deriveAppReturnBaseUrlFromApiBaseUrl = (value: string | null | undefined): string | null => {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (isLoopbackCallbackBaseUrl(url.origin)) return null;
    if (url.hostname.endsWith('-api.sent-tech.ca')) {
      url.hostname = `${url.hostname.slice(0, -'-api.sent-tech.ca'.length)}.sent-tech.ca`;
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
};

export const resolveGoogleDriveAppReturnBaseUrl = (
  options: { requestApiBaseUrl?: string | null } = {},
): string | null => {
  const derived = deriveAppReturnBaseUrlFromApiBaseUrl(options.requestApiBaseUrl);
  const raw =
    normalizeOptionalText(process.env.AUTH_CALLBACK_BASE_URL) ||
    normalizeOptionalText(env.AUTH_CALLBACK_BASE_URL);
  if (!raw) return derived;

  const normalized = trimTrailingSlash(raw);
  return derived && isLoopbackCallbackBaseUrl(normalized) ? derived : normalized;
};

export const resolveClientSecret = async (): Promise<string | null> => {
  const envSecret =
    normalizeOptionalText(process.env.GOOGLE_DRIVE_CLIENT_SECRET) ||
    normalizeOptionalText(env.GOOGLE_CLIENT_SECRET);
  if (envSecret) return envSecret;

  const rawSetting = await settingsService.get(GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY, {
    fallbackToGlobal: true,
  });
  return decryptSecretOrNull(rawSetting);
};

export const resolveGoogleDriveOAuthConfig = async (
  options: { requestApiBaseUrl?: string | null } = {},
): Promise<GoogleDriveOAuthConfig | null> => {
  const [clientId, clientSecret, callbackBaseUrl] = await Promise.all([
    resolveGoogleDriveOAuthClientId(),
    resolveClientSecret(),
    resolveCallbackBaseUrl(options),
  ]);

  if (!clientId || !clientSecret || !callbackBaseUrl) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${callbackBaseUrl}/api/v1/google-drive/oauth/callback`,
  };
};

/**
 * HMAC key sealing the Drive OAuth `state`.
 *
 * This was `env.JWT_SECRET || '<public literal>'`. Deployed containers do not receive `JWT_SECRET`, so
 * production has been sealing its Drive authorization state with a constant that is readable in a
 * PUBLIC repository — the integrity of the state parameter rested on a value anyone can look up.
 *
 * Two changes:
 *  - `OAUTH_SIGNING_KEK` takes precedence, so provisioning `JWT_SECRET` later cannot silently move
 *    this sealer onto the signing key.
 *    NOTE, and do not misread this as parity: the sibling sealer `resolveOAuthStateSecret` in
 *    routes/auth/oauth.ts is currently `JWT_SECRET ?? OAUTH_SIGNING_KEK` — the OPPOSITE order, and
 *    `??` rather than `||`. So while both vars are set the two sealers use DIFFERENT keys. Aligning
 *    them belongs to the branch that touches that file; it is deliberately not done here.
 *  - In production the literal fallback is REFUSED rather than used, because sealing with a public
 *    constant is indistinguishable from not sealing at all. This is a PER-REQUEST refusal, not a
 *    boot-time one: nothing runs at module scope, so a misconfigured pod starts healthy and the two
 *    Drive OAuth endpoints return 503/400. Fail-closed, but it presents as a Drive outage.
 *
 * Residual hole, stated rather than papered over: `requiresOAuthProductionSecrets` is switched OFF
 * by `isE2eProductionImageRuntime` (NODE_ENV=production AND DISABLE_RATE_LIMIT='true' AND the e2e
 * admin address). In that configuration this still seals with the public literal.
 *
 * `||` (not `??`) is deliberate: the secret bundle emits present-but-EMPTY values, and an empty string
 * must fall through to the next candidate instead of becoming the key.
 */
const stateSecret = (): string => {
  const secret = env.OAUTH_SIGNING_KEK || env.JWT_SECRET;
  if (secret) return secret;
  if (requiresOAuthProductionSecrets()) {
    throw new Error(
      'OAUTH_SIGNING_KEK or JWT_SECRET is required to seal Google Drive OAuth state in production.',
    );
  }
  return 'dev-secret-key-change-in-production-please';
};

const encodeBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const signStatePayload = (encodedPayload: string): string =>
  createHmac('sha256', stateSecret()).update(encodedPayload).digest('base64url');

export const createGoogleDriveOAuthState = (input: {
  userId: string;
  workspaceId: string;
  returnPath?: string | null;
  provider?: GoogleOAuthStateProvider;
  now?: Date;
}): { state: string; payload: GoogleDriveOAuthStatePayload } => {
  const now = input.now ?? new Date();
  const iat = now.getTime();
  const payload: GoogleDriveOAuthStatePayload = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    nonce: randomBytes(16).toString('base64url'),
    returnPath: normalizeReturnPath(input.returnPath),
    iat,
    exp: iat + STATE_TTL_MS,
    provider: normalizeOAuthStateProvider(input.provider),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return {
    payload,
    state: `${encodedPayload}.${signStatePayload(encodedPayload)}`,
  };
};

export const verifyGoogleDriveOAuthState = (
  state: string,
  options: { now?: Date } = {},
): GoogleDriveOAuthStatePayload => {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    throw new Error('Invalid Google Drive OAuth state.');
  }

  const expectedSignature = signStatePayload(encodedPayload);
  const provided = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid Google Drive OAuth state.');
  }

  let parsed: Partial<GoogleDriveOAuthStatePayload> | null = null;
  try {
    parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<GoogleDriveOAuthStatePayload>;
  } catch {
    throw new Error('Invalid Google Drive OAuth state.');
  }

  const userId = normalizeOptionalText(parsed?.userId);
  const workspaceId = normalizeOptionalText(parsed?.workspaceId);
  const nonce = normalizeOptionalText(parsed?.nonce);
  const exp = typeof parsed?.exp === 'number' ? parsed.exp : 0;
  const iat = typeof parsed?.iat === 'number' ? parsed.iat : 0;
  if (!userId || !workspaceId || !nonce || !exp || !iat) {
    throw new Error('Invalid Google Drive OAuth state.');
  }

  const nowMs = (options.now ?? new Date()).getTime();
  if (exp <= nowMs) {
    throw new Error('Expired Google Drive OAuth state.');
  }

  return {
    userId,
    workspaceId,
    nonce,
    returnPath: normalizeReturnPath(parsed?.returnPath),
    iat,
    exp,
    provider: normalizeOAuthStateProvider(parsed?.provider),
  };
};

export const buildGoogleDriveAuthorizationUrl = (input: {
  config: GoogleDriveOAuthConfig;
  state: string;
}): string => {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_DRIVE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  return url.toString();
};

export const startGoogleDriveOAuth = async (input: {
  userId: string;
  workspaceId: string;
  returnPath?: string | null;
  requestApiBaseUrl?: string | null;
}): Promise<GoogleDriveOAuthStartResult> => {
  const config = await resolveGoogleDriveOAuthConfig({ requestApiBaseUrl: input.requestApiBaseUrl });
  if (!config) {
    throw new Error('Google Drive OAuth is not configured.');
  }

  const { state, payload } = createGoogleDriveOAuthState(input);
  return {
    authorizationUrl: buildGoogleDriveAuthorizationUrl({ config, state }),
    state,
    expiresAt: new Date(payload.exp).toISOString(),
  };
};

export const exchangeGoogleDriveOAuthCode = async (input: {
  code: string;
  config: GoogleDriveOAuthConfig;
  fetchImpl?: FetchImpl;
}): Promise<GoogleDriveTokenResponse> => {
  const fetcher = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.config.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const description =
      normalizeOptionalText(payload.error_description) ||
      normalizeOptionalText(payload.error) ||
      'Google token exchange failed.';
    throw new Error(description);
  }

  const accessToken = normalizeOptionalText(payload.access_token);
  if (!accessToken) {
    throw new Error('Google token response did not include an access token.');
  }

  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(0, Math.floor(payload.expires_in))
      : null;
  const obtainedAt = new Date();
  const expiresAt = expiresIn === null ? null : new Date(obtainedAt.getTime() + expiresIn * 1000);
  const scope = normalizeOptionalText(payload.scope);

  return {
    accessToken,
    refreshToken: normalizeOptionalText(payload.refresh_token),
    idToken: normalizeOptionalText(payload.id_token),
    tokenType: normalizeOptionalText(payload.token_type) || 'Bearer',
    expiresIn,
    scope,
    scopes: splitScopes(scope),
    obtainedAt: obtainedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
};


export const refreshGoogleDriveAccessToken = async (input: {
  refreshToken: string;
  config: GoogleDriveOAuthConfig;
  fetchImpl?: FetchImpl;
}): Promise<GoogleDriveTokenResponse> => {
  const fetcher = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const description =
      normalizeOptionalText(payload.error_description) ||
      normalizeOptionalText(payload.error) ||
      'Google token refresh failed.';
    throw new GoogleDriveTokenEndpointError(description, {
      code: normalizeOptionalText(payload.error),
      status: response.status,
    });
  }

  const accessToken = normalizeOptionalText(payload.access_token);
  if (!accessToken) {
    throw new Error('Google token refresh response did not include an access token.');
  }

  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(0, Math.floor(payload.expires_in))
      : null;
  const obtainedAt = new Date();
  const expiresAt = expiresIn === null ? null : new Date(obtainedAt.getTime() + expiresIn * 1000);
  const scope = normalizeOptionalText(payload.scope);

  return {
    accessToken,
    refreshToken: normalizeOptionalText(payload.refresh_token) ?? input.refreshToken,
    idToken: normalizeOptionalText(payload.id_token),
    tokenType: normalizeOptionalText(payload.token_type) || 'Bearer',
    expiresIn,
    scope,
    scopes: splitScopes(scope),
    obtainedAt: obtainedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
};

const decodeJwtPayload = (jwt: string | null): Record<string, unknown> | null => {
  if (!jwt) return null;
  const [, payload] = jwt.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const resolveGoogleDriveAccountIdentity = async (input: {
  token: GoogleDriveTokenResponse;
  fetchImpl?: FetchImpl;
}): Promise<GoogleDriveAccountIdentity> => {
  const claims = decodeJwtPayload(input.token.idToken);
  const claimEmail = normalizeOptionalText(claims?.email);
  const claimSubject = normalizeOptionalText(claims?.sub);
  if (claimEmail || claimSubject) {
    return { accountEmail: claimEmail, accountSubject: claimSubject };
  }

  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(GOOGLE_USERINFO_ENDPOINT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.token.accessToken}` },
  });
  if (!response.ok) {
    return { accountEmail: null, accountSubject: null };
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    accountEmail: normalizeOptionalText(payload.email),
    accountSubject: normalizeOptionalText(payload.sub),
  };
};

export const appendGoogleDriveOAuthResultToReturnPath = (
  returnPath: string,
  params: Record<string, string>,
  options: { baseUrl?: string | null } = {},
): string => {
  const path = normalizeReturnPath(returnPath);
  const url = new URL(path, 'http://local');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const relativePath = `${url.pathname}${url.search}${url.hash}`;
  const baseUrl = normalizeOptionalText(options.baseUrl);
  if (!baseUrl) return relativePath;
  return new URL(relativePath, trimTrailingSlash(baseUrl)).toString();
};

/**
 * Ask Google to REVOKE a grant upstream.
 *
 * Deleting our stored copy of a token is not revocation: the grant stays live at Google, so a copy
 * that leaked elsewhere keeps working. That gap is why "disconnect" could not contain an exposure —
 * we forgot the token, the attacker did not.
 *
 * Revoking a REFRESH token revokes the whole grant (Google invalidates the refresh token and its
 * derived access tokens); revoking an access token alone only kills that one token. So pass the
 * refresh token when there is one.
 *
 * Best-effort BY DESIGN: the caller has been asked to disconnect, and must still forget the token
 * locally even if Google is unreachable. Returning a result rather than throwing lets the caller
 * record what actually happened instead of assuming success — "we tried" is not "it is revoked".
 */
export const revokeGoogleOAuthToken = async (input: {
  token: string;
  fetchImpl?: FetchImpl;
}): Promise<{ revoked: boolean; status: number | null; error: string | null }> => {
  const token = (input.token || '').trim();
  if (!token) return { revoked: false, status: null, error: 'no token to revoke' };

  const fetcher = input.fetchImpl ?? fetch;
  try {
    const response = await fetcher(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      // Bounded on purpose. Without it the ceiling is undici's default (~300s), which is not a
      // choice this codebase made. Blackholed egress — dropped rather than refused — would
      // otherwise hold the request open for minutes.
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });

    // Google answers 200 on success. A 400 with `invalid_token` means it is ALREADY unusable —
    // which is the outcome we wanted, so it counts as revoked rather than as a failure.
    if (response.ok) return { revoked: true, status: response.status, error: null };

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = normalizeOptionalText(payload.error);
    if (response.status === 400 && code === 'invalid_token') {
      return { revoked: true, status: response.status, error: null };
    }
    return {
      revoked: false,
      status: response.status,
      error: normalizeOptionalText(payload.error_description) || code || 'Google token revocation failed.',
    };
  } catch (error) {
    return {
      revoked: false,
      status: null,
      error: error instanceof Error ? error.message : 'Google token revocation failed.',
    };
  }
};
