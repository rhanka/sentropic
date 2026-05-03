import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
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

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleDriveOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleDriveOAuthStatePayload = {
  userId: string;
  workspaceId: string;
  nonce: string;
  returnPath: string;
  iat: number;
  exp: number;
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

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const resolveCallbackBaseUrl = async (): Promise<string | null> => {
  const raw =
    normalizeOptionalText(process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL) ||
    normalizeOptionalText(env.AUTH_CALLBACK_BASE_URL) ||
    normalizeOptionalText(
      await settingsService.get(GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY, {
        fallbackToGlobal: true,
      }),
    );
  return raw ? trimTrailingSlash(raw) : null;
};

export const resolveGoogleDriveAppReturnBaseUrl = (): string | null => {
  const raw =
    normalizeOptionalText(process.env.AUTH_CALLBACK_BASE_URL) ||
    normalizeOptionalText(env.AUTH_CALLBACK_BASE_URL);
  return raw ? trimTrailingSlash(raw) : null;
};

const resolveClientSecret = async (): Promise<string | null> => {
  const envSecret =
    normalizeOptionalText(process.env.GOOGLE_DRIVE_CLIENT_SECRET) ||
    normalizeOptionalText(env.GOOGLE_CLIENT_SECRET);
  if (envSecret) return envSecret;

  const rawSetting = await settingsService.get(GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY, {
    fallbackToGlobal: true,
  });
  return decryptSecretOrNull(rawSetting);
};

export const resolveGoogleDriveOAuthConfig = async (): Promise<GoogleDriveOAuthConfig | null> => {
  const [clientId, clientSecret, callbackBaseUrl] = await Promise.all([
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
    ),
    resolveClientSecret(),
    resolveCallbackBaseUrl(),
  ]);

  if (!clientId || !clientSecret || !callbackBaseUrl) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${callbackBaseUrl}/api/v1/google-drive/oauth/callback`,
  };
};

const stateSecret = (): string => env.JWT_SECRET || 'dev-secret-key-change-in-production-please';

const encodeBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const signStatePayload = (encodedPayload: string): string =>
  createHmac('sha256', stateSecret()).update(encodedPayload).digest('base64url');

export const createGoogleDriveOAuthState = (input: {
  userId: string;
  workspaceId: string;
  returnPath?: string | null;
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
}): Promise<GoogleDriveOAuthStartResult> => {
  const config = await resolveGoogleDriveOAuthConfig();
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
    throw new Error(description);
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
