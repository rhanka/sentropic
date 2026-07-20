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
  'claude-code',
  // Antigravity: unified Google account transport fronting a multi-model fleet
  // (Cloud Code `cloudcode-pa.googleapis.com`). Replaced the dead classic
  // gemini-cli Code Assist path (see api/antigravity-provider-auth.ts).
  'antigravity',
] as const;

export type AccountTransportProviderId = (typeof accountTransportProviderIds)[number];

export type AuthSourceType = TokenAuthSourceType | 'codex-account' | 'claude-code-account' | 'account-transport' | 'none';

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

export interface AccountTransportAuthMaterial extends AuthMaterialBase {
  type: 'account-transport';
  provider: AccountTransportProviderId | (string & {});
  accessToken: string;
  refreshToken?: string;
  accountId?: string | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ClaudeCodeAccountAuthMaterial extends AuthMaterialBase {
  type: 'claude-code-account';
  provider: 'claude-code';
  accessToken: string;
  accountId?: string | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
  // No refreshToken — refresh is gateway-owned (not llm-mesh, not remote)
}

export interface PlannedAccountTransportAuthMaterial extends AuthMaterialBase {
  type: 'account-transport';
  provider: AccountTransportProviderId | (string & {});
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
  | ClaudeCodeAccountAuthMaterial
  | AccountTransportAuthMaterial
  | PlannedAccountTransportAuthMaterial
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

// All enrolled account transports are executable post-cutover (the classic
// gemini-cli Code Assist "planned/future" transport was removed). This list is
// the single source of truth for account transports that carry live bearer
// material through the mesh adapter-auth gate.
export const executableAccountTransportProviderIds = [
  'codex',
  'claude-code',
  'antigravity',
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

    case 'claude-code-account':
      return {
        sourceType: material.type,
        accountProviderId: material.provider,
        ...(material.accountId ? { accountId: material.accountId } : {}),
        ...(material.accountLabel ? { accountLabel: material.accountLabel } : {}),
        ...(material.expiresAt ? { expiresAt: material.expiresAt } : {}),
        ...baseDescriptor,
      };

    case 'account-transport':
      return {
        sourceType: material.type,
        accountProviderId: material.provider,
        ...(material.accountId ? { accountId: material.accountId } : {}),
        ...(material.accountLabel ? { accountLabel: material.accountLabel } : {}),
        ...('expiresAt' in material && material.expiresAt ? { expiresAt: material.expiresAt } : {}),
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
