import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { pool, db } from '../db/client';
import { env } from '../config/env';
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { refreshClaudeCodeAccessToken } from './claude-code-provider-auth';
import { refreshCodexAccessToken } from './codex-provider-auth';
import { refreshAntigravityAccessToken } from './antigravity-provider-auth';

export type LlmAccountTransportStatus =
  | 'active'
  | 'cooldown'
  | 'reauth_required'
  | 'disabled'
  | 'disconnected';

export type LlmAccountTransportPublic = {
  id: string;
  targetProviderId: string;
  transportProviderId: string;
  externalAccountId: string | null;
  accountLabel: string | null;
  status: LlmAccountTransportStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type LlmAccountTransportAcquisition = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  accountId: string | null;
  accountLabel: string | null;
  stableSessionId: string;
  accountTransportAccountId: string;
  leaseId: string;
  reservationId: string;
  transportProviderId: string;
  metadata?: Record<string, unknown> | null;
  recordOutcome(input: LlmAccountTransportOutcomeInput): Promise<void>;
};

export type CodexAccountTransportAcquisition = LlmAccountTransportAcquisition;
export type ClaudeCodeAccountTransportAcquisition = LlmAccountTransportAcquisition;
export type AntigravityAccountTransportAcquisition = LlmAccountTransportAcquisition;
export type GeminiCodeAssistAccountTransportAcquisition = LlmAccountTransportAcquisition;
export type CloudCodeAccountTransportAcquisition = LlmAccountTransportAcquisition;

export type LlmAccountTransportOutcomeInput = {
  status: 'success' | 'failed' | 'rate_limited' | 'auth_failed';
  providerStatusCode?: number | null;
  retryAfterMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type CodexTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'codex-device' | 'legacy-codex-setting' | 'codex-refresh';
};

export type ClaudeCodeTokenSecretPayload = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'claude-code-import' | 'claude-code-refresh';
  clientId: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  profile: Record<string, unknown> | null;
};

export type AntigravityTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'antigravity-import' | 'antigravity-refresh';
  // GCP project bound to the Google account (discovered via loadCodeAssist);
  // injected into every cloudcode-pa v1internal request body.
  project: string | null;
  tier: string | null;
  profile: Record<string, unknown> | null;
};

export type CloudCodeTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'cloud-code-import' | 'cloud-code-refresh';
  cloudaicompanionProject: string;
  clientId: string | null;
  clientSecret?: string | null;
  authClientConfigVersion?: string | null;
  profile: Record<string, unknown> | null;
};

export type GeminiCodeAssistTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'antigravity-import' | 'antigravity-refresh';
  // GCP project bound to the Google account (discovered via loadCodeAssist);
  // injected into every cloudcode-pa v1internal request body.
  project: string | null;
  tier: string | null;
  profile: Record<string, unknown> | null;
};

type AccountSelectionRow = {
  account_id: string;
  external_account_id: string | null;
  account_label: string | null;
  token_secret: string | null;
  token_expires_at: Date | string | null;
  model_allowlist: unknown;
  metadata: unknown;
};

type LeaseSelectionRow = AccountSelectionRow & {
  lease_id: string;
  stable_session_id: string;
  account_status: string;
  cooldown_until: Date | string | null;
};

type AcquisitionRow = AccountSelectionRow & {
  lease_id: string;
  stable_session_id: string;
  reservation_id: string;
};

const CODEX_TARGET_PROVIDER_ID = 'openai';
const CODEX_TRANSPORT_PROVIDER_ID = 'codex';
const CLAUDE_CODE_TARGET_PROVIDER_ID = 'anthropic';
const CLAUDE_CODE_TRANSPORT_PROVIDER_ID = 'claude-code';
// Antigravity is a genuinely distinct 3rd endpoint (cloudcode-pa). It targets
// its OWN provider id so the account pool stays disjoint from codex/claude-code
// (selection is keyed by BOTH target + transport provider ids).
const ANTIGRAVITY_TARGET_PROVIDER_ID = 'cloudcode-pa';
const ANTIGRAVITY_TRANSPORT_PROVIDER_ID = 'antigravity';

const CLOUD_CODE_TARGET_PROVIDER_ID = 'gemini';
const CLOUD_CODE_TRANSPORT_PROVIDER_ID = 'cloud-code';
const GEMINI_CODE_ASSIST_TARGET_PROVIDER_ID = 'gcp';
const GEMINI_CODE_ASSIST_TRANSPORT_PROVIDER_ID = 'gemini-code-assist';
const RESERVATION_TTL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const codexRefreshes = new Map<string, Promise<CodexTokenSecretPayload | null>>();
const claudeCodeRefreshes = new Map<string, Promise<ClaudeCodeTokenSecretPayload | null>>();
const antigravityRefreshes = new Map<string, Promise<AntigravityTokenSecretPayload | null>>();
const cloudCodeRefreshes = new Map<string, Promise<CloudCodeTokenSecretPayload | null>>();

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const decodeJwtPayload = (jwt: string | null | undefined): Record<string, unknown> | null => {
  if (!jwt) return null;
  const [, payload] = jwt.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readJwtStringClaim = (claims: Record<string, unknown> | null, key: string): string | null => {
  const value = claims?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

export const inferCodexAccountIdFromToken = (
  accessToken: string,
  idToken?: string | null,
): string | null => {
  const accessClaims = decodeJwtPayload(accessToken);
  const idClaims = idToken ? decodeJwtPayload(idToken) : null;
  const authClaim = (accessClaims?.['https://api.openai.com/auth'] ??
    idClaims?.['https://api.openai.com/auth']) as Record<string, unknown> | null | undefined;
  const orgs = (accessClaims?.organizations ?? idClaims?.organizations) as unknown;
  const firstOrg = Array.isArray(orgs) ? (orgs[0] as Record<string, unknown> | undefined) : undefined;
  return (
    readJwtStringClaim(accessClaims, 'chatgpt_account_id') ||
    readJwtStringClaim(idClaims, 'chatgpt_account_id') ||
    readJwtStringClaim(accessClaims, 'https://api.openai.com/auth.chatgpt_account_id') ||
    readJwtStringClaim(idClaims, 'https://api.openai.com/auth.chatgpt_account_id') ||
    (authClaim && typeof authClaim.chatgpt_account_id === 'string' ? authClaim.chatgpt_account_id.trim() : null) ||
    (firstOrg && typeof firstOrg.id === 'string' ? firstOrg.id.trim() : null)
  );
};

export const inferTokenExpiresAt = (
  accessToken: string | null | undefined,
  idToken?: string | null,
): string | null => {
  const accessExp = decodeJwtPayload(accessToken)?.exp;
  const idExp = decodeJwtPayload(idToken)?.exp;
  const exp =
    typeof accessExp === 'number'
      ? accessExp
      : typeof idExp === 'number'
        ? idExp
        : null;
  return exp && exp > 0 ? new Date(exp * 1000).toISOString() : null;
};

const parseCodexTokenSecret = (value: string | null | undefined): CodexTokenSecretPayload | null => {
  const decrypted = decryptSecretOrNull(value);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<CodexTokenSecretPayload> | null;
    const accessToken = normalizeOptionalText(parsed?.accessToken);
    if (!parsed || !accessToken) return null;
    return {
      accessToken,
      refreshToken: normalizeOptionalText(parsed.refreshToken),
      idToken: normalizeOptionalText(parsed.idToken),
      tokenType: 'bearer',
      obtainedAt: normalizeOptionalText(parsed.obtainedAt) ?? new Date().toISOString(),
      expiresAt: normalizeOptionalText(parsed.expiresAt),
      source:
        parsed.source === 'legacy-codex-setting' || parsed.source === 'codex-refresh'
          ? parsed.source
          : 'codex-device',
    };
  } catch {
    return null;
  }
};

const parseClaudeCodeTokenSecret = (
  value: string | null | undefined,
): ClaudeCodeTokenSecretPayload | null => {
  const decrypted = decryptSecretOrNull(value);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<ClaudeCodeTokenSecretPayload> | null;
    const accessToken = normalizeOptionalText(parsed?.accessToken);
    const refreshToken = normalizeOptionalText(parsed?.refreshToken);
    if (!parsed || !accessToken || !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      tokenType: 'bearer',
      obtainedAt: normalizeOptionalText(parsed.obtainedAt) ?? new Date().toISOString(),
      expiresAt: normalizeOptionalText(parsed.expiresAt),
      source: parsed.source === 'claude-code-refresh' ? 'claude-code-refresh' : 'claude-code-import',
      clientId: normalizeOptionalText(parsed.clientId),
      subscriptionType: normalizeOptionalText(parsed.subscriptionType),
      rateLimitTier: normalizeOptionalText(parsed.rateLimitTier),
      profile:
        parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
          ? parsed.profile as Record<string, unknown>
          : null,
    };
  } catch {
    return null;
  }
};

const parseCloudCodeTokenSecret = (
  value: string | null | undefined,
): CloudCodeTokenSecretPayload | null => {
  const decrypted = decryptSecretOrNull(value);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<CloudCodeTokenSecretPayload> | null;
    const accessToken = normalizeOptionalText(parsed?.accessToken);
    const cloudaicompanionProject = normalizeOptionalText(parsed?.cloudaicompanionProject);
    if (!parsed || !accessToken || !cloudaicompanionProject) return null;
    return {
      accessToken,
      refreshToken: normalizeOptionalText(parsed.refreshToken),
      tokenType: 'bearer',
      obtainedAt: normalizeOptionalText(parsed.obtainedAt) ?? new Date().toISOString(),
      expiresAt: normalizeOptionalText(parsed.expiresAt),
      source: parsed.source === 'cloud-code-refresh' ? 'cloud-code-refresh' : 'cloud-code-import',
      cloudaicompanionProject,
      clientId: normalizeOptionalText(parsed.clientId),
      clientSecret: normalizeOptionalText(parsed.clientSecret),
      authClientConfigVersion: normalizeOptionalText(parsed.authClientConfigVersion),
      profile:
        parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
          ? (parsed.profile as Record<string, unknown>)
          : null,
    };
  } catch {
    return null;
  }
};

const parseGeminiCodeAssistTokenSecret = (
  value: string | null | undefined,
): AntigravityTokenSecretPayload | null => {
  const decrypted = decryptSecretOrNull(value);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<AntigravityTokenSecretPayload> | null;
    const accessToken = normalizeOptionalText(parsed?.accessToken);
    if (!parsed || !accessToken) return null;
    return {
      accessToken,
      refreshToken: normalizeOptionalText(parsed.refreshToken),
      tokenType: 'bearer',
      obtainedAt: normalizeOptionalText(parsed.obtainedAt) ?? new Date().toISOString(),
      expiresAt: normalizeOptionalText(parsed.expiresAt),
      source: parsed.source === 'antigravity-refresh' ? 'antigravity-refresh' : 'antigravity-import',
      project: normalizeOptionalText(parsed.project),
      tier: normalizeOptionalText(parsed.tier),
      profile:
        parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
          ? parsed.profile as Record<string, unknown>
          : null,
    };
  } catch {
    return null;
  }
};

const parseAntigravityTokenSecret = parseGeminiCodeAssistTokenSecret;

const buildAntigravityTokenPayload = (input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  source: AntigravityTokenSecretPayload['source'];
  project?: string | null;
  tier?: string | null;
  profile?: Record<string, unknown> | null;
}): AntigravityTokenSecretPayload => ({
  accessToken: input.accessToken,
  refreshToken: input.refreshToken ?? null,
  tokenType: 'bearer',
  obtainedAt: new Date().toISOString(),
  expiresAt: input.expiresAt ?? null,
  source: input.source,
  project: normalizeOptionalText(input.project),
  tier: normalizeOptionalText(input.tier),
  profile: input.profile ?? null,
});

const isTokenExpiring = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now() + TOKEN_REFRESH_SKEW_MS;
};

const computeStableSessionId = (input: {
  workspaceId: string | null;
  userId: string | null;
  affinityKey: string;
  targetProviderId: string;
  transportProviderId: string;
  modelId: string;
  leaseId: string;
  prefix: string;
}): string => {
  const secret = env.JWT_SECRET || 'dev-secret-key-change-in-production-please';
  const digest = createHmac('sha256', secret)
    .update([
      input.workspaceId ?? '',
      input.userId ?? '',
      input.affinityKey,
      input.targetProviderId,
      input.transportProviderId,
      input.modelId,
      input.leaseId,
    ].join('\u001f'))
    .digest('base64url')
    .slice(0, 32);
  return `${input.prefix}_${digest}`;
};

const buildTokenPayload = (input: {
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  expiresAt?: string | null;
  source: CodexTokenSecretPayload['source'];
}): CodexTokenSecretPayload => ({
  accessToken: input.accessToken,
  refreshToken: input.refreshToken ?? null,
  idToken: input.idToken ?? null,
  tokenType: 'bearer',
  obtainedAt: new Date().toISOString(),
  expiresAt: input.expiresAt ?? inferTokenExpiresAt(input.accessToken, input.idToken),
  source: input.source,
});

const buildClaudeCodeTokenPayload = (input: {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string | null;
  source: ClaudeCodeTokenSecretPayload['source'];
  clientId?: string | null;
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
  profile?: Record<string, unknown> | null;
}): ClaudeCodeTokenSecretPayload => ({
  accessToken: input.accessToken,
  refreshToken: input.refreshToken,
  tokenType: 'bearer',
  obtainedAt: new Date().toISOString(),
  expiresAt: input.expiresAt ?? null,
  source: input.source,
  clientId: normalizeOptionalText(input.clientId),
  subscriptionType: normalizeOptionalText(input.subscriptionType),
  rateLimitTier: normalizeOptionalText(input.rateLimitTier),
  profile: input.profile ?? null,
});

const buildCloudCodeTokenPayload = (input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  source: CloudCodeTokenSecretPayload['source'];
  cloudaicompanionProject: string;
  clientId?: string | null;
  clientSecret?: string | null;
  authClientConfigVersion?: string | null;
  profile?: Record<string, unknown> | null;
}): CloudCodeTokenSecretPayload => ({
  accessToken: input.accessToken,
  refreshToken: normalizeOptionalText(input.refreshToken),
  tokenType: 'bearer',
  obtainedAt: new Date().toISOString(),
  expiresAt: normalizeOptionalText(input.expiresAt),
  source: input.source,
  cloudaicompanionProject: input.cloudaicompanionProject,
  clientId: normalizeOptionalText(input.clientId),
  clientSecret: normalizeOptionalText(input.clientSecret),
  authClientConfigVersion: normalizeOptionalText(input.authClientConfigVersion),
  profile: input.profile ?? null,
});

export const storeCodexAccountTransport = async (input: {
  ownerUserId: string;
  accountLabel?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  source?: CodexTokenSecretPayload['source'];
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const accessToken = normalizeOptionalText(input.accessToken);
  if (!ownerUserId || !accessToken) return null;

  const token = buildTokenPayload({
    accessToken,
    refreshToken: normalizeOptionalText(input.refreshToken),
    idToken: normalizeOptionalText(input.idToken),
    source: input.source ?? 'codex-device',
  });
  const externalAccountId = inferCodexAccountIdFromToken(token.accessToken, token.idToken);
  const now = new Date();
  const accountId = createId();
  const tokenSecret = encryptSecret(JSON.stringify(token));
  const accountLabel = normalizeOptionalText(input.accountLabel);

  await db.run(sql`
    INSERT INTO llm_provider_accounts (
      id,
      owner_user_id,
      scope,
      target_provider_id,
      transport_provider_id,
      external_account_id,
      account_label,
      status,
      token_secret,
      token_expires_at,
      connected_at,
      disconnected_at,
      last_error,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${ownerUserId},
      'user',
      ${CODEX_TARGET_PROVIDER_ID},
      ${CODEX_TRANSPORT_PROVIDER_ID},
      ${externalAccountId},
      ${accountLabel},
      'active',
      ${tokenSecret},
      ${token.expiresAt ? new Date(token.expiresAt) : null},
      ${now},
      NULL,
      NULL,
      ${JSON.stringify({ source: token.source })}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (
      owner_user_id,
      target_provider_id,
      transport_provider_id,
      external_account_id
    )
    WHERE external_account_id IS NOT NULL
    DO UPDATE SET
      account_label = COALESCE(EXCLUDED.account_label, llm_provider_accounts.account_label),
      status = 'active',
      token_secret = EXCLUDED.token_secret,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = EXCLUDED.connected_at,
      disconnected_at = NULL,
      last_error = NULL,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `);

  return getPrimaryCodexAccountTransport({ ownerUserId });
};

export const storeClaudeCodeAccountTransport = async (input: {
  ownerUserId: string;
  accountLabel?: string | null;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt?: string | null;
  clientId?: string | null;
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
  profile?: Record<string, unknown> | null;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const externalAccountId = normalizeOptionalText(input.externalAccountId);
  const accessToken = normalizeOptionalText(input.accessToken);
  const refreshToken = normalizeOptionalText(input.refreshToken);
  if (!ownerUserId || !externalAccountId || !accessToken || !refreshToken) return null;

  const token = buildClaudeCodeTokenPayload({
    accessToken,
    refreshToken,
    expiresAt: normalizeOptionalText(input.expiresAt),
    source: 'claude-code-import',
    clientId: input.clientId,
    subscriptionType: input.subscriptionType,
    rateLimitTier: input.rateLimitTier,
    profile: input.profile,
  });
  const now = new Date();
  const accountId = createId();
  const tokenSecret = encryptSecret(JSON.stringify(token));
  const accountLabel = normalizeOptionalText(input.accountLabel);
  const metadata = {
    source: token.source,
    credentialSchemaVersion: 1,
    productAccountSource: 'claude-code',
    endpointFamily: 'anthropic-messages',
    clientId: token.clientId,
    subscriptionType: token.subscriptionType,
    rateLimitTier: token.rateLimitTier,
    profile: token.profile,
  };

  await db.run(sql`
    INSERT INTO llm_provider_accounts (
      id,
      owner_user_id,
      scope,
      target_provider_id,
      transport_provider_id,
      external_account_id,
      account_label,
      status,
      token_secret,
      token_expires_at,
      connected_at,
      disconnected_at,
      last_error,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${ownerUserId},
      'user',
      ${CLAUDE_CODE_TARGET_PROVIDER_ID},
      ${CLAUDE_CODE_TRANSPORT_PROVIDER_ID},
      ${externalAccountId},
      ${accountLabel},
      'active',
      ${tokenSecret},
      ${token.expiresAt ? new Date(token.expiresAt) : null},
      ${now},
      NULL,
      NULL,
      ${JSON.stringify(metadata)}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (
      owner_user_id,
      target_provider_id,
      transport_provider_id,
      external_account_id
    )
    WHERE external_account_id IS NOT NULL
    DO UPDATE SET
      account_label = COALESCE(EXCLUDED.account_label, llm_provider_accounts.account_label),
      status = 'active',
      token_secret = EXCLUDED.token_secret,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = EXCLUDED.connected_at,
      disconnected_at = NULL,
      last_error = NULL,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `);

  return getPrimaryClaudeCodeAccountTransport({ ownerUserId });
};

export const getPrimaryCodexAccountTransport = async (input: {
  ownerUserId: string;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return null;
  const rows = await db.all(sql`
    SELECT
      id,
      target_provider_id as "targetProviderId",
      transport_provider_id as "transportProviderId",
      external_account_id as "externalAccountId",
      account_label as "accountLabel",
      status,
      connected_at as "connectedAt",
      disconnected_at as "disconnectedAt",
      token_expires_at as "tokenExpiresAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
      AND status <> 'disconnected'
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'cooldown' THEN 1
        WHEN 'reauth_required' THEN 2
        ELSE 3
      END,
      connected_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `) as Array<{
    id: string;
    targetProviderId: string;
    transportProviderId: string;
    externalAccountId: string | null;
    accountLabel: string | null;
    status: LlmAccountTransportStatus;
    connectedAt: Date | string | null;
    disconnectedAt: Date | string | null;
    tokenExpiresAt: Date | string | null;
    lastError: string | null;
    updatedAt: Date | string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetProviderId: row.targetProviderId,
    transportProviderId: row.transportProviderId,
    externalAccountId: row.externalAccountId,
    accountLabel: row.accountLabel,
    status: row.status,
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    lastError: row.lastError,
    updatedAt: toIso(row.updatedAt),
  };
};

export const getPrimaryClaudeCodeAccountTransport = async (input: {
  ownerUserId: string;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return null;
  const rows = await db.all(sql`
    SELECT
      id,
      target_provider_id as "targetProviderId",
      transport_provider_id as "transportProviderId",
      external_account_id as "externalAccountId",
      account_label as "accountLabel",
      status,
      connected_at as "connectedAt",
      disconnected_at as "disconnectedAt",
      token_expires_at as "tokenExpiresAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CLAUDE_CODE_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CLAUDE_CODE_TRANSPORT_PROVIDER_ID}
      AND status <> 'disconnected'
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'cooldown' THEN 1
        WHEN 'reauth_required' THEN 2
        ELSE 3
      END,
      connected_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `) as Array<{
    id: string;
    targetProviderId: string;
    transportProviderId: string;
    externalAccountId: string | null;
    accountLabel: string | null;
    status: LlmAccountTransportStatus;
    connectedAt: Date | string | null;
    disconnectedAt: Date | string | null;
    tokenExpiresAt: Date | string | null;
    lastError: string | null;
    updatedAt: Date | string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetProviderId: row.targetProviderId,
    transportProviderId: row.transportProviderId,
    externalAccountId: row.externalAccountId,
    accountLabel: row.accountLabel,
    status: row.status,
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    lastError: row.lastError,
    updatedAt: toIso(row.updatedAt),
  };
};

export const disconnectCodexAccountTransports = async (input: {
  ownerUserId: string;
}): Promise<void> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return;
  const now = new Date();
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET
      status = 'disconnected',
      token_secret = NULL,
      token_expires_at = NULL,
      disconnected_at = ${now},
      last_error = NULL,
      updated_at = ${now}
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
  `);
  await db.run(sql`
    UPDATE llm_account_leases
    SET status = 'invalidated', released_at = ${now}, updated_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
};

export const disconnectClaudeCodeAccountTransports = async (input: {
  ownerUserId: string;
}): Promise<void> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return;
  const now = new Date();
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET
      status = 'disconnected',
      token_secret = NULL,
      token_expires_at = NULL,
      disconnected_at = ${now},
      last_error = NULL,
      updated_at = ${now}
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CLAUDE_CODE_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CLAUDE_CODE_TRANSPORT_PROVIDER_ID}
  `);
  await db.run(sql`
    UPDATE llm_account_leases
    SET status = 'invalidated', released_at = ${now}, updated_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CLAUDE_CODE_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CLAUDE_CODE_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CLAUDE_CODE_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CLAUDE_CODE_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
};

export const storeAntigravityAccountTransport = async (input: {
  ownerUserId: string;
  accountLabel?: string | null;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt?: string | null;
  project?: string | null;
  tier?: string | null;
  profile?: Record<string, unknown> | null;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const externalAccountId = normalizeOptionalText(input.externalAccountId);
  const accessToken = normalizeOptionalText(input.accessToken);
  const refreshToken = normalizeOptionalText(input.refreshToken);
  if (!ownerUserId || !externalAccountId || !accessToken || !refreshToken) return null;

  const token = buildAntigravityTokenPayload({
    accessToken,
    refreshToken,
    expiresAt: normalizeOptionalText(input.expiresAt),
    source: 'antigravity-import',
    project: input.project,
    tier: input.tier,
    profile: input.profile,
  });

  const now = new Date();
  const accountId = createId();
  const tokenSecret = encryptSecret(JSON.stringify(token));
  const accountLabel = normalizeOptionalText(input.accountLabel);

  // `project` lives in metadata (read at acquire time and injected into every
  // cloudcode-pa v1internal request body); it survives token refresh because
  // refresh only rewrites token_secret + token_expires_at.
  const metadata = {
    source: token.source,
    credentialSchemaVersion: 1,
    productAccountSource: 'antigravity',
    endpointFamily: 'cloudcode-pa-v1internal',
    project: token.project,
    tier: token.tier,
    profile: token.profile,
  };

  await db.run(sql`
    INSERT INTO llm_provider_accounts (
      id,
      owner_user_id,
      scope,
      target_provider_id,
      transport_provider_id,
      external_account_id,
      account_label,
      status,
      token_secret,
      token_expires_at,
      connected_at,
      disconnected_at,
      last_error,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${ownerUserId},
      'user',
      ${ANTIGRAVITY_TARGET_PROVIDER_ID},
      ${ANTIGRAVITY_TRANSPORT_PROVIDER_ID},
      ${externalAccountId},
      ${accountLabel},
      'active',
      ${tokenSecret},
      ${token.expiresAt ? new Date(token.expiresAt) : null},
      ${now},
      NULL,
      NULL,
      ${JSON.stringify(metadata)}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (
      owner_user_id,
      target_provider_id,
      transport_provider_id,
      external_account_id
    )
    WHERE external_account_id IS NOT NULL
    DO UPDATE SET
      account_label = COALESCE(EXCLUDED.account_label, llm_provider_accounts.account_label),
      status = 'active',
      token_secret = EXCLUDED.token_secret,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = EXCLUDED.connected_at,
      disconnected_at = NULL,
      last_error = NULL,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `);

  return getPrimaryAntigravityAccountTransport({ ownerUserId });
};

export const storeCloudCodeAccountTransport = async (input: {
  ownerUserId: string;
  accountLabel?: string | null;
  externalAccountId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  cloudaicompanionProject: string;
  clientId?: string | null;
  clientSecret?: string | null;
  authClientConfigVersion?: string | null;
  source?: CloudCodeTokenSecretPayload['source'];
  profile?: Record<string, unknown> | null;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const accessToken = normalizeOptionalText(input.accessToken);
  const cloudaicompanionProject = normalizeOptionalText(input.cloudaicompanionProject);
  if (!ownerUserId || !accessToken || !cloudaicompanionProject) return null;

  const token = buildCloudCodeTokenPayload({
    accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    source: input.source ?? 'cloud-code-import',
    cloudaicompanionProject,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    authClientConfigVersion: input.authClientConfigVersion,
    profile: input.profile,
  });

  const now = new Date();
  const accountId = createId();
  const tokenSecret = encryptSecret(JSON.stringify(token));
  const accountLabel = normalizeOptionalText(input.accountLabel);

  const externalAccountId = normalizeOptionalText(input.externalAccountId) ?? \`cc_\${accountId.slice(0, 8)}\`;
  const metadata = {
    source: token.source,
    credentialSchemaVersion: 1,
    productAccountSource: 'cloud-code',
    clientId: token.clientId,
    authClientConfigVersion: token.authClientConfigVersion,
    profile: token.profile,
  };

  await db.run(sql`
    INSERT INTO llm_provider_accounts (
      id,
      owner_user_id,
      scope,
      target_provider_id,
      transport_provider_id,
      external_account_id,
      account_label,
      status,
      token_secret,
      token_expires_at,
      connected_at,
      disconnected_at,
      last_error,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${ownerUserId},
      'user',
      ${CLOUD_CODE_TARGET_PROVIDER_ID},
      ${CLOUD_CODE_TRANSPORT_PROVIDER_ID},
      ${externalAccountId},
      ${accountLabel},
      'active',
      ${tokenSecret},
      ${token.expiresAt ? new Date(token.expiresAt) : null},
      ${now},
      NULL,
      NULL,
      ${JSON.stringify(metadata)}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (
      owner_user_id,
      target_provider_id,
      transport_provider_id,
      external_account_id
    )
    WHERE external_account_id IS NOT NULL
    DO UPDATE SET
      account_label = COALESCE(EXCLUDED.account_label, llm_provider_accounts.account_label),
      status = 'active',
      token_secret = EXCLUDED.token_secret,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = EXCLUDED.connected_at,
      disconnected_at = NULL,
      last_error = NULL,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `);

  return getPrimaryCloudCodeAccountTransport({ ownerUserId });
};

export const getPrimaryAntigravityAccountTransport = async (input: {
  ownerUserId: string;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return null;
  const rows = await db.all(sql`
    SELECT
      id,
      target_provider_id as "targetProviderId",
      transport_provider_id as "transportProviderId",
      external_account_id as "externalAccountId",
      account_label as "accountLabel",
      status,
      connected_at as "connectedAt",
      disconnected_at as "disconnectedAt",
      token_expires_at as "tokenExpiresAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${ANTIGRAVITY_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${ANTIGRAVITY_TRANSPORT_PROVIDER_ID}
      AND status <> 'disconnected'
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'cooldown' THEN 1
        WHEN 'reauth_required' THEN 2
        ELSE 3
      END,
      connected_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `) as Array<{
    id: string;
    targetProviderId: string;
    transportProviderId: string;
    externalAccountId: string | null;
    accountLabel: string | null;
    status: LlmAccountTransportStatus;
    connectedAt: Date | string | null;
    disconnectedAt: Date | string | null;
    tokenExpiresAt: Date | string | null;
    lastError: string | null;
    updatedAt: Date | string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetProviderId: row.targetProviderId,
    transportProviderId: row.transportProviderId,
    externalAccountId: row.externalAccountId,
    accountLabel: row.accountLabel,
    status: row.status,
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    lastError: row.lastError,
    updatedAt: toIso(row.updatedAt),
  };
};

export const getPrimaryCloudCodeAccountTransport = async (input: {
  ownerUserId: string;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return null;
  const rows = (await db.all(sql`
    SELECT
      id,
      target_provider_id as "targetProviderId",
      transport_provider_id as "transportProviderId",
      external_account_id as "externalAccountId",
      accountLabel: string | null;
      account_label as "accountLabel",
      status,
      connected_at as "connectedAt",
      disconnected_at as "disconnectedAt",
      token_expires_at as "tokenExpiresAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CLOUD_CODE_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CLOUD_CODE_TRANSPORT_PROVIDER_ID}
      AND status <> 'disconnected'
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'cooldown' THEN 1
        WHEN 'reauth_required' THEN 2
        ELSE 3
      END,
      connected_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `)) as Array<{
    id: string;
    targetProviderId: string;
    transportProviderId: string;
    externalAccountId: string | null;
    accountLabel: string | null;
    status: LlmAccountTransportStatus;
    connectedAt: Date | string | null;
    disconnectedAt: Date | string | null;
    tokenExpiresAt: Date | string | null;
    lastError: string | null;
    updatedAt: Date | string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetProviderId: row.targetProviderId,
    transportProviderId: row.transportProviderId,
    externalAccountId: row.externalAccountId,
    accountLabel: row.accountLabel,
    status: row.status,
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    lastError: row.lastError,
    updatedAt: toIso(row.updatedAt),
  };
};

export const disconnectAntigravityAccountTransports = async (input: {
  ownerUserId: string;
}): Promise<void> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return;
  const now = new Date();
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET
      status = 'disconnected',
      token_secret = NULL,
      token_expires_at = NULL,
      disconnected_at = ${now},
      last_error = NULL,
      updated_at = ${now}
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${ANTIGRAVITY_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${ANTIGRAVITY_TRANSPORT_PROVIDER_ID}
  `);
  await db.run(sql`
    UPDATE llm_account_leases
    SET status = 'invalidated', released_at = ${now}, updated_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${ANTIGRAVITY_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${ANTIGRAVITY_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${ANTIGRAVITY_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${ANTIGRAVITY_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
};

export const disconnectCloudCodeAccountTransports = async (input: {
  ownerUserId: string;
}): Promise<void> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return;
  const now = new Date();
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET
      status = 'disconnected',
      token_secret = NULL,
      token_expires_at = NULL,
      disconnected_at = ${now},
      last_error = NULL,
      updated_at = ${now}
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CLOUD_CODE_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CLOUD_CODE_TRANSPORT_PROVIDER_ID}
  `);
  await db.run(sql`
    UPDATE llm_account_leases
    SET status = 'invalidated', released_at = ${now}, updated_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CLOUD_CODE_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CLOUD_CODE_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CLOUD_CODE_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CLOUD_CODE_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
};

const supportsModel = (modelAllowlist: unknown, modelId: string): boolean => {
  if (!Array.isArray(modelAllowlist) || modelAllowlist.length === 0) return true;
  return modelAllowlist.some((entry) => typeof entry === 'string' && entry === modelId);
};

const isLeasedAccountUsable = (row: LeaseSelectionRow, modelId: string, now: Date): boolean => {
  if (row.account_status !== 'active') return false;
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > now.getTime()) return false;
  return supportsModel(row.model_allowlist, modelId);
};

const refreshCodexTokenIfNeeded = async (input: {
  accountId: string;
  externalAccountId: string | null;
  token: CodexTokenSecretPayload;
}): Promise<CodexTokenSecretPayload | null> => {
  if (!isTokenExpiring(input.token.expiresAt)) return input.token;
  if (!input.token.refreshToken) {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          token_secret = NULL,
          token_expires_at = NULL,
          last_error = 'Codex token expired and no refresh token is available.',
          updated_at = ${new Date()}
      WHERE id = ${input.accountId}
    `);
    return null;
  }

  const existing = codexRefreshes.get(input.accountId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const refreshed = await refreshCodexAccessToken({ refreshToken: input.token.refreshToken! });
      const next = buildTokenPayload({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? input.token.refreshToken,
        idToken: refreshed.idToken ?? input.token.idToken,
        expiresAt: refreshed.expiresAt ?? inferTokenExpiresAt(refreshed.accessToken, refreshed.idToken),
        source: 'codex-refresh',
      });
      const nextExternalAccountId =
        inferCodexAccountIdFromToken(next.accessToken, next.idToken) ?? input.externalAccountId;
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET token_secret = ${encryptSecret(JSON.stringify(next))},
            token_expires_at = ${next.expiresAt ? new Date(next.expiresAt) : null},
            external_account_id = COALESCE(${nextExternalAccountId}, external_account_id),
            status = 'active',
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return next;
    } catch (error) {
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET status = 'reauth_required',
            last_error = ${error instanceof Error ? error.message : 'Codex token refresh failed.'},
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return null;
    } finally {
      codexRefreshes.delete(input.accountId);
    }
  })();

  codexRefreshes.set(input.accountId, refreshPromise);
  return refreshPromise;
};

const refreshClaudeCodeTokenIfNeeded = async (input: {
  accountId: string;
  externalAccountId: string | null;
  token: ClaudeCodeTokenSecretPayload;
}): Promise<ClaudeCodeTokenSecretPayload | null> => {
  if (!isTokenExpiring(input.token.expiresAt)) return input.token;
  if (!input.token.refreshToken) {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          token_secret = NULL,
          token_expires_at = NULL,
          last_error = 'Claude Code token expired and no refresh token is available.',
          updated_at = ${new Date()}
      WHERE id = ${input.accountId}
    `);
    return null;
  }

  const existing = claudeCodeRefreshes.get(input.accountId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const refreshed = await refreshClaudeCodeAccessToken({
        refreshToken: input.token.refreshToken,
        clientId: input.token.clientId ?? undefined,
      });
      const next = buildClaudeCodeTokenPayload({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        source: 'claude-code-refresh',
        clientId: input.token.clientId,
        subscriptionType: input.token.subscriptionType,
        rateLimitTier: input.token.rateLimitTier,
        profile: input.token.profile,
      });
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET token_secret = ${encryptSecret(JSON.stringify(next))},
            token_expires_at = ${next.expiresAt ? new Date(next.expiresAt) : null},
            status = 'active',
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return next;
    } catch (error) {
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET status = 'reauth_required',
            last_error = ${error instanceof Error ? error.message : 'Claude Code token refresh failed.'},
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return null;
    } finally {
      claudeCodeRefreshes.delete(input.accountId);
    }
  })();

  claudeCodeRefreshes.set(input.accountId, refreshPromise);
  return refreshPromise;
};

export const refreshCloudCodeTokenIfNeeded = async (
  input: {
    accountId: string;
    externalAccountId: string | null;
    token: CloudCodeTokenSecretPayload;
  },
  fetchFn: typeof fetch = fetch,
): Promise<CloudCodeTokenSecretPayload | null> => {
  if (!isTokenExpiring(input.token.expiresAt)) return input.token;
  const refreshToken = input.token.refreshToken;
  if (!refreshToken) {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          token_secret = NULL,
          token_expires_at = NULL,
          last_error = 'Cloud Code token expired and no refresh token is available.',
          updated_at = ${new Date()}
      WHERE id = ${input.accountId}
    `);
    return null;
  }

  // 1st level in-memory single-flight deduplication (same pod)
  const existing = cloudCodeRefreshes.get(input.accountId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      // P0-3 FIX: 2nd level DB-level optimistic check (multi-pod protection)
      const latestRows = (await db.all(sql`
        SELECT token_secret, token_expires_at, status
        FROM llm_provider_accounts
        WHERE id = ${input.accountId}
      `)) as Array<{ token_secret: string | null; token_expires_at: Date | string | null; status: string }>;
      const latestRow = latestRows[0];
      if (latestRow && latestRow.status === 'active' && latestRow.token_secret) {
        const freshToken = parseCloudCodeTokenSecret(latestRow.token_secret);
        if (freshToken && !isTokenExpiring(freshToken.expiresAt)) {
          return freshToken;
        }
      }

      // P0-1 FIX: Resolve client_id and client_secret without hardcoding mocks
      const clientId = input.token.clientId ?? normalizeOptionalText(process.env.CLOUD_CODE_CLIENT_ID);
      const clientSecret = input.token.clientSecret ?? normalizeOptionalText(process.env.CLOUD_CODE_CLIENT_SECRET);
      if (!clientId || !clientSecret) {
        throw new Error('Cloud Code client credentials (clientId/clientSecret) are missing for token refresh.');
      }

      const response = await fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Cloud Code token refresh failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      const accessToken = normalizeOptionalText(payload.access_token);
      if (!accessToken) throw new Error('Cloud Code token refresh returned no access token');

      const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const next = buildCloudCodeTokenPayload({
        accessToken,
        refreshToken: payload.refresh_token ?? input.token.refreshToken,
        expiresAt,
        source: 'cloud-code-refresh',
        cloudaicompanionProject: input.token.cloudaicompanionProject,
        clientId,
        clientSecret,
        authClientConfigVersion: input.token.authClientConfigVersion,
        profile: input.token.profile,
      });

      await db.run(sql`
        UPDATE llm_provider_accounts
        SET token_secret = ${encryptSecret(JSON.stringify(next))},
            token_expires_at = ${next.expiresAt ? new Date(next.expiresAt) : null},
            status = 'active',
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return next;
    } catch (error) {
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET status = 'reauth_required',
            last_error = ${error instanceof Error ? error.message : 'Cloud Code token refresh failed.'},
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return null;
    } finally {
      cloudCodeRefreshes.delete(input.accountId);
    }
  })();

  cloudCodeRefreshes.set(input.accountId, refreshPromise);
  return refreshPromise;
};

const refreshAntigravityTokenIfNeeded = async (input: {
  accountId: string;
  externalAccountId: string | null;
  token: AntigravityTokenSecretPayload;
}): Promise<AntigravityTokenSecretPayload | null> => {
  if (!isTokenExpiring(input.token.expiresAt)) return input.token;
  if (!input.token.refreshToken) {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          token_secret = NULL,
          token_expires_at = NULL,
          last_error = 'Antigravity token expired and no refresh token is available.',
          updated_at = ${new Date()}
      WHERE id = ${input.accountId}
    `);
    return null;
  }

  const existing = antigravityRefreshes.get(input.accountId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const refreshed = await refreshAntigravityAccessToken({
        refreshToken: input.token.refreshToken!,
      });
      const next = buildAntigravityTokenPayload({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? input.token.refreshToken,
        expiresAt: refreshed.expiresAt,
        source: 'antigravity-refresh',
        project: input.token.project,
        tier: input.token.tier,
        profile: input.token.profile,
      });
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET token_secret = ${encryptSecret(JSON.stringify(next))},
            token_expires_at = ${next.expiresAt ? new Date(next.expiresAt) : null},
            status = 'active',
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return next;
    } catch (error) {
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET status = 'reauth_required',
            last_error = ${error instanceof Error ? error.message : 'Antigravity token refresh failed.'},
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return null;
    } finally {
      antigravityRefreshes.delete(input.accountId);
    }
  })();

  antigravityRefreshes.set(input.accountId, refreshPromise);
  return refreshPromise;
};

type ParsedAccountTransportToken = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
};

const acquireDbAccountTransport = async <TToken extends ParsedAccountTransportToken>(input: {
  userId: string;
  workspaceId?: string | null;
  modelId?: string | null;
  affinityKey?: string | null;
  requestId?: string | null;
  targetProviderId: string;
  transportProviderId: string;
  defaultModelId: string;
  stableSessionPrefix: string;
  parseTokenSecret(value: string | null | undefined): TToken | null;
  refreshTokenIfNeeded(input: {
    accountId: string;
    externalAccountId: string | null;
    token: TToken;
  }): Promise<TToken | null>;
  invalidTokenMessage: string;
  reauthMessage: string;
}): Promise<LlmAccountTransportAcquisition | null> => {
  const userId = normalizeOptionalText(input.userId);
  if (!userId) return null;

  const workspaceId = normalizeOptionalText(input.workspaceId);
  const modelId = normalizeOptionalText(input.modelId) ?? input.defaultModelId;
  const affinityKey = normalizeOptionalText(input.affinityKey) ?? `user:${userId}`;
  const requestId = normalizeOptionalText(input.requestId) ?? createId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
  const client = await pool.connect();

  let acquired: AcquisitionRow | null = null;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE llm_account_reservations
       SET status = 'expired'
       WHERE status = 'active' AND expires_at <= $1`,
      [now],
    );
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      [
        workspaceId ?? '',
        userId,
        affinityKey,
        input.targetProviderId,
        input.transportProviderId,
        modelId,
      ].join('\u001f'),
    ]);

    const leaseResult = await client.query<LeaseSelectionRow>(
      `SELECT
         l.id as lease_id,
         l.stable_session_id,
         a.id as account_id,
         a.external_account_id,
         a.account_label,
         a.token_secret,
         a.token_expires_at,
         a.model_allowlist,
         a.metadata,
         a.status as account_status,
         a.cooldown_until
       FROM llm_account_leases l
       JOIN llm_provider_accounts a ON a.id = l.account_id
       WHERE l.status = 'active'
         AND coalesce(l.workspace_id, '') = coalesce($1::text, '')
         AND coalesce(l.user_id, '') = coalesce($2::text, '')
         AND l.affinity_key = $3
         AND l.target_provider_id = $4
         AND l.transport_provider_id = $5
         AND l.model_id = $6
       FOR UPDATE OF l, a`,
      [workspaceId, userId, affinityKey, input.targetProviderId, input.transportProviderId, modelId],
    );
    const leased = leaseResult.rows[0];
    if (leased) {
      if (!isLeasedAccountUsable(leased, modelId, now)) {
        await client.query('COMMIT');
        return null;
      }
      const reservationId = createId();
      await client.query(
        `INSERT INTO llm_account_reservations (
           id, account_id, lease_id, request_id, status, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [reservationId, leased.account_id, leased.lease_id, requestId, expiresAt, now],
      );
      acquired = {
        ...leased,
        reservation_id: reservationId,
      };
      await client.query('COMMIT');
    } else {
      const accountResult = await client.query<AccountSelectionRow>(
        `SELECT
           a.id as account_id,
           a.external_account_id,
           a.account_label,
           a.token_secret,
           a.token_expires_at,
           a.model_allowlist,
           a.metadata
         FROM llm_provider_accounts a
         LEFT JOIN (
           SELECT account_id, count(*)::integer as active_reservations
           FROM llm_account_reservations
           WHERE status = 'active' AND expires_at > $1
           GROUP BY account_id
         ) r ON r.account_id = a.id
         LEFT JOIN (
           SELECT account_id, count(*)::integer as active_leases
           FROM llm_account_leases
           WHERE status = 'active'
           GROUP BY account_id
         ) l ON l.account_id = a.id
         WHERE a.owner_user_id = $2
           AND a.scope = 'user'
           AND a.target_provider_id = $3
           AND a.transport_provider_id = $4
           AND a.status = 'active'
           AND (a.cooldown_until IS NULL OR a.cooldown_until <= $1)
           AND (jsonb_array_length(a.model_allowlist) = 0 OR a.model_allowlist ? $5)
         ORDER BY
           a.priority DESC,
           ((coalesce(r.active_reservations, 0) + coalesce(l.active_leases, 0))::float / greatest(a.weight, 1)) ASC,
           a.connected_at ASC NULLS LAST,
           a.created_at ASC
         LIMIT 1
         FOR UPDATE OF a SKIP LOCKED`,
        [now, userId, input.targetProviderId, input.transportProviderId, modelId],
      );
      const account = accountResult.rows[0];
      if (!account) {
        await client.query('COMMIT');
        return null;
      }

      const leaseId = createId();
      const stableSessionId = computeStableSessionId({
        workspaceId,
        userId,
        affinityKey,
        targetProviderId: input.targetProviderId,
        transportProviderId: input.transportProviderId,
        modelId,
        leaseId,
        prefix: input.stableSessionPrefix,
      });
      const reservationId = createId();
      await client.query(
        `INSERT INTO llm_account_leases (
           id,
           workspace_id,
           user_id,
           affinity_key,
           target_provider_id,
           transport_provider_id,
           model_id,
           account_id,
           stable_session_id,
           status,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $10)`,
        [
          leaseId,
          workspaceId,
          userId,
          affinityKey,
          input.targetProviderId,
          input.transportProviderId,
          modelId,
          account.account_id,
          stableSessionId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO llm_account_reservations (
           id, account_id, lease_id, request_id, status, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [reservationId, account.account_id, leaseId, requestId, expiresAt, now],
      );
      acquired = {
        ...account,
        lease_id: leaseId,
        stable_session_id: stableSessionId,
        reservation_id: reservationId,
      };
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!acquired) return null;
  const token = input.parseTokenSecret(acquired.token_secret);
  if (!token) {
    await recordLlmAccountTransportOutcome({
      accountId: acquired.account_id,
      reservationId: acquired.reservation_id,
      status: 'auth_failed',
      errorMessage: input.invalidTokenMessage,
    });
    return null;
  }

  const freshToken = await input.refreshTokenIfNeeded({
    accountId: acquired.account_id,
    externalAccountId: acquired.external_account_id,
    token,
  });
  if (!freshToken) {
    await recordLlmAccountTransportOutcome({
      accountId: acquired.account_id,
      reservationId: acquired.reservation_id,
      status: 'auth_failed',
      errorMessage: input.reauthMessage,
    });
    return null;
  }

  const metadata =
    acquired.metadata && typeof acquired.metadata === 'object' && !Array.isArray(acquired.metadata)
      ? acquired.metadata as Record<string, unknown>
      : null;

  return {
    accessToken: freshToken.accessToken,
    refreshToken: freshToken.refreshToken ?? null,
    expiresAt: freshToken.expiresAt ?? null,
    accountId: acquired.external_account_id,
    accountLabel: acquired.account_label,
    stableSessionId: acquired.stable_session_id,
    accountTransportAccountId: acquired.account_id,
    leaseId: acquired.lease_id,
    reservationId: acquired.reservation_id,
    transportProviderId: input.transportProviderId,
    metadata,
    recordOutcome: (outcome) =>
      recordLlmAccountTransportOutcome({
        ...outcome,
        accountId: acquired!.account_id,
        reservationId: acquired!.reservation_id,
      }),
  };
};

export const acquireOpenAICodexAccountTransport = async (input: {
  userId: string;
  workspaceId?: string | null;
  modelId: string;
  affinityKey?: string | null;
  requestId?: string | null;
}): Promise<CodexAccountTransportAcquisition | null> =>
  acquireDbAccountTransport({
    ...input,
    targetProviderId: CODEX_TARGET_PROVIDER_ID,
    transportProviderId: CODEX_TRANSPORT_PROVIDER_ID,
    defaultModelId: 'gpt-5.5',
    stableSessionPrefix: 'codex',
    parseTokenSecret: parseCodexTokenSecret,
    refreshTokenIfNeeded: refreshCodexTokenIfNeeded,
    invalidTokenMessage: 'Codex account token secret is missing or invalid.',
    reauthMessage: 'Codex account requires reauthentication.',
  });

export const acquireClaudeCodeAccountTransport = async (input: {
  userId: string;
  workspaceId?: string | null;
  modelId: string;
  affinityKey?: string | null;
  requestId?: string | null;
}): Promise<ClaudeCodeAccountTransportAcquisition | null> =>
  acquireDbAccountTransport({
    ...input,
    targetProviderId: CLAUDE_CODE_TARGET_PROVIDER_ID,
    transportProviderId: CLAUDE_CODE_TRANSPORT_PROVIDER_ID,
    defaultModelId: 'claude-sonnet-5',
    stableSessionPrefix: 'claude_code',
    parseTokenSecret: parseClaudeCodeTokenSecret,
    refreshTokenIfNeeded: refreshClaudeCodeTokenIfNeeded,
    invalidTokenMessage: 'Claude Code account token secret is missing or invalid.',
    reauthMessage: 'Claude Code account requires reauthentication.',
  });

export const acquireCloudCodeAccountTransport = async (input: {
  userId: string;
  workspaceId?: string | null;
  modelId: string;
  affinityKey?: string | null;
  requestId?: string | null;
}): Promise<CloudCodeAccountTransportAcquisition | null> => {
  const result = await acquireDbAccountTransport({
    ...input,
    targetProviderId: CLOUD_CODE_TARGET_PROVIDER_ID,
    transportProviderId: CLOUD_CODE_TRANSPORT_PROVIDER_ID,
    defaultModelId: 'gemini-2.5-flash',
    stableSessionPrefix: 'cloud_code',
    parseTokenSecret: parseCloudCodeTokenSecret,
    refreshTokenIfNeeded: refreshCloudCodeTokenIfNeeded,
    invalidTokenMessage: 'Cloud Code account token secret is missing or invalid.',
    reauthMessage: 'Cloud Code account requires reauthentication.',
  });

  if (!result) return null;

  const decryptedRows = (await db.all(sql`
    SELECT token_secret FROM llm_provider_accounts WHERE id = ${result.accountTransportAccountId}
  `)) as Array<{ token_secret: string | null }>;
  const decryptedToken = parseCloudCodeTokenSecret(decryptedRows[0]?.token_secret);

  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      cloudaicompanionProject: decryptedToken?.cloudaicompanionProject ?? null,
    },
  };
};

/** @deprecated Replaced by acquireCloudCodeAccountTransport */
export const acquireGeminiCodeAssistAccountTransport = acquireCloudCodeAccountTransport;

export const acquireAntigravityAccountTransport = async (input: {
  userId: string;
  workspaceId?: string | null;
  modelId: string;
  affinityKey?: string | null;
  requestId?: string | null;
}): Promise<AntigravityAccountTransportAcquisition | null> =>
  acquireDbAccountTransport({
    ...input,
    targetProviderId: ANTIGRAVITY_TARGET_PROVIDER_ID,
    transportProviderId: ANTIGRAVITY_TRANSPORT_PROVIDER_ID,
    defaultModelId: 'gemini-3-pro-high',
    stableSessionPrefix: 'antigravity',
    parseTokenSecret: parseAntigravityTokenSecret,
    refreshTokenIfNeeded: refreshAntigravityTokenIfNeeded,
    invalidTokenMessage: 'Antigravity account token secret is missing or invalid.',
    reauthMessage: 'Antigravity account requires reauthentication.',
  });

export const recordLlmAccountTransportOutcome = async (
  input: LlmAccountTransportOutcomeInput & {
    accountId: string;
    reservationId: string;
  },
): Promise<void> => {
  const now = new Date();
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE id = ${input.reservationId} AND status = 'active'
  `);

  if (input.status === 'success') return;

  if (input.status === 'auth_failed') {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          last_error = ${input.errorMessage ?? 'Account transport authorization failed.'},
          updated_at = ${now}
      WHERE id = ${input.accountId}
    `);
    return;
  }

  if (input.status === 'rate_limited') {
    const retryAfterMs =
      typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs)
        ? Math.max(0, input.retryAfterMs)
        : 60_000;
    const cooldownUntil = new Date(now.getTime() + retryAfterMs);
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'cooldown',
          cooldown_until = ${cooldownUntil},
          last_error = ${input.errorMessage ?? 'Account transport rate limited.'},
          updated_at = ${now}
      WHERE id = ${input.accountId}
    `);
  }
};
