import type { ModelId, ProviderId } from './providers.js';

export const tokenAuthSourceTypes = [
  'direct-token',
  'user-token',
  'workspace-token',
  'environment-token',
] as const;

export type TokenAuthSourceType = (typeof tokenAuthSourceTypes)[number];

export const accountTransportProviderIds = [
  'codex',
  'gemini-code-assist',
  'claude-code',
] as const;

export type AccountTransportProviderId = (typeof accountTransportProviderIds)[number];

export type AuthSourceType = TokenAuthSourceType | 'codex-account' | 'account-transport' | 'none';

export interface AuthDescriptor {
  sourceType: AuthSourceType;
  label?: string;
  accountProviderId?: AccountTransportProviderId | (string & {});
  accountId?: string | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
  hasRefreshToken?: boolean;
  redactedFingerprint?: string;
  metadata?: Record<string, unknown>;
}

interface AuthMaterialBase {
  descriptor?: Partial<AuthDescriptor>;
}

export interface DirectTokenAuthMaterial extends AuthMaterialBase {
  type: 'direct-token';
  token: string;
  label?: string;
}

export interface UserTokenAuthMaterial extends AuthMaterialBase {
  type: 'user-token';
  userId: string;
  token?: string;
  tokenRef?: string;
  label?: string;
}

export interface WorkspaceTokenAuthMaterial extends AuthMaterialBase {
  type: 'workspace-token';
  workspaceId: string;
  token?: string;
  tokenRef?: string;
  label?: string;
}

export interface EnvironmentTokenAuthMaterial extends AuthMaterialBase {
  type: 'environment-token';
  envVar: string;
  token?: string;
  label?: string;
}

export interface CodexAccountAuthMaterial extends AuthMaterialBase {
  type: 'codex-account';
  provider: 'codex';
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
}

export interface FutureAccountTransportAuthMaterial extends AuthMaterialBase {
  type: 'account-transport';
  provider: Exclude<AccountTransportProviderId, 'codex'> | (string & {});
  status: 'planned';
  accessToken?: string;
  refreshToken?: string;
  accountId?: string | null;
  accountLabel?: string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface NoAuthMaterial extends AuthMaterialBase {
  type: 'none';
}

export type SecretAuthMaterial =
  | DirectTokenAuthMaterial
  | UserTokenAuthMaterial
  | WorkspaceTokenAuthMaterial
  | EnvironmentTokenAuthMaterial
  | CodexAccountAuthMaterial
  | FutureAccountTransportAuthMaterial
  | NoAuthMaterial;

export type AuthSource = SecretAuthMaterial;

export interface AuthResolutionRequest {
  providerId: ProviderId;
  modelId?: ModelId;
  userId?: string | null;
  workspaceId?: string | null;
  preferredSources?: readonly AuthSourceType[];
  requestToken?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuthResolution {
  material: SecretAuthMaterial;
  descriptor: AuthDescriptor;
}

export type AuthResolver = (
  request: AuthResolutionRequest,
) => AuthResolution | Promise<AuthResolution>;

export type AuthInput = SecretAuthMaterial | AuthResolution;

export const futureAccountTransportProviderIds = [
  'gemini-code-assist',
  'claude-code',
] as const satisfies readonly AccountTransportProviderId[];

export const getSecretAuthMaterial = (
  input?: AuthInput,
): SecretAuthMaterial | undefined => {
  return input && 'material' in input ? input.material : input;
};

export const describeAuthMaterial = (
  material: SecretAuthMaterial,
): AuthDescriptor => {
  const baseDescriptor = material.descriptor ?? {};

  switch (material.type) {
    case 'direct-token':
      return {
        sourceType: material.type,
        ...(material.label ? { label: material.label } : {}),
        ...baseDescriptor,
      };

    case 'user-token':
      return {
        sourceType: material.type,
        ...(material.label ? { label: material.label } : {}),
        ...baseDescriptor,
      };

    case 'workspace-token':
      return {
        sourceType: material.type,
        ...(material.label ? { label: material.label } : {}),
        ...baseDescriptor,
      };

    case 'environment-token':
      return {
        sourceType: material.type,
        ...(material.label ? { label: material.label } : {}),
        ...baseDescriptor,
      };

    case 'codex-account':
      return {
        sourceType: material.type,
        accountProviderId: material.provider,
        ...(material.accountId ? { accountId: material.accountId } : {}),
        ...(material.accountLabel ? { accountLabel: material.accountLabel } : {}),
        ...(material.expiresAt ? { expiresAt: material.expiresAt } : {}),
        ...(material.refreshToken ? { hasRefreshToken: true } : {}),
        ...baseDescriptor,
      };

    case 'account-transport':
      return {
        sourceType: material.type,
        accountProviderId: material.provider,
        ...(material.accountId ? { accountId: material.accountId } : {}),
        ...(material.accountLabel ? { accountLabel: material.accountLabel } : {}),
        ...(material.refreshToken ? { hasRefreshToken: true } : {}),
        ...baseDescriptor,
      };

    case 'none':
      return {
        sourceType: material.type,
        ...baseDescriptor,
      };
  }
};

export const getAuthDescriptor = (
  input?: AuthInput,
): AuthDescriptor | undefined => {
  if (!input) {
    return undefined;
  }

  return 'material' in input
    ? input.descriptor
    : describeAuthMaterial(input);
};
