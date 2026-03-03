import { apiGet, apiPut } from './api';

export type ProviderConnectionState = {
  providerId: 'codex' | 'openai' | 'gemini';
  label: string;
  ready: boolean;
  managedBy: 'admin_settings' | 'environment' | 'none';
  accountLabel: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  canConfigure: boolean;
};

type ProviderConnectionsGetRequester = (
  path: string,
) => Promise<{ providers: ProviderConnectionState[] }>;

type ProviderConnectionsPutRequester = (
  path: string,
  body: Record<string, unknown>,
) => Promise<{ provider: ProviderConnectionState }>;

export const fetchProviderConnections = async (): Promise<
  ProviderConnectionState[]
> =>
  fetchProviderConnectionsWith((path) =>
    apiGet<{ providers: ProviderConnectionState[] }>(path),
  );

export const fetchProviderConnectionsWith = async (
  requester: ProviderConnectionsGetRequester,
): Promise<ProviderConnectionState[]> => {
  const payload = await requester('/settings/provider-connections');
  return Array.isArray(payload.providers) ? payload.providers : [];
};

export const saveCodexProviderConnection = async (
  input: {
    connected: boolean;
    accountLabel?: string | null;
  },
): Promise<ProviderConnectionState> =>
  saveCodexProviderConnectionWith(input, (path, body) =>
    apiPut<{ provider: ProviderConnectionState }>(path, body),
  );

export const saveCodexProviderConnectionWith = async (
  input: {
    connected: boolean;
    accountLabel?: string | null;
  },
  requester: ProviderConnectionsPutRequester,
): Promise<ProviderConnectionState> => {
  const payload = await requester('/settings/provider-connections/codex', {
    connected: input.connected,
    accountLabel: input.accountLabel ?? null,
  });
  return payload.provider;
};
