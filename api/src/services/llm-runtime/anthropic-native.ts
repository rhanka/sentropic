import { isNativeMessagesTarget, NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS, validateNativeModelAllowlist, EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS,
  NativeMessagesUpstreamError, modelProfiles, RouteQuoteError, type NativeMessagesRequest,
  type NativeMessagesResult, type PreparedNativeMessages, type VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import type { NativeCountTokensPort } from '@sentropic/llm-gateway';
import { resolveProviderCredential, type ProviderCredentialSource } from '../provider-credentials';
import { getAnthropicTransportMode, resolveConnectedClaudeCodeTransport } from '../provider-connections';
import { getPrimaryClaudeCodeAccountTransport } from '../llm-account-transports';
import { ClaudeProviderRuntime } from '../providers/claude-provider';
import type { ClaudeNativeRequest } from './anthropic-native-http';
import type { NativeBodyProbe } from './anthropic-native-transport';
import { withNativeAccountLease } from './anthropic-native-lease';
import { createNativeObservation } from './anthropic-native-observation';
import type { recordLlmUsage } from '../llm-metering/cost-ledger-sink';

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
  readonly bodyProbe?: NativeBodyProbe;
  readonly record?: typeof recordLlmUsage;
}

const executeNativeForAuth = async (request: NativeMessagesRequest | undefined, context: {
  userId: string; workspaceId?: string; modelId: string; auth: AnthropicNativeAuth;
  dependencies: NativeAuthDependencies; runtime: NonNullable<AnthropicNativeOptions['runtime']>;
  count: boolean; bodyProbe?: NativeBodyProbe; onResponseStarted?: () => void;
}): Promise<NativeMessagesResult> => {
  const { userId, workspaceId, modelId, auth, dependencies, runtime, count, bodyProbe } = context;
  const signal = request!.signal;
  bodyProbe?.('port-request', true);
  let outgoing: ClaudeNativeRequest | undefined;
  let lease: Awaited<ReturnType<NativeAuthDependencies['resolveConnectedClaudeCodeTransport']>> = null;
  let finishing: Promise<void> | undefined;
  const finish = (success: boolean) => finishing ??= Promise.resolve().then(() =>
    lease?.recordOutcome({ status: success ? 'success' : 'failed' })).then(() => undefined, () => undefined);
  try {
    signal.throwIfAborted();
    if (request!.body.model !== modelId || request!.headers.anthropicVersion !== '2023-06-01') {
      throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
    }
    if (auth.kind === 'account') {
      lease = await dependencies.resolveConnectedClaudeCodeTransport(userId, { workspaceId, modelId, requestId: request!.requestId });
      if (!lease) throw new NativeMessagesUpstreamError({ status: 503, code: 'account_unavailable',
        usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
    }
    signal.throwIfAborted();
    outgoing = { ...request!, bodyProbe, onResponseStarted: context.onResponseStarted,
      ...(auth.kind === 'token' ? { credential: auth.credential }
      : { claudeCodeTransport: { accessToken: lease!.accessToken } }) };
    bodyProbe?.('port-outgoing', true);
    request = undefined; bodyProbe?.('port-request', false);
    const pending = count ? runtime.nativeCountTokens(outgoing) : runtime.nativeMessages(outgoing);
    outgoing = undefined; bodyProbe?.('port-outgoing', false);
    const result = await pending;
    return lease ? await withNativeAccountLease(result, signal, finish) : result;
  } catch (error) { await finish(false); throw error; }
  finally {
    if (request) { request = undefined; bodyProbe?.('port-request', false); }
    if (outgoing) { outgoing = undefined; bodyProbe?.('port-outgoing', false); }
  }
};

export const createAnthropicNativePort = (options: AnthropicNativeOptions = {}): AnthropicNativePort => {
  const modelIds = validateNativeModelAllowlist(options.modelIds ?? NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS);
  const dependencies = { ...nativeAuthDependencies, ...options.dependencies };
  const runtime = options.runtime ?? new ClaudeProviderRuntime();
  const bodyProbe = options.bodyProbe;
  const record = options.record;
  const authFor = (subject: VerifiedRoutingSubject, workspaceId: string | undefined) =>
    resolveAnthropicNativeAuth(subject.principalRef, workspaceId, dependencies);
  const prepare: AnthropicNativePort['prepare'] = async (subject, workspaceId, target) => {
    if (!isNativeMessagesTarget(target, modelIds)) return undefined;
    const auth = await authFor(subject, workspaceId);
    if (!auth) return undefined;
    const modelId = target.modelId;
    const observation = createNativeObservation({ userId: subject.principalRef.startsWith('service:') ? undefined : subject.principalRef,
      workspaceId, credentialSource: auth.source }, record);
    return { contractVersion: 1, protocol: 'anthropic-messages', modelId, apiVersions: ['2023-06-01'], requiredBetas: [],
      finalize: observation.finalize,
      execute(request) {
        observation.bind(request.requestId, request.stream);
        return executeNativeForAuth(request, { userId: subject.principalRef, workspaceId, modelId,
          auth, dependencies, runtime, bodyProbe, count: false, onResponseStarted: observation.started });
      },
    };
  };
  return { modelIds, prepare,
    available: async (subject, workspaceId, target) => isNativeMessagesTarget(target, modelIds)
      && !!await authFor(subject, workspaceId),
    countTokens: { modelIds, async prepare(subject, input) {
      input.signal.throwIfAborted();
      if (Object.hasOwn(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, input.modelId)) return undefined;
      if (!modelProfiles.some(model => model.modelId === input.modelId)) throw new RouteQuoteError('Unknown requested model', 'unknown-model');
      if (!isNativeMessagesTarget({ providerId: 'anthropic', modelId: input.modelId }, modelIds)) return undefined;
      const auth = await authFor(subject, input.workspaceId);
      if (!auth) return undefined;
      const { modelId, workspaceId } = input;
      return { providerId: 'anthropic', modelId, apiVersions: ['2023-06-01'],
        execute: request => executeNativeForAuth({ ...request, stream: false }, { userId: subject.principalRef,
          workspaceId, modelId, auth, dependencies, runtime, bodyProbe, count: true }).then(result => {
          if (result.kind !== 'json') throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
          return result;
        }),
      };
    } },
  };
};
