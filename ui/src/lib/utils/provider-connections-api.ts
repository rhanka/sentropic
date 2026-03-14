import { apiGet, apiPost } from './api';

export type ProviderConnectionState = {
  providerId: 'codex' | 'openai' | 'gemini' | 'anthropic' | 'mistral' | 'cohere';
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

type ProviderConnectionsGetRequester = (
  path: string,
) => Promise<{ providers: ProviderConnectionState[] }>;

type ProviderConnectionsPostRequester = (
  path: string,
  body?: Record<string, unknown>,
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

export const startCodexProviderEnrollment = async (input: {
  accountLabel?: string | null;
}): Promise<ProviderConnectionState> =>
  startCodexProviderEnrollmentWith(input, (path, body) =>
    apiPost<{ provider: ProviderConnectionState }>(path, body ?? {}),
  );

export const startCodexProviderEnrollmentWith = async (
  input: {
    accountLabel?: string | null;
  },
  requester: ProviderConnectionsPostRequester,
): Promise<ProviderConnectionState> => {
  const payload = await requester('/settings/provider-connections/codex/enrollment/start', {
    accountLabel: input.accountLabel ?? null,
  });
  return payload.provider;
};

export const completeCodexProviderEnrollment = async (input: {
  enrollmentId: string;
  accountLabel?: string | null;
}): Promise<ProviderConnectionState> =>
  completeCodexProviderEnrollmentWith(input, (path, body) =>
    apiPost<{ provider: ProviderConnectionState }>(path, body ?? {}),
  );

export const completeCodexProviderEnrollmentWith = async (
  input: {
    enrollmentId: string;
    accountLabel?: string | null;
  },
  requester: ProviderConnectionsPostRequester,
): Promise<ProviderConnectionState> => {
  const payload = await requester('/settings/provider-connections/codex/enrollment/complete', {
    enrollmentId: input.enrollmentId,
    accountLabel: input.accountLabel ?? null,
  });
  return payload.provider;
};

export const disconnectCodexProviderEnrollment = async (): Promise<ProviderConnectionState> =>
  disconnectCodexProviderEnrollmentWith((path, body) =>
    apiPost<{ provider: ProviderConnectionState }>(path, body ?? {}),
  );

export const disconnectCodexProviderEnrollmentWith = async (
  requester: ProviderConnectionsPostRequester,
): Promise<ProviderConnectionState> => {
  const payload = await requester('/settings/provider-connections/codex/enrollment/disconnect');
  return payload.provider;
};
