import { env } from '../config/env';
import type { ProviderId } from './provider-runtime';
import { settingsService } from './settings';

export type ProviderCredentialSource =
  | 'request_override'
  | 'user_byok'
  | 'workspace_key'
  | 'environment'
  | 'none';

export type ResolvedProviderCredential = {
  providerId: ProviderId;
  credential: string | null;
  source: ProviderCredentialSource;
};

const normalizeCredential = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const getEnvironmentCredential = (providerId: ProviderId): string | null => {
  if (providerId === 'openai') return normalizeCredential(env.OPENAI_API_KEY);
  if (providerId === 'gemini') return normalizeCredential(env.GEMINI_API_KEY);
  return null;
};

export const buildUserProviderCredentialSettingKey = (
  providerId: ProviderId,
  userId: string
): string => `ai_provider_key_user:${providerId}:${userId}`;

export const buildWorkspaceProviderCredentialSettingKey = (
  providerId: ProviderId,
  workspaceId: string
): string => `ai_provider_key_workspace:${providerId}:${workspaceId}`;

export const resolveProviderCredential = async (input: {
  providerId: ProviderId;
  requestCredential?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
}): Promise<ResolvedProviderCredential> => {
  const requestCredential = normalizeCredential(input.requestCredential);
  if (requestCredential) {
    return {
      providerId: input.providerId,
      credential: requestCredential,
      source: 'request_override',
    };
  }

  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (userId) {
    const userCredential = normalizeCredential(
      await settingsService.get(
        buildUserProviderCredentialSettingKey(input.providerId, userId)
      )
    );
    if (userCredential) {
      return {
        providerId: input.providerId,
        credential: userCredential,
        source: 'user_byok',
      };
    }
  }

  const workspaceId =
    typeof input.workspaceId === 'string' ? input.workspaceId.trim() : '';
  if (workspaceId) {
    const workspaceCredential = normalizeCredential(
      await settingsService.get(
        buildWorkspaceProviderCredentialSettingKey(input.providerId, workspaceId)
      )
    );
    if (workspaceCredential) {
      return {
        providerId: input.providerId,
        credential: workspaceCredential,
        source: 'workspace_key',
      };
    }
  }

  const environmentCredential = getEnvironmentCredential(input.providerId);
  if (environmentCredential) {
    return {
      providerId: input.providerId,
      credential: environmentCredential,
      source: 'environment',
    };
  }

  return {
    providerId: input.providerId,
    credential: null,
    source: 'none',
  };
};
