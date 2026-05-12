import { getAuthDescriptor, type AuthDescriptor, type AuthInput, type AuthResolver } from './auth.js';
import type { ModelProfile } from './catalog.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from './generation.js';
import type { FinishReason, StreamEvent, TokenUsage } from './streaming.js';
import type { ProviderAdapter, ProviderRegistry } from './registry.js';
import { isProviderId, type ModelReference, type ProviderId } from './providers.js';

export interface LlmMeshHooks {
  onRequest?(event: LlmMeshRequestEvent): void | Promise<void>;
  onResponse?(event: LlmMeshResponseEvent): void | Promise<void>;
  onError?(event: LlmMeshErrorEvent): void | Promise<void>;
}

export interface LlmMeshRequestEvent {
  operation: 'generate' | 'stream';
  providerId: ProviderId;
  modelId: string;
  auth?: AuthDescriptor;
}

export interface LlmMeshResponseEvent extends LlmMeshRequestEvent {
  finishReason?: FinishReason;
  responseId?: string;
  usage?: TokenUsage;
}

export interface LlmMeshErrorEvent extends LlmMeshRequestEvent {
  error: unknown;
}

export interface CreateLlmMeshOptions {
  registry: ProviderRegistry;
  authResolver?: AuthResolver;
  hooks?: LlmMeshHooks;
}

export interface LlmMesh {
  listProviders: ProviderRegistry['listProviders'];
  listModels: ProviderRegistry['listModels'];
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: StreamRequest): Promise<StreamResult>;
}

const selectModel = (
  request: GenerateRequest | StreamRequest,
  registry: ProviderRegistry,
): { providerId: ProviderId; modelId: string; profile: ModelProfile } => {
  const alias = typeof request.model === 'string' ? request.model.split(':', 2) : null;
  const ref = request.model && typeof request.model === 'object' ? request.model as ModelReference : null;
  const providerId = ref?.providerId ?? request.providerId ?? (alias && isProviderId(alias[0]) ? alias[0] : undefined);
  const modelId = ref?.modelId ?? request.modelId ?? alias?.[1];
  if (!providerId || !modelId) throw new Error('A provider/model selection is required');
  const profile = registry.listModels().find((model) => model.providerId === providerId && model.modelId === modelId);
  if (!profile) throw new Error(`Model not found: ${providerId}:${modelId}`);
  return { providerId, modelId, profile };
};

const validateFeatures = (
  operation: 'generate' | 'stream',
  request: GenerateRequest | StreamRequest,
  profile: ModelProfile,
): void => {
  if (operation === 'stream' && profile.capabilities.streaming.support === 'unsupported') {
    throw new Error(`Streaming is unsupported for ${profile.providerId}:${profile.modelId}`);
  }
  if ((request.tools?.length || request.toolChoice === 'required') && profile.capabilities.tools.support === 'unsupported') {
    throw new Error(`Tool use is unsupported for ${profile.providerId}:${profile.modelId}`);
  }
  if (request.responseFormat && request.responseFormat.type !== 'text' && profile.capabilities.structuredOutput.support === 'unsupported') {
    throw new Error(`Structured output is unsupported for ${profile.providerId}:${profile.modelId}`);
  }
  if (request.reasoning && request.reasoning.effort !== 'none' && profile.capabilities.reasoning.support === 'unsupported') {
    throw new Error(`Reasoning is unsupported for ${profile.providerId}:${profile.modelId}`);
  }
};

const resolveAuth = async (
  request: GenerateRequest | StreamRequest,
  selection: { providerId: ProviderId; modelId: string },
  authResolver?: AuthResolver,
): Promise<AuthInput | undefined> => {
  if (request.auth && typeof request.auth !== 'function') return request.auth;
  const resolver = typeof request.auth === 'function' ? request.auth : authResolver;
  return resolver?.({
    providerId: selection.providerId,
    modelId: selection.modelId,
    userId: request.metadata?.userId,
    workspaceId: request.metadata?.workspaceId,
    metadata: request.metadata?.attributes,
  });
};

const normalizeRequest = <T extends GenerateRequest | StreamRequest>(
  request: T,
  selection: { providerId: ProviderId; modelId: string },
  auth?: AuthInput,
): T => {
  const { model: _model, auth: _requestAuth, ...rest } = request;
  return {
    ...rest,
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(auth ? { auth } : {}),
  } as T;
};

export const createLlmMesh = ({ registry, authResolver, hooks }: CreateLlmMeshOptions): LlmMesh => {
  const emit = async (event: LlmMeshRequestEvent | LlmMeshResponseEvent | LlmMeshErrorEvent, type: keyof LlmMeshHooks) => {
    await hooks?.[type]?.(event as never);
  };

  const prepare = async (operation: 'generate' | 'stream', request: GenerateRequest | StreamRequest) => {
    const selection = selectModel(request, registry);
    validateFeatures(operation, request, selection.profile);
    const auth = await resolveAuth(request, selection, authResolver);
    const adapter = registry.requireProvider(selection.providerId);
    const validation = adapter.validateAuth(auth);
    if (!validation.ok) throw new Error(validation.message ?? 'Provider auth source is not configured');
    const eventBase = {
      operation,
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(auth ? { auth: getAuthDescriptor(auth) } : {}),
    };
    await emit(eventBase, 'onRequest');
    return { adapter, auth, eventBase, request: normalizeRequest(request, selection, auth) };
  };

  return {
    listProviders: () => registry.listProviders(),
    listModels: () => registry.listModels(),
    async generate(request) {
      const prepared = await prepare('generate', request);
      try {
        const response = await prepared.adapter.generate(prepared.request, { auth: prepared.auth });
        await emit({ ...prepared.eventBase, finishReason: response.finishReason, responseId: response.id, usage: response.usage }, 'onResponse');
        return response;
      } catch (error) {
        await emit({ ...prepared.eventBase, error }, 'onError');
        throw error;
      }
    },
    async stream(request) {
      const prepared = await prepare('stream', request);
      try {
        const stream = await prepared.adapter.stream(prepared.request, { auth: prepared.auth });
        return (async function* (): AsyncGenerator<StreamEvent> {
          for await (const event of stream) {
            if (event.type === 'done') {
              await emit({ ...prepared.eventBase, finishReason: event.data.finishReason, responseId: event.data.responseId, usage: event.data.usage }, 'onResponse');
            } else if (event.type === 'error') {
              await emit({ ...prepared.eventBase, error: event.data }, 'onError');
            }
            yield event;
          }
        })();
      } catch (error) {
        await emit({ ...prepared.eventBase, error }, 'onError');
        throw error;
      }
    },
  };
};
