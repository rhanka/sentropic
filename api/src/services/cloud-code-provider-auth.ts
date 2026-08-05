export const CLOUD_CODE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CLOUD_CODE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const CLOUD_CODE_LOAD_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
export const CLOUD_CODE_USER_AGENT =
  'antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)';

export interface CloudCodeUserInfo {
  id: string | null;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface CloudCodeOnboardingResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  cloudaicompanionProject: string;
  email: string | null;
  externalAccountId: string | null;
  profile: Record<string, unknown> | null;
}

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const fetchCloudCodeUserInfo = async (
  accessToken: string,
  fetchFn = fetch,
): Promise<CloudCodeUserInfo | null> => {
  const token = normalizeText(accessToken);
  if (!token) return null;

  try {
    const response = await fetchFn(CLOUD_CODE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      id: normalizeText(payload.id) ?? normalizeText(payload.sub),
      email: normalizeText(payload.email),
      name: normalizeText(payload.name),
      picture: normalizeText(payload.picture),
    };
  } catch {
    return null;
  }
};

export const loadCodeAssist = async (
  accessToken: string,
  fetchFn = fetch,
): Promise<{ cloudaicompanionProject: string }> => {
  const token = normalizeText(accessToken);
  if (!token) {
    throw new Error('Cloud Code access token is required');
  }

  const response = await fetchFn(CLOUD_CODE_LOAD_CODE_ASSIST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': CLOUD_CODE_USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Cloud Code loadCodeAssist failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { cloudaicompanionProject?: string };
  const project = normalizeText(payload.cloudaicompanionProject);
  if (!project) {
    throw new Error('Cloud Code loadCodeAssist returned no cloudaicompanionProject');
  }

  return { cloudaicompanionProject: project };
};

export const onboardCloudCodeUser = async (
  input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId?: string;
    clientSecret?: string;
  },
  fetchFn = fetch,
): Promise<CloudCodeOnboardingResult> => {
  const code = normalizeText(input.code);
  const codeVerifier = normalizeText(input.codeVerifier);
  const redirectUri = normalizeText(input.redirectUri);
  if (!code || !codeVerifier || !redirectUri) {
    throw new Error('Cloud Code onboarding requires code, codeVerifier, and redirectUri');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: input.clientId ?? 'mock-cloud-code-client-id',
    client_secret: input.clientSecret ?? 'mock-cloud-code-client-secret',
    code_verifier: codeVerifier,
  });

  const response = await fetchFn(CLOUD_CODE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Cloud Code OAuth token exchange failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const accessToken = normalizeText(payload.access_token);
  if (!accessToken) {
    throw new Error('Cloud Code token exchange returned no access token');
  }

  const refreshToken = normalizeText(payload.refresh_token);
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { cloudaicompanionProject } = await loadCodeAssist(accessToken, fetchFn);
  const userInfo = await fetchCloudCodeUserInfo(accessToken, fetchFn);
  const externalAccountId = userInfo?.id ?? userInfo?.email ?? null;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    cloudaicompanionProject,
    email: userInfo?.email ?? null,
    externalAccountId,
    profile: userInfo ? { ...userInfo } : null,
  };
};
