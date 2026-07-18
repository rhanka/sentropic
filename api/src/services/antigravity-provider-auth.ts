import { createHash, randomBytes } from 'node:crypto';

// Antigravity account transport (unified Google gateway).
//
// Antigravity replaces the DEAD classic gemini-cli Code Assist individual path
// (retired 2026-06-18). One Google account fronts a MULTI-MODEL fleet served
// through the Cloud Code companion endpoint (`cloudcode-pa.googleapis.com`).
//
// OAuth is authorization-code + PKCE (loopback redirect). These externally
// facing endpoints / client_id / redirect / scopes are set as NAMED CONSTANTS
// and MUST be confirmed during owner UAT (live login) — see BRAG-Q1.
export const ANTIGRAVITY_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/auth';
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANTIGRAVITY_CLIENT_ID =
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const ANTIGRAVITY_DEFAULT_REDIRECT_PORT = 8790;
export const ANTIGRAVITY_REDIRECT_PATH = '/oauth-callback';
export const ANTIGRAVITY_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
].join(' ');

// Cloud Code companion API (the Antigravity data plane).
export const ANTIGRAVITY_API_BASE = 'https://cloudcode-pa.googleapis.com';
export const ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINT = `${ANTIGRAVITY_API_BASE}/v1internal:loadCodeAssist`;
export const ANTIGRAVITY_ONBOARD_USER_ENDPOINT = `${ANTIGRAVITY_API_BASE}/v1internal:onboardUser`;
export const ANTIGRAVITY_GENERATE_CONTENT_ENDPOINT = `${ANTIGRAVITY_API_BASE}/v1internal:generateContent`;
export const ANTIGRAVITY_STREAM_GENERATE_CONTENT_ENDPOINT = `${ANTIGRAVITY_API_BASE}/v1internal:streamGenerateContent?alt=sse`;

// Transport identity headers. `ideType: ANTIGRAVITY` is the discriminator the
// Cloud Code backend uses to admit the Antigravity fleet. Versions are named
// constants (confirm at UAT — BRAG-Q1).
export const ANTIGRAVITY_CLIENT_VERSION = '0.1.0';
export const ANTIGRAVITY_USER_AGENT = `antigravity/${ANTIGRAVITY_CLIENT_VERSION}`;
export const ANTIGRAVITY_GOOG_API_CLIENT = `gl-node/${process.versions.node} antigravity/${ANTIGRAVITY_CLIENT_VERSION}`;
export const ANTIGRAVITY_CLIENT_METADATA = JSON.stringify({
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'ANTIGRAVITY',
});

// UNIFIED gateway fleet: one Google account serves ALL of these models. Modelled
// as the antigravity account transport's model-allowlist (NOT distinct mesh
// catalog ProviderIds). See decision brief.
export const ANTIGRAVITY_MODEL_FLEET = [
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gemini-3-pro-high',
  'gemini-3-pro-low',
  'gpt-oss-120b-medium',
] as const;

export type AntigravityModelId = (typeof ANTIGRAVITY_MODEL_FLEET)[number];

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const normalizeAntigravityExpiresAt = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeAntigravityExpiresAt(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const millis = value < 1e12 ? value * 1000 : value;
  return new Date(millis).toISOString();
};

export const buildAntigravityRedirectUri = (
  port: number = ANTIGRAVITY_DEFAULT_REDIRECT_PORT,
): string => `http://localhost:${port}${ANTIGRAVITY_REDIRECT_PATH}`;

const base64Url = (buf: Buffer): string => buf.toString('base64url');

export const generateAntigravityPkcePair = (): {
  codeVerifier: string;
  codeChallenge: string;
} => {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
};

export type AntigravityAuthorizationStart = {
  authorizeUrl: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
};

export const startAntigravityAuthorization = (input?: {
  clientId?: string;
  redirectUri?: string;
  redirectPort?: number;
  scopes?: string;
  authorizeUrl?: string;
}): AntigravityAuthorizationStart => {
  const { codeVerifier, codeChallenge } = generateAntigravityPkcePair();
  const state = base64Url(randomBytes(16));
  const redirectUri =
    input?.redirectUri ?? buildAntigravityRedirectUri(input?.redirectPort);
  const clientId = input?.clientId ?? ANTIGRAVITY_CLIENT_ID;
  const url = new URL(input?.authorizeUrl ?? ANTIGRAVITY_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', input?.scopes ?? ANTIGRAVITY_SCOPES);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return { authorizeUrl: url.toString(), codeVerifier, state, redirectUri };
};

export type AntigravityExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  scope: string | null;
};

export const exchangeAntigravityAuthorizationCode = async (input: {
  authorizationCode: string;
  codeVerifier: string;
  redirectUri?: string;
  redirectPort?: number;
  clientId?: string;
  tokenEndpoint?: string;
}): Promise<AntigravityExchangeResult> => {
  const authorizationCode = normalizeText(input.authorizationCode);
  const codeVerifier = normalizeText(input.codeVerifier);
  if (!authorizationCode) throw new Error('Antigravity authorization code is required.');
  if (!codeVerifier) throw new Error('Antigravity PKCE verifier is required.');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: input.redirectUri ?? buildAntigravityRedirectUri(input.redirectPort),
    client_id: input.clientId ?? ANTIGRAVITY_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(input.tokenEndpoint ?? ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Antigravity authorization exchange failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken = normalizeText(payload.access_token);
  const refreshToken = normalizeText(payload.refresh_token);
  if (!accessToken) throw new Error('Antigravity authorization exchange returned no access token.');
  if (!refreshToken) {
    throw new Error('Antigravity authorization exchange returned no refresh token.');
  }

  return {
    accessToken,
    refreshToken,
    expiresAt:
      normalizeAntigravityExpiresAt(payload.expires_at) ??
      (typeof payload.expires_in === 'number'
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : null),
    scope: normalizeText(payload.scope),
  };
};

export type AntigravityRefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
};

// Fix (2b): mint a fresh access token from the stored refresh token WITHOUT a
// manual re-login. Google's `grant_type=refresh_token` typically does NOT return
// a new refresh_token, so the stored one is retained.
export const refreshAntigravityAccessToken = async (input: {
  refreshToken: string;
  clientId?: string;
  tokenEndpoint?: string;
}): Promise<AntigravityRefreshResult> => {
  const refreshToken = normalizeText(input.refreshToken);
  if (!refreshToken) throw new Error('Antigravity refresh token is required.');

  const obtainedAt = Date.now();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: input.clientId ?? ANTIGRAVITY_CLIENT_ID,
  });

  const response = await fetch(input.tokenEndpoint ?? ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Antigravity token refresh failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken = normalizeText(payload.access_token);
  if (!accessToken) throw new Error('Antigravity token refresh returned no access token.');

  const expiresInSeconds =
    typeof payload.expires_in === 'number'
      ? payload.expires_in
      : typeof payload.expires_in === 'string'
        ? Number.parseInt(payload.expires_in, 10)
        : Number.NaN;

  return {
    accessToken,
    refreshToken: normalizeText(payload.refresh_token) ?? refreshToken,
    expiresAt:
      normalizeAntigravityExpiresAt(payload.expires_at) ??
      (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? new Date(obtainedAt + expiresInSeconds * 1000).toISOString()
        : null),
  };
};

// Cloud Code request headers. The dynamic `project` (from loadCodeAssist) is not
// a header — it travels in the request body — but the caller passes it so the
// header set can evolve without touching call sites.
export const buildAntigravityHeaders = (input: {
  accessToken: string;
}): Record<string, string> => ({
  Authorization: `Bearer ${input.accessToken}`,
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
  'X-Goog-Api-Client': ANTIGRAVITY_GOOG_API_CLIENT,
  'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
});

export type AntigravityProjectDiscovery = {
  project: string | null;
  tier: string | null;
  raw: Record<string, unknown>;
};

const readProjectClaim = (payload: Record<string, unknown>): string | null => {
  return (
    normalizeText(payload.cloudaicompanionProject) ??
    normalizeText(payload.project) ??
    normalizeText((payload.cloudaicompanionProject as Record<string, unknown> | undefined)?.id) ??
    null
  );
};

// Fix (2c): project discovery. Cloud Code binds the fleet to a GCP project id;
// run at enroll / first-use, then attach `project` to every generateContent /
// streamGenerateContent request body.
export const loadCodeAssist = async (input: {
  accessToken: string;
  metadata?: Record<string, unknown>;
  endpoint?: string;
}): Promise<AntigravityProjectDiscovery> => {
  const accessToken = normalizeText(input.accessToken);
  if (!accessToken) throw new Error('Antigravity access token is required.');

  const response = await fetch(input.endpoint ?? ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINT, {
    method: 'POST',
    headers: buildAntigravityHeaders({ accessToken }),
    body: JSON.stringify({
      metadata: {
        ideType: 'ANTIGRAVITY',
        ...(input.metadata ?? {}),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Antigravity loadCodeAssist failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const tierRaw = payload.currentTier as Record<string, unknown> | undefined;
  return {
    project: readProjectClaim(payload),
    tier: normalizeText(tierRaw?.id) ?? normalizeText(payload.tier),
    raw: payload,
  };
};

// Onboarding is required once per account before the fleet is callable.
export const onboardAntigravityUser = async (input: {
  accessToken: string;
  project: string;
  tierId?: string;
  endpoint?: string;
}): Promise<Record<string, unknown>> => {
  const accessToken = normalizeText(input.accessToken);
  const project = normalizeText(input.project);
  if (!accessToken) throw new Error('Antigravity access token is required.');
  if (!project) throw new Error('Antigravity project is required for onboarding.');

  const response = await fetch(input.endpoint ?? ANTIGRAVITY_ONBOARD_USER_ENDPOINT, {
    method: 'POST',
    headers: buildAntigravityHeaders({ accessToken }),
    body: JSON.stringify({
      tierId: input.tierId ?? 'free-tier',
      cloudaicompanionProject: project,
      metadata: { ideType: 'ANTIGRAVITY' },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Antigravity onboardUser failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
};

export type AntigravityUserInfo = {
  sub: string | null;
  email: string | null;
  name: string | null;
};

export const fetchAntigravityUserInfo = async (input: {
  accessToken: string;
  userInfoUrl?: string;
}): Promise<AntigravityUserInfo> => {
  const accessToken = normalizeText(input.accessToken);
  if (!accessToken) throw new Error('Antigravity access token is required.');

  const response = await fetch(input.userInfoUrl ?? ANTIGRAVITY_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Antigravity userinfo lookup failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    sub: normalizeText(payload.sub),
    email: normalizeText(payload.email),
    name: normalizeText(payload.name),
  };
};
