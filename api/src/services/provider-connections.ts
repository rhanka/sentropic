import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  resolveProviderCredential,
  type ProviderCredentialSource,
} from './provider-credentials';
import {
  completeCodexDeviceEnrollment,
  startCodexDeviceEnrollment,
  type CodexDeviceEnrollmentResult,
} from './codex-provider-auth';
import {
  acquireAntigravityAccountTransport,
  acquireClaudeCodeAccountTransport,
  acquireOpenAICodexAccountTransport,
  disconnectAntigravityAccountTransports,
  disconnectClaudeCodeAccountTransports,
  disconnectCodexAccountTransports,
  getPrimaryAntigravityAccountTransport,
  getPrimaryClaudeCodeAccountTransport,
  getPrimaryCodexAccountTransport,
  storeAntigravityAccountTransport,
  storeClaudeCodeAccountTransport,
  storeCodexAccountTransport,
  type AntigravityAccountTransportAcquisition,
  type ClaudeCodeAccountTransportAcquisition,
  type CodexAccountTransportAcquisition,
  type LlmAccountTransportPublic,
} from './llm-account-transports';
import {
  exchangeClaudeCodeAuthorizationCode,
  fetchClaudeCodeProfile,
  parseClaudeCodeAuthorizationInput,
  startClaudeCodeAuthorization,
} from './claude-code-provider-auth';
import {
  exchangeAntigravityAuthorizationCode,
  fetchAntigravityUserInfo,
  loadCodeAssist,
  onboardAntigravityUser,
  refreshAntigravityAccessToken,
  startAntigravityAuthorization,
} from './antigravity-provider-auth';
import { env } from '../config/env';
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { settingsService } from './settings';

export type ProviderConnectionId = 'codex' | 'openai' | 'gemini' | 'anthropic' | 'mistral' | 'cohere' | 'antigravity';

export type ProviderConnectionState = {
  providerId: ProviderConnectionId;
  label: string;
  ready: boolean;
  connectionStatus: 'connected' | 'pending' | 'disconnected';
  enrollmentId: string | null;
  enrollmentUrl: string | null;
  enrollmentCode: string | null;
  enrollmentExpiresAt: string | null;
  managedBy: 'admin_settings' | 'environment' | 'none';
  accountLabel: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  canConfigure: boolean;
};

type CodexConnectionPayload = {
  status: 'connected' | 'pending' | 'disconnected';
  enrollmentId: string | null;
  enrollmentUrl: string | null;
  enrollmentCode: string | null;
  enrollmentExpiresAt: string | null;
  accountLabel: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

type CodexPendingEnrollmentPayload = {
  enrollmentId: string;
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  expectedAccountLabel: string | null;
};

type CodexConnectedSecret = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountLabel: string | null;
  connectedAt: string;
  expiresAt?: string | null;
};

type ClaudeCodePendingEnrollmentPayload = {
  enrollmentId: string;
  codeVerifier: string;
  state: string | null;
  redirectUri: string;
  expectedAccountLabel: string | null;
};

type AntigravityPendingEnrollmentPayload = {
  enrollmentId: string;
  codeVerifier: string;
  state: string | null;
  redirectUri: string;
  redirectPort: number;
  expectedAccountLabel: string | null;
};

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';
const CODEX_CONNECTION_PENDING_SECRET_KEY = 'provider_connection_secret:codex_pending';
const CODEX_CONNECTION_SECRET_KEY = 'provider_connection_secret:codex';
const OPENAI_TRANSPORT_MODE_SETTING_KEY = 'provider_connection_mode:openai';
const ANTHROPIC_TRANSPORT_MODE_SETTING_KEY = 'provider_connection_mode:anthropic';
const CLAUDE_CODE_CONNECTION_SETTINGS_KEY = 'provider_connection:claude_code';
const CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY =
  'provider_connection_secret:claude_code_pending';
const ANTIGRAVITY_CONNECTION_SETTINGS_KEY = 'provider_connection:antigravity';
const ANTIGRAVITY_CONNECTION_PENDING_SECRET_KEY =
  'provider_connection_secret:antigravity_pending';

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const parseCodexConnectionPayload = (
  raw: string | null,
): CodexConnectionPayload | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CodexConnectionPayload> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const legacyConnected = (parsed as { connected?: unknown }).connected === true;
    const statusRaw = normalizeText(parsed.status).toLowerCase();
    const status: CodexConnectionPayload['status'] =
      statusRaw === 'connected' || statusRaw === 'pending' || statusRaw === 'disconnected'
        ? (statusRaw as CodexConnectionPayload['status'])
        : legacyConnected
          ? 'connected'
          : 'disconnected';
    return {
      status,
      enrollmentId: normalizeOptionalText(parsed.enrollmentId),
      enrollmentUrl: normalizeOptionalText(parsed.enrollmentUrl),
      enrollmentCode: normalizeOptionalText(parsed.enrollmentCode),
      enrollmentExpiresAt: normalizeOptionalText(parsed.enrollmentExpiresAt),
      accountLabel: normalizeOptionalText(parsed.accountLabel),
      updatedAt: normalizeOptionalText(parsed.updatedAt),
      updatedByUserId: normalizeOptionalText(parsed.updatedByUserId),
    };
  } catch {
    return null;
  }
};

const parseSecretPayload = <T extends object>(raw: string | null): T | null => {
  const decrypted = decryptSecretOrNull(raw);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as T | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const toManagedBy = (
  source: ProviderCredentialSource,
): ProviderConnectionState['managedBy'] => {
  if (source === 'environment') return 'environment';
  if (source === 'user_byok' || source === 'workspace_key') return 'admin_settings';
  return 'none';
};

const readCodexConnection = async (userId: string): Promise<CodexConnectionPayload | null> => {
  const raw = await settingsService.get(CODEX_CONNECTION_SETTINGS_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseCodexConnectionPayload(raw);
};

const readPendingEnrollment = async (
  userId: string,
): Promise<CodexPendingEnrollmentPayload | null> => {
  const raw = await settingsService.get(CODEX_CONNECTION_PENDING_SECRET_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseSecretPayload<CodexPendingEnrollmentPayload>(raw);
};

const writeCodexConnection = async (
  userId: string,
  payload: CodexConnectionPayload,
): Promise<void> => {
  await settingsService.set(
    CODEX_CONNECTION_SETTINGS_KEY,
    JSON.stringify(payload),
    'Codex provider connection state for the current admin user.',
    { userId },
  );
};

const writeEncryptedSetting = async (
  userId: string,
  key: string,
  payload: object | string,
  description: string,
): Promise<void> => {
  const value =
    typeof payload === 'string' ? encryptSecret(payload) : encryptSecret(JSON.stringify(payload));
  await settingsService.set(key, value, description, { userId });
};

const deleteUserScopedSetting = async (userId: string, key: string): Promise<void> => {
  await db.run(sql`DELETE FROM settings WHERE key = ${key} AND user_id = ${userId}`);
};

const deleteCodexSecrets = async (userId: string): Promise<void> => {
  await Promise.all([
    deleteUserScopedSetting(userId, CODEX_CONNECTION_PENDING_SECRET_KEY),
    deleteUserScopedSetting(userId, CODEX_CONNECTION_SECRET_KEY),
  ]);
};

const readClaudeCodeConnection = async (
  userId: string,
): Promise<CodexConnectionPayload | null> => {
  const raw = await settingsService.get(CLAUDE_CODE_CONNECTION_SETTINGS_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseCodexConnectionPayload(raw);
};

const readPendingClaudeCodeEnrollment = async (
  userId: string,
): Promise<ClaudeCodePendingEnrollmentPayload | null> => {
  const raw = await settingsService.get(CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseSecretPayload<ClaudeCodePendingEnrollmentPayload>(raw);
};

const writeClaudeCodeConnection = async (
  userId: string,
  payload: CodexConnectionPayload,
): Promise<void> => {
  await settingsService.set(
    CLAUDE_CODE_CONNECTION_SETTINGS_KEY,
    JSON.stringify(payload),
    'Claude Code provider connection state for the current admin user.',
    { userId },
  );
};

const deleteClaudeCodeSecrets = async (userId: string): Promise<void> => {
  await deleteUserScopedSetting(userId, CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY);
};

const readAntigravityConnection = async (
  userId: string,
): Promise<CodexConnectionPayload | null> => {
  const raw = await settingsService.get(ANTIGRAVITY_CONNECTION_SETTINGS_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseCodexConnectionPayload(raw);
};

const readPendingAntigravityEnrollment = async (
  userId: string,
): Promise<AntigravityPendingEnrollmentPayload | null> => {
  const raw = await settingsService.get(ANTIGRAVITY_CONNECTION_PENDING_SECRET_KEY, {
    userId,
    fallbackToGlobal: false,
  });
  return parseSecretPayload<AntigravityPendingEnrollmentPayload>(raw);
};

const writeAntigravityConnection = async (
  userId: string,
  payload: CodexConnectionPayload,
): Promise<void> => {
  await settingsService.set(
    ANTIGRAVITY_CONNECTION_SETTINGS_KEY,
    JSON.stringify(payload),
    'Antigravity provider connection state for the current admin user.',
    { userId },
  );
};

const deleteAntigravitySecrets = async (userId: string): Promise<void> => {
  await deleteUserScopedSetting(userId, ANTIGRAVITY_CONNECTION_PENDING_SECRET_KEY);
};

const toAntigravityProviderState = (
  antigravityConnection: CodexConnectionPayload | null,
  antigravityAccount: LlmAccountTransportPublic | null,
): ProviderConnectionState => {
  const accountConnected =
    !!antigravityAccount &&
    (antigravityAccount.status === 'active' || antigravityAccount.status === 'cooldown');
  const visibleStatus: ProviderConnectionState['connectionStatus'] = accountConnected
    ? 'connected'
    : antigravityConnection?.status === 'pending'
      ? 'pending'
      : 'disconnected';
  const ready = accountConnected && antigravityAccount?.status !== 'cooldown';
  return {
    providerId: 'antigravity',
    label: 'Antigravity',
    ready,
    connectionStatus: visibleStatus,
    enrollmentId: antigravityConnection?.enrollmentId ?? null,
    enrollmentUrl: antigravityConnection?.enrollmentUrl ?? null,
    enrollmentCode: antigravityConnection?.enrollmentCode ?? null,
    enrollmentExpiresAt: antigravityConnection?.enrollmentExpiresAt ?? null,
    managedBy: visibleStatus === 'disconnected' ? 'none' : 'admin_settings',
    accountLabel: antigravityAccount?.accountLabel ?? antigravityConnection?.accountLabel ?? null,
    updatedAt: antigravityAccount?.updatedAt ?? antigravityConnection?.updatedAt ?? null,
    updatedByUserId: antigravityConnection?.updatedByUserId ?? null,
    canConfigure: true,
  };
};

export const resolveConnectedCodexTransport = async (
  userId: string,
  options: {
    workspaceId?: string | null;
    modelId?: string | null;
    affinityKey?: string | null;
    requestId?: string | null;
  } = {},
): Promise<CodexAccountTransportAcquisition | null> => {
  await migrateLegacyCodexConnectionIfNeeded(userId);
  return acquireOpenAICodexAccountTransport({
    userId,
    workspaceId: options.workspaceId,
    modelId: normalizeOptionalText(options.modelId) ?? 'gpt-5.5',
    affinityKey: options.affinityKey,
    requestId: options.requestId,
  });
};

export const resolveConnectedClaudeCodeTransport = async (
  userId: string,
  options: {
    workspaceId?: string | null;
    modelId?: string | null;
    affinityKey?: string | null;
    requestId?: string | null;
  } = {},
): Promise<ClaudeCodeAccountTransportAcquisition | null> => {
  return acquireClaudeCodeAccountTransport({
    userId,
    workspaceId: options.workspaceId,
    modelId: normalizeOptionalText(options.modelId) ?? 'claude-sonnet-5',
    affinityKey: options.affinityKey,
    requestId: options.requestId,
  });
};

export const resolveConnectedAntigravityTransport = async (
  userId: string,
  options: {
    workspaceId?: string | null;
    modelId: string;
    affinityKey?: string | null;
    requestId?: string | null;
  },
): Promise<AntigravityAccountTransportAcquisition | null> => {
  return acquireAntigravityAccountTransport({
    userId,
    workspaceId: options.workspaceId,
    modelId: options.modelId,
    affinityKey: options.affinityKey,
    requestId: options.requestId,
  });
};

// D3 routing families. Antigravity is a multi-family FALLBACK; the requested
// catalog model maps to an Antigravity FLEET wire id per family.
export type ProviderFamily = 'claude' | 'gpt' | 'gemini';

export const deriveProviderFamily = (
  providerId: string,
  modelId: string,
): ProviderFamily => {
  if (providerId === 'anthropic' || modelId.includes('claude')) return 'claude';
  if (providerId === 'openai' || modelId.startsWith('gpt')) return 'gpt';
  return 'gemini';
};

// Antigravity serves ONLY the claude / gpt / gemini families (its fleet). A
// request for mistral/cohere/local must never be routed to Antigravity, even
// when an Antigravity account is enrolled.
export const isAntigravityServableFamily = (
  providerId: string,
  modelId: string,
): boolean => {
  return (
    providerId === 'anthropic' ||
    providerId === 'openai' ||
    providerId === 'gemini' ||
    providerId === 'gcp' ||
    modelId.includes('claude') ||
    modelId.startsWith('gpt') ||
    modelId.includes('gemini')
  );
};

export const mapModelToAntigravityFleet = (
  providerId: string,
  modelId: string,
): string => {
  const family = deriveProviderFamily(providerId, modelId);
  if (family === 'claude') {
    return modelId.includes('opus') ? 'claude-opus-4-6-thinking' : 'claude-sonnet-4-6';
  }
  if (family === 'gpt') {
    return 'gpt-oss-120b-medium';
  }
  return modelId.includes('lite') || modelId.includes('low')
    ? 'gemini-3-pro-low'
    : 'gemini-3-pro-high';
};

// D3 explicit-grant SEAM (highest precedence). A grant pins a (userId
// [,workspaceId][,agentId]) + family to a specific account/transport. No grant
// store exists yet (see BRAG-Q2) → this returns null, so routing is pure
// native-first with Antigravity as fallback. Wiring the resolver here keeps the
// precedence ordering explicit and ready for a persisted grant table.
export type AccountGrantBinding = {
  transport: 'native' | 'antigravity';
};

export const resolveExplicitAccountGrant = async (_input: {
  userId: string;
  workspaceId?: string | null;
  family: ProviderFamily;
}): Promise<AccountGrantBinding | null> => {
  return null;
};

const isNativeCredentialAvailable = (
  family: ProviderFamily,
  credentialSource: ProviderCredentialSource,
): boolean => {
  if (credentialSource !== 'none') return true;
  // gemini native beyond an API key = GCP ADC (project+location configured).
  if (family === 'gemini') {
    return Boolean(
      normalizeOptionalText(env.GOOGLE_CLOUD_PROJECT) &&
        normalizeOptionalText(env.GOOGLE_CLOUD_LOCATION),
    );
  }
  return false;
};

const isActiveAccount = (account: LlmAccountTransportPublic | null): boolean =>
  !!account && (account.status === 'active' || account.status === 'cooldown');

export type AntigravityFallbackRoute = {
  acquisition: AntigravityAccountTransportAcquisition;
  fleetModel: string;
  project: string | null;
};

// D3 precedence resolver for the Antigravity multi-family FALLBACK:
//   (1) explicit grant to native  → null (use native);
//   (2) native transport/credential enrolled for the family → null;
//   (3) explicit grant to antigravity OR no native → acquire Antigravity.
// The enrolled Antigravity account EXECUTES the request (personal-passthrough);
// the token is never relayed as a generic bearer.
export const resolveAntigravityFallbackTransport = async (
  userId: string,
  options: {
    providerId: string;
    modelId: string;
    credentialSource: ProviderCredentialSource;
    workspaceId?: string | null;
    affinityKey?: string | null;
    requestId?: string | null;
  },
): Promise<AntigravityFallbackRoute | null> => {
  const ownerUserId = normalizeOptionalText(userId);
  if (!ownerUserId) return null;
  if (!isAntigravityServableFamily(options.providerId, options.modelId)) return null;

  const family = deriveProviderFamily(options.providerId, options.modelId);
  const grant = await resolveExplicitAccountGrant({
    userId: ownerUserId,
    workspaceId: options.workspaceId,
    family,
  });
  if (grant?.transport === 'native') return null;

  if (grant?.transport !== 'antigravity') {
    // (2) native preferred: a native credential/transport for the family wins.
    if (isNativeCredentialAvailable(family, options.credentialSource)) return null;
    if (family === 'claude' && isActiveAccount(await getPrimaryClaudeCodeAccountTransport({ ownerUserId }))) {
      return null;
    }
    if (family === 'gpt' && isActiveAccount(await getPrimaryCodexAccountTransport({ ownerUserId }))) {
      return null;
    }
  }

  // (3) Antigravity fallback — only when an Antigravity account is enrolled.
  if (!isActiveAccount(await getPrimaryAntigravityAccountTransport({ ownerUserId }))) {
    return null;
  }

  const fleetModel = mapModelToAntigravityFleet(options.providerId, options.modelId);
  const acquisition = await acquireAntigravityAccountTransport({
    userId: ownerUserId,
    workspaceId: options.workspaceId,
    modelId: fleetModel,
    affinityKey: options.affinityKey,
    requestId: options.requestId,
  });
  if (!acquisition) return null;

  const project = normalizeOptionalText(
    (acquisition.metadata as Record<string, unknown> | null)?.project,
  );
  return { acquisition, fleetModel, project };
};

export const getOpenAITransportMode = async (): Promise<'codex' | 'token'> =>
  normalizeText(
    await settingsService.get(OPENAI_TRANSPORT_MODE_SETTING_KEY, { fallbackToGlobal: true }),
  ).toLowerCase() === 'codex'
    ? 'codex'
    : 'token';

export const setOpenAITransportMode = async (
  mode: 'codex' | 'token',
): Promise<'codex' | 'token'> => {
  const normalized = mode === 'codex' ? 'codex' : 'token';
  await settingsService.set(
    OPENAI_TRANSPORT_MODE_SETTING_KEY,
    normalized,
    'OpenAI runtime source mode (`token` or `codex`).',
  );
  return normalized;
};

export const getAnthropicTransportMode = async (): Promise<'claude-code' | 'token'> => {
  const raw = normalizeText(
    await settingsService.get(ANTHROPIC_TRANSPORT_MODE_SETTING_KEY, { fallbackToGlobal: true }),
  ).toLowerCase();
  if (raw === 'claude-code') return 'claude-code';
  return 'token';
};

export const setAnthropicTransportMode = async (
  mode: 'claude-code' | 'token',
): Promise<'claude-code' | 'token'> => {
  const normalized = mode === 'claude-code' ? 'claude-code' : 'token';
  await settingsService.set(
    ANTHROPIC_TRANSPORT_MODE_SETTING_KEY,
    normalized,
    'Anthropic runtime source mode (`token` or `claude-code`).',
  );
  return normalized;
};

const toCodexProviderState = (
  codexConnection: CodexConnectionPayload | null,
  codexAccount?: LlmAccountTransportPublic | null,
): ProviderConnectionState => {
  const visibleStatus =
    codexConnection?.status === 'pending'
      ? 'pending'
      : codexAccount && (codexAccount.status === 'active' || codexAccount.status === 'cooldown')
        ? 'connected'
        : codexConnection?.status ?? 'disconnected';
  const ready = visibleStatus === 'connected' && codexAccount?.status !== 'cooldown';
  return {
    providerId: 'codex',
    label: 'Codex',
    ready,
    connectionStatus: visibleStatus,
    enrollmentId: codexConnection?.enrollmentId ?? null,
    enrollmentUrl: codexConnection?.enrollmentUrl ?? null,
    enrollmentCode: codexConnection?.enrollmentCode ?? null,
    enrollmentExpiresAt: codexConnection?.enrollmentExpiresAt ?? null,
    managedBy: visibleStatus === 'disconnected' ? 'none' : 'admin_settings',
    accountLabel: codexAccount?.accountLabel ?? codexConnection?.accountLabel ?? null,
    updatedAt: codexAccount?.updatedAt ?? codexConnection?.updatedAt ?? null,
    updatedByUserId: codexConnection?.updatedByUserId ?? null,
    canConfigure: true,
  };
};

const toAnthropicProviderState = (
  claudeConnection: CodexConnectionPayload | null,
  claudeAccount: LlmAccountTransportPublic | null,
  credential: { credential: string | null; source: ProviderCredentialSource },
): ProviderConnectionState => {
  const accountConnected =
    !!claudeAccount && (claudeAccount.status === 'active' || claudeAccount.status === 'cooldown');
  const visibleStatus: ProviderConnectionState['connectionStatus'] = accountConnected
    ? 'connected'
    : claudeConnection?.status === 'pending'
      ? 'pending'
      : credential.credential
        ? 'connected'
        : 'disconnected';
  const ready = accountConnected
    ? claudeAccount?.status !== 'cooldown'
    : Boolean(credential.credential);
  return {
    providerId: 'anthropic',
    label: 'Anthropic',
    ready,
    connectionStatus: visibleStatus,
    enrollmentId: claudeConnection?.enrollmentId ?? null,
    enrollmentUrl: claudeConnection?.enrollmentUrl ?? null,
    enrollmentCode: claudeConnection?.enrollmentCode ?? null,
    enrollmentExpiresAt: claudeConnection?.enrollmentExpiresAt ?? null,
    managedBy:
      accountConnected || claudeConnection?.status === 'pending'
        ? 'admin_settings'
        : toManagedBy(credential.source),
    accountLabel: claudeAccount?.accountLabel ?? claudeConnection?.accountLabel ?? null,
    updatedAt: claudeAccount?.updatedAt ?? claudeConnection?.updatedAt ?? null,
    updatedByUserId: claudeConnection?.updatedByUserId ?? null,
    canConfigure: true,
  };
};

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const [, payload] = jwt.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const inferCodexAccountLabel = (
  result: CodexDeviceEnrollmentResult,
  fallbackLabel: string | null,
): string | null => {
  const claims = decodeJwtPayload(result.idToken);
  const email =
    normalizeOptionalText(claims?.email) ||
    normalizeOptionalText(claims?.preferred_username) ||
    normalizeOptionalText(claims?.name);
  return email || fallbackLabel;
};

const assertExpectedAccountLabel = (
  expected: string | null,
  actual: string | null,
): void => {
  if (!expected || !actual) return;
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`Connected Codex account mismatch: expected ${expected}, got ${actual}.`);
  }
};

const migrateLegacyCodexConnectionIfNeeded = async (
  userId: string,
): Promise<LlmAccountTransportPublic | null> => {
  const existing = await getPrimaryCodexAccountTransport({ ownerUserId: userId });
  if (existing) return existing;

  const secret = parseSecretPayload<CodexConnectedSecret>(
    await settingsService.get(CODEX_CONNECTION_SECRET_KEY, { userId, fallbackToGlobal: false }),
  );
  const accessToken = normalizeOptionalText(secret?.accessToken);
  if (!accessToken) return null;

  return storeCodexAccountTransport({
    ownerUserId: userId,
    accountLabel: normalizeOptionalText(secret?.accountLabel),
    accessToken,
    refreshToken: normalizeOptionalText(secret?.refreshToken),
    idToken: normalizeOptionalText(secret?.idToken),
    source: 'legacy-codex-setting',
  });
};

export const listProviderConnections = async (input?: {
  userId?: string | null;
}): Promise<ProviderConnectionState[]> => {
  const userId = normalizeOptionalText(input?.userId);
  const codexAccount = userId ? await migrateLegacyCodexConnectionIfNeeded(userId) : null;
  const claudeAccount = userId
    ? await getPrimaryClaudeCodeAccountTransport({ ownerUserId: userId })
    : null;
  const antigravityAccount = userId
    ? await getPrimaryAntigravityAccountTransport({ ownerUserId: userId })
    : null;
  const [
    codexConnection,
    claudeConnection,
    antigravityConnection,
    openaiCredential,
    geminiCredential,
    anthropicCredential,
    mistralCredential,
    cohereCredential,
  ] = await Promise.all([
    userId ? readCodexConnection(userId) : Promise.resolve(null),
    userId ? readClaudeCodeConnection(userId) : Promise.resolve(null),
    userId ? readAntigravityConnection(userId) : Promise.resolve(null),
    resolveProviderCredential({
      providerId: 'openai',
      userId,
    }),
    resolveProviderCredential({
      providerId: 'gemini',
      userId,
    }),
    resolveProviderCredential({
      providerId: 'anthropic',
      userId,
    }),
    resolveProviderCredential({
      providerId: 'mistral',
      userId,
    }),
    resolveProviderCredential({
      providerId: 'cohere',
      userId,
    }),
  ]);

  const toSimpleProviderState = (
    providerId: ProviderConnectionId,
    label: string,
    credential: { credential: string | null; source: ProviderCredentialSource },
  ): ProviderConnectionState => ({
    providerId,
    label,
    ready: Boolean(credential.credential),
    connectionStatus: credential.credential ? 'connected' : 'disconnected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    managedBy: toManagedBy(credential.source),
    accountLabel: null,
    updatedAt: null,
    updatedByUserId: null,
    canConfigure: false,
  });

  return [
    toCodexProviderState(codexConnection, codexAccount),
    toSimpleProviderState('openai', 'OpenAI', openaiCredential),
    toSimpleProviderState('gemini', 'Gemini', geminiCredential),
    toAnthropicProviderState(claudeConnection, claudeAccount, anthropicCredential),
    toSimpleProviderState('mistral', 'Mistral', mistralCredential),
    toSimpleProviderState('cohere', 'Cohere', cohereCredential),
    toAntigravityProviderState(antigravityConnection, antigravityAccount),
  ];
};

export const startCodexEnrollment = async (input: {
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const enrollment = await startCodexDeviceEnrollment();
  const enrollmentId = createId();
  const accountLabel = normalizeOptionalText(input.accountLabel);
  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'pending',
    enrollmentId,
    enrollmentUrl: enrollment.verificationUrl,
    enrollmentCode: enrollment.userCode,
    enrollmentExpiresAt: null,
    accountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };
  const secret: CodexPendingEnrollmentPayload = {
    enrollmentId,
    deviceAuthId: enrollment.deviceAuthId,
    userCode: enrollment.userCode,
    intervalSeconds: enrollment.intervalSeconds,
    expectedAccountLabel: accountLabel,
  };

  await Promise.all([
    deleteCodexSecrets(input.updatedByUserId),
    writeCodexConnection(input.updatedByUserId, visible),
    writeEncryptedSetting(
      input.updatedByUserId,
      CODEX_CONNECTION_PENDING_SECRET_KEY,
      secret,
      'Pending Codex device enrollment secret for the current admin user.',
    ),
  ]);

  return toCodexProviderState(visible);
};

export const completeCodexEnrollment = async (input: {
  enrollmentId: string;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const [current, pending] = await Promise.all([
    readCodexConnection(input.updatedByUserId),
    readPendingEnrollment(input.updatedByUserId),
  ]);

  if (!current || current.status !== 'pending' || current.enrollmentId !== input.enrollmentId) {
    throw new Error('Invalid or expired Codex enrollment session.');
  }
  if (!pending || pending.enrollmentId !== input.enrollmentId) {
    throw new Error('Missing pending Codex device enrollment state.');
  }

  const result = await completeCodexDeviceEnrollment({
    deviceAuthId: pending.deviceAuthId,
    userCode: pending.userCode,
    intervalSeconds: pending.intervalSeconds,
  });

  if (result.status === 'pending') {
    const requestedAccountLabel =
      normalizeOptionalText(input.accountLabel) || pending.expectedAccountLabel;
    if (requestedAccountLabel && requestedAccountLabel !== pending.expectedAccountLabel) {
      const nextPending: CodexPendingEnrollmentPayload = {
        ...pending,
        expectedAccountLabel: requestedAccountLabel,
      };
      const nextVisible: CodexConnectionPayload = {
        ...current,
        accountLabel: requestedAccountLabel,
        updatedAt: new Date().toISOString(),
        updatedByUserId: normalizeOptionalText(input.updatedByUserId),
      };
      await Promise.all([
        writeCodexConnection(input.updatedByUserId, nextVisible),
        writeEncryptedSetting(
          input.updatedByUserId,
          CODEX_CONNECTION_PENDING_SECRET_KEY,
          nextPending,
          'Pending Codex device enrollment secret for the current admin user.',
        ),
      ]);
      return toCodexProviderState(nextVisible);
    }
    return toCodexProviderState(current);
  }

  const requestedAccountLabel =
    normalizeOptionalText(input.accountLabel) || pending.expectedAccountLabel;
  const connectedAccountLabel = inferCodexAccountLabel(result, requestedAccountLabel);
  assertExpectedAccountLabel(requestedAccountLabel, connectedAccountLabel);

  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: connectedAccountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };
  const secret: CodexConnectedSecret = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    idToken: result.idToken,
    accountLabel: connectedAccountLabel,
    connectedAt: now,
  };

  await Promise.all([
    deleteUserScopedSetting(input.updatedByUserId, CODEX_CONNECTION_PENDING_SECRET_KEY),
    deleteUserScopedSetting(input.updatedByUserId, CODEX_CONNECTION_SECRET_KEY),
    writeCodexConnection(input.updatedByUserId, visible),
    storeCodexAccountTransport({
      ownerUserId: input.updatedByUserId,
      accountLabel: secret.accountLabel,
      accessToken: secret.accessToken,
      refreshToken: secret.refreshToken,
      idToken: secret.idToken,
      source: 'codex-device',
    }),
  ]);

  return toCodexProviderState(visible);
};

export const disconnectCodexEnrollment = async (input: {
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const next: CodexConnectionPayload = {
    status: 'disconnected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  await Promise.all([
    writeCodexConnection(input.updatedByUserId, next),
    deleteCodexSecrets(input.updatedByUserId),
    disconnectCodexAccountTransports({ ownerUserId: input.updatedByUserId }),
  ]);

  return toCodexProviderState(next);
};

export const startClaudeCodeEnrollment = async (input: {
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const authorization = startClaudeCodeAuthorization();
  const enrollmentId = createId();
  const accountLabel = normalizeOptionalText(input.accountLabel);
  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'pending',
    enrollmentId,
    enrollmentUrl: authorization.authorizeUrl,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };
  const secret: ClaudeCodePendingEnrollmentPayload = {
    enrollmentId,
    codeVerifier: authorization.codeVerifier,
    state: authorization.state,
    redirectUri: authorization.redirectUri,
    expectedAccountLabel: accountLabel,
  };

  await Promise.all([
    deleteClaudeCodeSecrets(input.updatedByUserId),
    writeClaudeCodeConnection(input.updatedByUserId, visible),
    writeEncryptedSetting(
      input.updatedByUserId,
      CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY,
      secret,
      'Pending Claude Code OAuth enrollment secret for the current admin user.',
    ),
  ]);

  return toAnthropicProviderState(visible, null, { credential: null, source: 'none' });
};

export const completeClaudeCodeEnrollment = async (input: {
  enrollmentId: string;
  authorizationCode: string;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const [current, pending] = await Promise.all([
    readClaudeCodeConnection(input.updatedByUserId),
    readPendingClaudeCodeEnrollment(input.updatedByUserId),
  ]);

  if (!current || current.status !== 'pending' || current.enrollmentId !== input.enrollmentId) {
    throw new Error('Invalid or expired Claude Code enrollment session.');
  }
  if (!pending || pending.enrollmentId !== input.enrollmentId) {
    throw new Error('Missing pending Claude Code enrollment state.');
  }

  const parsed = parseClaudeCodeAuthorizationInput(input.authorizationCode);
  if (pending.state && parsed.state && pending.state !== parsed.state) {
    throw new Error('Claude Code enrollment state mismatch.');
  }

  const tokens = await exchangeClaudeCodeAuthorizationCode({
    authorizationCode: parsed.authorizationCode,
    codeVerifier: pending.codeVerifier,
    state: parsed.state ?? pending.state,
    redirectUri: pending.redirectUri,
  });

  const profile = await fetchClaudeCodeProfile({ accessToken: tokens.accessToken }).catch(
    () => null,
  );
  const requestedAccountLabel =
    normalizeOptionalText(input.accountLabel) || pending.expectedAccountLabel;
  const connectedAccountLabel = profile?.email || profile?.name || requestedAccountLabel;
  const externalAccountId = profile?.accountUuid ?? connectedAccountLabel ?? createId();
  const subscriptionType = profile?.hasClaudeMax ? 'max' : profile?.hasClaudePro ? 'pro' : null;

  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: connectedAccountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  const [, storedAccount] = await Promise.all([
    deleteUserScopedSetting(input.updatedByUserId, CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY),
    storeClaudeCodeAccountTransport({
      ownerUserId: input.updatedByUserId,
      accountLabel: connectedAccountLabel,
      externalAccountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      subscriptionType,
      profile: profile ? (profile as unknown as Record<string, unknown>) : null,
    }),
    writeClaudeCodeConnection(input.updatedByUserId, visible),
  ]);

  return toAnthropicProviderState(visible, storedAccount ?? null, {
    credential: null,
    source: 'none',
  });
};

// Non-interactive import: register an existing local Claude Code login
// (tokens read from ~/.claude/.credentials.json `claudeAiOauth`) without the
// browser paste-code flow. This is the h2a-friendly enrollment path.
export const importClaudeCodeEnrollment = async (input: {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string | null;
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const accessToken = normalizeOptionalText(input.accessToken);
  const refreshToken = normalizeOptionalText(input.refreshToken);
  if (!accessToken || !refreshToken) {
    throw new Error('Claude Code import requires both an access token and a refresh token.');
  }

  const profile = await fetchClaudeCodeProfile({ accessToken }).catch(() => null);
  const requestedAccountLabel = normalizeOptionalText(input.accountLabel);
  const connectedAccountLabel = profile?.email || profile?.name || requestedAccountLabel;
  const externalAccountId = profile?.accountUuid ?? connectedAccountLabel ?? createId();
  const subscriptionType =
    normalizeOptionalText(input.subscriptionType) ??
    (profile?.hasClaudeMax ? 'max' : profile?.hasClaudePro ? 'pro' : null);

  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: connectedAccountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  const [, storedAccount] = await Promise.all([
    deleteClaudeCodeSecrets(input.updatedByUserId),
    storeClaudeCodeAccountTransport({
      ownerUserId: input.updatedByUserId,
      accountLabel: connectedAccountLabel,
      externalAccountId,
      accessToken,
      refreshToken,
      expiresAt: normalizeOptionalText(input.expiresAt),
      subscriptionType,
      rateLimitTier: normalizeOptionalText(input.rateLimitTier),
      profile: profile ? (profile as unknown as Record<string, unknown>) : null,
    }),
    writeClaudeCodeConnection(input.updatedByUserId, visible),
  ]);

  return toAnthropicProviderState(visible, storedAccount ?? null, {
    credential: null,
    source: 'none',
  });
};

export const disconnectClaudeCodeEnrollment = async (input: {
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const next: CodexConnectionPayload = {
    status: 'disconnected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  await Promise.all([
    writeClaudeCodeConnection(input.updatedByUserId, next),
    deleteClaudeCodeSecrets(input.updatedByUserId),
    disconnectClaudeCodeAccountTransports({ ownerUserId: input.updatedByUserId }),
  ]);

  return toAnthropicProviderState(next, null, { credential: null, source: 'none' });
};

// ---------------------------------------------------------------------------
// Antigravity enrollment (mirrors the Claude Code OAuth flow): PKCE authorize +
// code-exchange complete + non-interactive import. Unlike Claude Code, the
// complete/import steps also DISCOVER the bound GCP project (loadCodeAssist) and
// ONBOARD the account (onboardUser) so the cloudcode-pa fleet is callable.
// ---------------------------------------------------------------------------

const discoverAntigravityAccount = async (
  accessToken: string,
): Promise<{ project: string | null; tier: string | null; externalAccountId: string; accountLabel: string | null }> => {
  // Project discovery and onboarding are required for a usable Cloud Code
  // account. Do not persist a misleading "connected" state when either fails.
  const discovery = await loadCodeAssist({ accessToken });
  if (!discovery.project) {
    throw new Error('Antigravity project discovery returned no Cloud Code project.');
  }
  await onboardAntigravityUser({
    accessToken,
    project: discovery.project,
    ...(discovery.tier ? { tierId: discovery.tier } : {}),
  });
  // Profile metadata is cosmetic; its unavailability must not hide a valid,
  // already discovered and onboarded account.
  const userInfo = await fetchAntigravityUserInfo({ accessToken }).catch(() => null);
  const accountLabel = userInfo?.email || userInfo?.name || null;
  const externalAccountId = userInfo?.sub || accountLabel || createId();
  return {
    project: discovery.project,
    tier: discovery.tier,
    externalAccountId,
    accountLabel,
  };
};

export const startAntigravityEnrollment = async (input: {
  accountLabel?: string | null;
  redirectPort?: number;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const authorization = startAntigravityAuthorization({ redirectPort: input.redirectPort });
  const redirectPort = input.redirectPort ?? 0;
  const enrollmentId = createId();
  const accountLabel = normalizeOptionalText(input.accountLabel);
  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'pending',
    enrollmentId,
    enrollmentUrl: authorization.authorizeUrl,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };
  const secret: AntigravityPendingEnrollmentPayload = {
    enrollmentId,
    codeVerifier: authorization.codeVerifier,
    state: authorization.state,
    redirectUri: authorization.redirectUri,
    redirectPort,
    expectedAccountLabel: accountLabel,
  };

  await Promise.all([
    deleteAntigravitySecrets(input.updatedByUserId),
    writeAntigravityConnection(input.updatedByUserId, visible),
    writeEncryptedSetting(
      input.updatedByUserId,
      ANTIGRAVITY_CONNECTION_PENDING_SECRET_KEY,
      secret,
      'Pending Antigravity OAuth enrollment secret for the current admin user.',
    ),
  ]);

  return toAntigravityProviderState(visible, null);
};

export const completeAntigravityEnrollment = async (input: {
  enrollmentId: string;
  authorizationCode: string;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const [current, pending] = await Promise.all([
    readAntigravityConnection(input.updatedByUserId),
    readPendingAntigravityEnrollment(input.updatedByUserId),
  ]);

  if (!current || current.status !== 'pending' || current.enrollmentId !== input.enrollmentId) {
    throw new Error('Invalid or expired Antigravity enrollment session.');
  }
  if (!pending || pending.enrollmentId !== input.enrollmentId) {
    throw new Error('Missing pending Antigravity enrollment state.');
  }

  const tokens = await exchangeAntigravityAuthorizationCode({
    authorizationCode: input.authorizationCode,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  });

  const discovered = await discoverAntigravityAccount(tokens.accessToken);
  const requestedAccountLabel =
    normalizeOptionalText(input.accountLabel) || pending.expectedAccountLabel;
  const connectedAccountLabel = discovered.accountLabel || requestedAccountLabel;

  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: connectedAccountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  const [, storedAccount] = await Promise.all([
    deleteUserScopedSetting(input.updatedByUserId, ANTIGRAVITY_CONNECTION_PENDING_SECRET_KEY),
    storeAntigravityAccountTransport({
      ownerUserId: input.updatedByUserId,
      accountLabel: connectedAccountLabel,
      externalAccountId: discovered.externalAccountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      project: discovered.project,
      tier: discovered.tier,
    }),
    writeAntigravityConnection(input.updatedByUserId, visible),
  ]);

  return toAntigravityProviderState(visible, storedAccount ?? null);
};

// Non-interactive import: register existing Antigravity tokens (e.g. from a
// local login) without the browser flow. Discovers project/label if absent.
export const importAntigravityEnrollment = async (input: {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string | null;
  project?: string | null;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const accessToken = normalizeOptionalText(input.accessToken);
  const refreshToken = normalizeOptionalText(input.refreshToken);
  if (!accessToken || !refreshToken) {
    throw new Error('Antigravity import requires both an access token and a refresh token.');
  }

  // Imported CLI credentials can carry an expired access token while retaining a
  // valid refresh token. Refresh before discovery/onboarding: loadCodeAssist
  // needs a live token to bind the Cloud Code project.
  const refreshed = await refreshAntigravityAccessToken({ refreshToken });
  const activeAccessToken = refreshed.accessToken;
  const activeRefreshToken = refreshed.refreshToken || refreshToken;
  const discovered = await discoverAntigravityAccount(activeAccessToken);
  const project = normalizeOptionalText(input.project) ?? discovered.project;
  if (!project) {
    throw new Error(
      'Antigravity project discovery failed. Re-authenticate with Antigravity or provide a valid project.',
    );
  }
  const requestedAccountLabel = normalizeOptionalText(input.accountLabel);
  const connectedAccountLabel = discovered.accountLabel || requestedAccountLabel;

  const now = new Date().toISOString();
  const visible: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: connectedAccountLabel,
    updatedAt: now,
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  const [, storedAccount] = await Promise.all([
    deleteAntigravitySecrets(input.updatedByUserId),
    storeAntigravityAccountTransport({
      ownerUserId: input.updatedByUserId,
      accountLabel: connectedAccountLabel,
      externalAccountId: discovered.externalAccountId,
      accessToken: activeAccessToken,
      refreshToken: activeRefreshToken,
      expiresAt: refreshed.expiresAt,
      project,
      tier: discovered.tier,
    }),
    writeAntigravityConnection(input.updatedByUserId, visible),
  ]);

  return toAntigravityProviderState(visible, storedAccount ?? null);
};

export const disconnectAntigravityEnrollment = async (input: {
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const next: CodexConnectionPayload = {
    status: 'disconnected',
    enrollmentId: null,
    enrollmentUrl: null,
    enrollmentCode: null,
    enrollmentExpiresAt: null,
    accountLabel: null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeOptionalText(input.updatedByUserId),
  };

  await Promise.all([
    writeAntigravityConnection(input.updatedByUserId, next),
    deleteAntigravitySecrets(input.updatedByUserId),
    disconnectAntigravityAccountTransports({ ownerUserId: input.updatedByUserId }),
  ]);

  return toAntigravityProviderState(next, null);
};
