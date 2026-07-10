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
  acquireClaudeCodeAccountTransport,
  acquireOpenAICodexAccountTransport,
  disconnectClaudeCodeAccountTransports,
  disconnectCodexAccountTransports,
  getPrimaryClaudeCodeAccountTransport,
  getPrimaryCodexAccountTransport,
  storeClaudeCodeAccountTransport,
  storeCodexAccountTransport,
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
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { settingsService } from './settings';

export type ProviderConnectionId = 'codex' | 'openai' | 'gemini' | 'anthropic' | 'mistral' | 'cohere';

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

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';
const CODEX_CONNECTION_PENDING_SECRET_KEY = 'provider_connection_secret:codex_pending';
const CODEX_CONNECTION_SECRET_KEY = 'provider_connection_secret:codex';
const OPENAI_TRANSPORT_MODE_SETTING_KEY = 'provider_connection_mode:openai';
const ANTHROPIC_TRANSPORT_MODE_SETTING_KEY = 'provider_connection_mode:anthropic';
const CLAUDE_CODE_CONNECTION_SETTINGS_KEY = 'provider_connection:claude_code';
const CLAUDE_CODE_CONNECTION_PENDING_SECRET_KEY =
  'provider_connection_secret:claude_code_pending';

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

export const getAnthropicTransportMode = async (): Promise<'claude-code' | 'token'> =>
  normalizeText(
    await settingsService.get(ANTHROPIC_TRANSPORT_MODE_SETTING_KEY, { fallbackToGlobal: true }),
  ).toLowerCase() === 'claude-code'
    ? 'claude-code'
    : 'token';

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
  const [
    codexConnection,
    claudeConnection,
    openaiCredential,
    geminiCredential,
    anthropicCredential,
    mistralCredential,
    cohereCredential,
  ] = await Promise.all([
    userId ? readCodexConnection(userId) : Promise.resolve(null),
    userId ? readClaudeCodeConnection(userId) : Promise.resolve(null),
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
