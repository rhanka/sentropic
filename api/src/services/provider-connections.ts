import { env } from '../config/env';
import { createId } from '../utils/id';
import { settingsService } from './settings';

export type ProviderConnectionId = 'codex' | 'openai' | 'gemini';

export type ProviderConnectionState = {
  providerId: ProviderConnectionId;
  label: string;
  ready: boolean;
  connectionStatus: 'connected' | 'pending' | 'disconnected';
  enrollmentId: string | null;
  enrollmentUrl: string | null;
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
  accountLabel: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
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
      enrollmentId: normalizeText(parsed.enrollmentId) || null,
      enrollmentUrl: normalizeText(parsed.enrollmentUrl) || null,
      accountLabel: normalizeText(parsed.accountLabel) || null,
      updatedAt: normalizeText(parsed.updatedAt) || null,
      updatedByUserId: normalizeText(parsed.updatedByUserId) || null,
    };
  } catch {
    return null;
  }
};

const hasEnvCredential = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const readCodexConnection = async (): Promise<CodexConnectionPayload | null> => {
  const raw = await settingsService.get(CODEX_CONNECTION_SETTINGS_KEY, {
    fallbackToGlobal: true,
  });
  return parseCodexConnectionPayload(raw);
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
    managedBy: ready ? 'admin_settings' : 'none',
    accountLabel: codexConnection?.accountLabel ?? null,
    updatedAt: codexConnection?.updatedAt ?? null,
    updatedByUserId: codexConnection?.updatedByUserId ?? null,
    canConfigure: true,
  };
};

export const listProviderConnections = async (): Promise<
  ProviderConnectionState[]
> => {
  const codexConnection = await readCodexConnection();

  return [
    toCodexProviderState(codexConnection),
    {
      providerId: 'openai',
      label: 'OpenAI',
      ready: hasEnvCredential(env.OPENAI_API_KEY),
      connectionStatus: hasEnvCredential(env.OPENAI_API_KEY)
        ? 'connected'
        : 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      managedBy: hasEnvCredential(env.OPENAI_API_KEY) ? 'environment' : 'none',
      accountLabel: null,
      updatedAt: null,
      updatedByUserId: null,
      canConfigure: false,
    },
    {
      providerId: 'gemini',
      label: 'Gemini',
      ready: hasEnvCredential(env.GEMINI_API_KEY),
      connectionStatus: hasEnvCredential(env.GEMINI_API_KEY)
        ? 'connected'
        : 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      managedBy: hasEnvCredential(env.GEMINI_API_KEY) ? 'environment' : 'none',
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
  const enrollmentId = createId();
  const next: CodexConnectionPayload = {
    status: 'pending',
    enrollmentId,
    enrollmentUrl: `https://chatgpt.com/auth?next=/codex&state=${encodeURIComponent(
      enrollmentId,
    )}`,
    accountLabel: normalizeText(input.accountLabel) || null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeText(input.updatedByUserId) || null,
  };
  await settingsService.set(
    CODEX_CONNECTION_SETTINGS_KEY,
    JSON.stringify(next),
    'Shared provider connection state for Codex (admin-managed).',
  );
  return toCodexProviderState(next);
};

export const completeCodexEnrollment = async (input: {
  enrollmentId: string;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const current = await readCodexConnection();
  if (!current || current.status !== 'pending' || current.enrollmentId !== input.enrollmentId) {
    throw new Error('Invalid or expired Codex enrollment session.');
  }
  const next: CodexConnectionPayload = {
    status: 'connected',
    enrollmentId: null,
    enrollmentUrl: null,
    accountLabel: normalizeText(input.accountLabel) || current.accountLabel || null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeText(input.updatedByUserId) || null,
  };
  await settingsService.set(
    CODEX_CONNECTION_SETTINGS_KEY,
    JSON.stringify(next),
    'Shared provider connection state for Codex (admin-managed).',
  );
  return toCodexProviderState(next);
};

export const disconnectCodexEnrollment = async (input: {
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const next: CodexConnectionPayload = {
    status: 'disconnected',
    enrollmentId: null,
    enrollmentUrl: null,
    accountLabel: null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeText(input.updatedByUserId) || null,
  };
  await settingsService.set(
    CODEX_CONNECTION_SETTINGS_KEY,
    JSON.stringify(next),
    'Shared provider connection state for Codex (admin-managed).',
  );
  return toCodexProviderState(next);
};
