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
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { settingsService } from './settings';

export type ProviderConnectionId = 'codex' | 'openai' | 'gemini';

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
};

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';
const CODEX_CONNECTION_PENDING_SECRET_KEY = 'provider_connection_secret:codex_pending';
const CODEX_CONNECTION_SECRET_KEY = 'provider_connection_secret:codex';
const OPENAI_TRANSPORT_MODE_SETTING_KEY = 'provider_connection_mode:openai';

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

const readJwtStringClaim = (claims: Record<string, unknown> | null, key: string): string | null => {
  const value = claims?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const inferCodexAccountId = (accessToken: string, idToken: string | null): string | null => {
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

export const resolveConnectedCodexTransport = async (
  userId: string,
): Promise<{ accessToken: string; accountId: string | null } | null> => {
  const secret = parseSecretPayload<CodexConnectedSecret>(
    await settingsService.get(CODEX_CONNECTION_SECRET_KEY, { userId, fallbackToGlobal: false }),
  );
  const accessToken = normalizeOptionalText(secret?.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    accountId: inferCodexAccountId(accessToken, normalizeOptionalText(secret?.idToken)),
  };
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

const toCodexProviderState = (
  codexConnection: CodexConnectionPayload | null,
): ProviderConnectionState => {
  const status = codexConnection?.status ?? 'disconnected';
  const ready = status === 'connected';
  return {
    providerId: 'codex',
    label: 'Codex',
    ready,
    connectionStatus: status,
    enrollmentId: codexConnection?.enrollmentId ?? null,
    enrollmentUrl: codexConnection?.enrollmentUrl ?? null,
    enrollmentCode: codexConnection?.enrollmentCode ?? null,
    enrollmentExpiresAt: codexConnection?.enrollmentExpiresAt ?? null,
    managedBy: status === 'disconnected' ? 'none' : 'admin_settings',
    accountLabel: codexConnection?.accountLabel ?? null,
    updatedAt: codexConnection?.updatedAt ?? null,
    updatedByUserId: codexConnection?.updatedByUserId ?? null,
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

export const listProviderConnections = async (input?: {
  userId?: string | null;
}): Promise<ProviderConnectionState[]> => {
  const userId = normalizeOptionalText(input?.userId);
  const [codexConnection, openaiCredential, geminiCredential] = await Promise.all([
    userId ? readCodexConnection(userId) : Promise.resolve(null),
    resolveProviderCredential({
      providerId: 'openai',
      userId,
    }),
    resolveProviderCredential({
      providerId: 'gemini',
      userId,
    }),
  ]);

  return [
    toCodexProviderState(codexConnection),
    {
      providerId: 'openai',
      label: 'OpenAI',
      ready: Boolean(openaiCredential.credential),
      connectionStatus: openaiCredential.credential
        ? 'connected'
        : 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
      managedBy: toManagedBy(openaiCredential.source),
      accountLabel: null,
      updatedAt: null,
      updatedByUserId: null,
      canConfigure: false,
    },
    {
      providerId: 'gemini',
      label: 'Gemini',
      ready: Boolean(geminiCredential.credential),
      connectionStatus: geminiCredential.credential
        ? 'connected'
        : 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
      managedBy: toManagedBy(geminiCredential.source),
      accountLabel: null,
      updatedAt: null,
      updatedByUserId: null,
      canConfigure: false,
    },
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
    writeCodexConnection(input.updatedByUserId, visible),
    writeEncryptedSetting(
      input.updatedByUserId,
      CODEX_CONNECTION_SECRET_KEY,
      secret,
      'Codex provider credential for the current admin user.',
    ),
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
  ]);

  return toCodexProviderState(next);
};
