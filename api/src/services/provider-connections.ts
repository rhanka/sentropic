import { env } from '../config/env';
import { settingsService } from './settings';

export type ProviderConnectionId = 'codex' | 'openai' | 'gemini';

export type ProviderConnectionState = {
  providerId: ProviderConnectionId;
  label: string;
  ready: boolean;
  managedBy: 'admin_settings' | 'environment' | 'none';
  accountLabel: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  canConfigure: boolean;
};

type CodexConnectionPayload = {
  connected: boolean;
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
    return {
      connected: parsed.connected === true,
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

export const listProviderConnections = async (): Promise<
  ProviderConnectionState[]
> => {
  const codexConnection = await readCodexConnection();
  const codexReady = codexConnection?.connected === true;

  return [
    {
      providerId: 'codex',
      label: 'Codex',
      ready: codexReady,
      managedBy: codexReady ? 'admin_settings' : 'none',
      accountLabel: codexConnection?.accountLabel ?? null,
      updatedAt: codexConnection?.updatedAt ?? null,
      updatedByUserId: codexConnection?.updatedByUserId ?? null,
      canConfigure: true,
    },
    {
      providerId: 'openai',
      label: 'OpenAI',
      ready: hasEnvCredential(env.OPENAI_API_KEY),
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
      managedBy: hasEnvCredential(env.GEMINI_API_KEY) ? 'environment' : 'none',
      accountLabel: null,
      updatedAt: null,
      updatedByUserId: null,
      canConfigure: false,
    },
  ];
};

export const updateCodexConnection = async (input: {
  connected: boolean;
  accountLabel?: string | null;
  updatedByUserId: string;
}): Promise<ProviderConnectionState> => {
  const next: CodexConnectionPayload = {
    connected: input.connected === true,
    accountLabel: normalizeText(input.accountLabel) || null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: normalizeText(input.updatedByUserId) || null,
  };

  await settingsService.set(
    CODEX_CONNECTION_SETTINGS_KEY,
    JSON.stringify(next),
    'Shared provider connection state for Codex (admin-managed).',
  );

  return {
    providerId: 'codex',
    label: 'Codex',
    ready: next.connected,
    managedBy: next.connected ? 'admin_settings' : 'none',
    accountLabel: next.accountLabel,
    updatedAt: next.updatedAt,
    updatedByUserId: next.updatedByUserId,
    canConfigure: true,
  };
};
