import { isNativeMessagesTarget, NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS, validateNativeModelAllowlist,
  type NativeMessagesResult, type PreparedNativeMessages, type VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import type { NativeCountTokensPort } from '@sentropic/llm-gateway';
import { resolveProviderCredential, type ProviderCredentialSource } from '../provider-credentials';
import { getAnthropicTransportMode, resolveConnectedClaudeCodeTransport } from '../provider-connections';
import { getPrimaryClaudeCodeAccountTransport } from '../llm-account-transports';
import { ClaudeProviderRuntime } from '../providers/claude-provider';

export const nativeAuthDependencies = { resolveProviderCredential, getAnthropicTransportMode,
  getPrimaryClaudeCodeAccountTransport, resolveConnectedClaudeCodeTransport };
export type NativeAuthDependencies = typeof nativeAuthDependencies;
export type AnthropicNativeAuth = { readonly kind: 'token'; readonly credential: string; readonly source: ProviderCredentialSource }
  | { readonly kind: 'account'; readonly source: 'claude-code' };

/** Caller body/headers never populate requestCredential or select an account/URL. */
export const resolveAnthropicNativeAuth = async (userId: string, workspaceId?: string,
  dependencies: NativeAuthDependencies = nativeAuthDependencies): Promise<AnthropicNativeAuth | undefined> => {
  const resolved = await dependencies.resolveProviderCredential({ providerId: 'anthropic', userId, workspaceId });
  if (resolved.source !== 'none' && resolved.credential?.trim()) {
    return { kind: 'token', credential: resolved.credential, source: resolved.source };
  }
  if (await dependencies.getAnthropicTransportMode() !== 'claude-code') return undefined;
  const account = await dependencies.getPrimaryClaudeCodeAccountTransport({ ownerUserId: userId });
  return account && (account.status === 'active' || account.status === 'cooldown')
    ? { kind: 'account', source: 'claude-code' } : undefined;
};

export interface AnthropicNativePort {
  readonly modelIds: readonly string[];
  available(subject: VerifiedRoutingSubject, workspaceId: string | undefined,
    target: { providerId: string; modelId: string }): Promise<boolean>;
  prepare(subject: VerifiedRoutingSubject, workspaceId: string | undefined,
    target: { providerId: string; modelId: string }): Promise<PreparedNativeMessages | undefined>;
  readonly countTokens: NativeCountTokensPort;
}
export interface AnthropicNativeOptions {
  /** Trusted code/test seam; never an environment model list. */
  readonly modelIds?: readonly string[];
  readonly dependencies?: Partial<NativeAuthDependencies>;
  readonly runtime?: Pick<ClaudeProviderRuntime, 'nativeMessages' | 'nativeCountTokens'>;
}
