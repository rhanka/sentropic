const CLAUDE_CODE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
const CLAUDE_CODE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export type ClaudeCodeRefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
};

export type ClaudeCodeProfile = {
  accountUuid: string | null;
  email: string | null;
  name: string | null;
  orgName: string | null;
  orgType: string | null;
  hasClaudeMax: boolean | null;
  hasClaudePro: boolean | null;
};

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const normalizeClaudeCodeExpiresAt = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeClaudeCodeExpiresAt(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const millis = value < 1e12 ? value * 1000 : value;
  return new Date(millis).toISOString();
};

export const refreshClaudeCodeAccessToken = async (input: {
  refreshToken: string;
  tokenEndpoint?: string;
  clientId?: string;
}): Promise<ClaudeCodeRefreshResult> => {
  const refreshToken = normalizeText(input.refreshToken);
  if (!refreshToken) throw new Error('Claude Code refresh token is required.');

  const response = await fetch(input.tokenEndpoint ?? CLAUDE_CODE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'axios/1.13.6',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: input.clientId ?? CLAUDE_CODE_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Claude Code token refresh failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const accessToken = normalizeText(payload.access_token);
  if (!accessToken) throw new Error('Claude Code token refresh returned no access token.');

  return {
    accessToken,
    refreshToken: normalizeText(payload.refresh_token) ?? refreshToken,
    expiresAt:
      normalizeClaudeCodeExpiresAt(payload.expires_at) ??
      (typeof payload.expires_in === 'number'
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : null),
  };
};

export const fetchClaudeCodeProfile = async (input: {
  accessToken: string;
  profileUrl?: string;
}): Promise<ClaudeCodeProfile> => {
  const accessToken = normalizeText(input.accessToken);
  if (!accessToken) throw new Error('Claude Code access token is required.');

  const response = await fetch(input.profileUrl ?? CLAUDE_CODE_PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Claude Code profile lookup failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const account = payload.account as Record<string, unknown> | undefined;
  const organization = payload.organization as Record<string, unknown> | undefined;
  return {
    accountUuid: normalizeText(account?.uuid),
    email: normalizeText(account?.email),
    name: normalizeText(account?.display_name),
    orgName: normalizeText(organization?.name),
    orgType: normalizeText(organization?.organization_type),
    hasClaudeMax: typeof account?.has_claude_max === 'boolean' ? account.has_claude_max : null,
    hasClaudePro: typeof account?.has_claude_pro === 'boolean' ? account.has_claude_pro : null,
  };
};
