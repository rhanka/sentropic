import {
  createDefaultProviderAdapters,
  createLlmMesh,
  createProviderRegistry,
  getSecretAuthMaterial,
  type AuthInput,
  type GenerateRequest,
  type GenerateResponse,
  type LlmMeshMessage,
  type ProviderAdapterClient,
  type ProviderRuntimeContext,
  type ResponseFormat,
  type SecretAuthMaterial,
  type StreamRequest,
  type StreamResult,
  type ToolChoice,
  type ToolDefinition,
} from '@sentropic/llm-mesh';
import type OpenAI from 'openai';

import { providerRegistry } from '../provider-registry';
import type { ProviderId } from '../provider-runtime';
import type { ResolvedProviderCredential } from '../provider-credentials';
import { createId } from '../../utils/id';

type RuntimeRequest = Record<string, unknown> & { mode: string };

type StructuredOutput = {
  name: string;
  schema: Record<string, unknown>;
  description?: string;
  strict?: boolean;
};

type MeshDispatchOptions = {
  providerId: ProviderId;
  model: string;
  credentialResolution: ResolvedProviderCredential;
  authOverride?: AuthInput;
  userId?: string;
  workspaceId?: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  responseFormat?: 'json_object';
  structuredOutput?: StructuredOutput;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  maxOutputTokens?: number;
  signal?: AbortSignal;
  previousResponseId?: string;
  runtimeRequest: RuntimeRequest;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const stringifyContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
};

const toMeshMessages = (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): LlmMeshMessage[] => {
  return messages.map((message) => {
    const record = message as unknown as Record<string, unknown>;
    const rawRole = typeof record.role === 'string' ? record.role : 'user';
    const content = stringifyContent(record.content);

    if (rawRole === 'tool') {
      const toolCallId =
        (typeof record.tool_call_id === 'string' && record.tool_call_id) ||
        (typeof record.name === 'string' && record.name) ||
        'tool';
      return {
        role: 'tool',
        content,
        toolResult: {
          toolCallId,
          output: content,
        },
      };
    }

    const role =
      rawRole === 'system' ||
      rawRole === 'developer' ||
      rawRole === 'assistant' ||
      rawRole === 'user'
        ? rawRole
        : 'user';

    return {
      role,
      content,
    } as LlmMeshMessage;
  });
};

const toMeshTools = (
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): ToolDefinition[] | undefined => {
  const converted = (tools ?? [])
    .filter((tool): tool is OpenAI.Chat.Completions.ChatCompletionFunctionTool => tool.type === 'function')
    .map((tool) => ({
      type: 'function' as const,
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: (tool.function.parameters ?? { type: 'object' }) as Record<string, unknown>,
      strict: false,
    }))
    .filter((tool) => tool.name.trim().length > 0);

  return converted.length > 0 ? converted : undefined;
};

const toMeshToolChoice = (
  toolChoice?: 'auto' | 'required' | 'none',
): ToolChoice | undefined => {
  if (!toolChoice) return undefined;
  return toolChoice;
};

const toMeshResponseFormat = (
  responseFormat?: 'json_object',
  structuredOutput?: StructuredOutput,
): ResponseFormat | undefined => {
  if (structuredOutput) {
    return {
      type: 'json-schema',
      name: structuredOutput.name,
      schema: structuredOutput.schema,
      description: structuredOutput.description,
      strict: structuredOutput.strict,
    };
  }

  if (responseFormat === 'json_object') {
    return { type: 'json-object' };
  }

  return undefined;
};

const getEnvironmentVariableName = (providerId: ProviderId): string => {
  if (providerId === 'openai') return 'OPENAI_API_KEY';
  if (providerId === 'gemini') return 'GEMINI_API_KEY';
  if (providerId === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (providerId === 'mistral') return 'MISTRAL_API_KEY';
  return 'COHERE_API_KEY';
};

const toMeshAuthInput = (
  options: Pick<MeshDispatchOptions, 'providerId' | 'credentialResolution' | 'userId' | 'workspaceId' | 'authOverride'>,
): AuthInput => {
  if (options.authOverride) return options.authOverride;

  const credential = options.credentialResolution.credential ?? undefined;
  if (options.credentialResolution.source === 'request_override' && credential) {
    return { type: 'direct-token', token: credential, label: 'request override' };
  }

  if (options.credentialResolution.source === 'user_byok' && credential && options.userId) {
    return { type: 'user-token', userId: options.userId, token: credential, label: 'user BYOK' };
  }

  if (options.credentialResolution.source === 'workspace_key' && credential && options.workspaceId) {
    return {
      type: 'workspace-token',
      workspaceId: options.workspaceId,
      token: credential,
      label: 'workspace key',
    };
  }

  if (options.credentialResolution.source === 'environment') {
    return {
      type: 'environment-token',
      envVar: getEnvironmentVariableName(options.providerId),
      ...(credential ? { token: credential } : {}),
      label: 'environment',
    };
  }

  return { type: 'none' };
};

const extractCredential = (auth?: AuthInput): string | undefined => {
  const material = getSecretAuthMaterial(auth);
  if (!material) return undefined;
  if (material.type === 'direct-token') return material.token;
  if (material.type === 'user-token' || material.type === 'workspace-token') return material.token;
  if (material.type === 'environment-token') return material.token;
  return undefined;
};

const buildProviderRuntimeRequest = (
  request: GenerateRequest | StreamRequest,
  context?: ProviderRuntimeContext,
): RuntimeRequest => {
  const runtimeRequest = request.providerOptions?.runtimeRequest;
  if (!isRecord(runtimeRequest) || typeof runtimeRequest.mode !== 'string') {
    throw new Error('LLM mesh runtime request is missing providerOptions.runtimeRequest');
  }

  const requestAuth = typeof request.auth === 'function' ? undefined : request.auth;
  const auth = context?.auth ?? requestAuth;
  const credential = extractCredential(auth);
  return {
    ...runtimeRequest,
    ...(credential ? { credential } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  } as RuntimeRequest;
};

class ApplicationProviderMeshClient implements ProviderAdapterClient {
  async generate(
    request: GenerateRequest,
    context?: ProviderRuntimeContext,
  ): Promise<GenerateResponse> {
    const providerId = request.providerId as ProviderId;
    const modelId =
      request.modelId ??
      (typeof request.model === 'string' ? request.model : request.model?.modelId) ??
      '';
    const provider = providerRegistry.requireProvider(providerId);
    const raw = await provider.generate(buildProviderRuntimeRequest(request, context));
    return {
      id: `${providerId}_${createId()}`,
      providerId,
      modelId,
      message: { role: 'assistant', content: '' },
      text: '',
      toolCalls: [],
      finishReason: 'unknown',
      providerMetadata: { raw },
    };
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const providerId = request.providerId as ProviderId;
    const provider = providerRegistry.requireProvider(providerId);
    return await provider.streamGenerate(buildProviderRuntimeRequest(request, context)) as StreamResult;
  }
}

const applicationProviderClient = new ApplicationProviderMeshClient();

const applicationLlmMesh = createLlmMesh({
  registry: createProviderRegistry(
    createDefaultProviderAdapters({
      openai: applicationProviderClient,
      gemini: applicationProviderClient,
      anthropic: applicationProviderClient,
      mistral: applicationProviderClient,
      cohere: applicationProviderClient,
    }),
  ),
});

const toMeshReasoning = (
  options: Pick<MeshDispatchOptions, 'providerId' | 'model' | 'reasoningEffort' | 'reasoningSummary'>,
): StreamRequest['reasoning'] => {
  if (!options.reasoningEffort && !options.reasoningSummary) return undefined;
  if (options.reasoningEffort === 'none' && !options.reasoningSummary) return undefined;

  const profile = applicationLlmMesh
    .listModels()
    .find((model) => model.providerId === options.providerId && model.modelId === options.model);
  if (profile?.capabilities.reasoning.support === 'unsupported') return undefined;

  return {
    effort: options.reasoningEffort,
    summary: options.reasoningSummary,
  };
};

const buildMeshRequest = (options: MeshDispatchOptions): StreamRequest => {
  const auth = toMeshAuthInput(options);
  return {
    providerId: options.providerId,
    modelId: options.model,
    messages: toMeshMessages(options.messages),
    auth,
    tools: toMeshTools(options.tools),
    toolChoice: toMeshToolChoice(options.toolChoice),
    responseFormat: toMeshResponseFormat(options.responseFormat, options.structuredOutput),
    reasoning: toMeshReasoning(options),
    maxOutputTokens: options.maxOutputTokens,
    signal: options.signal,
    previousResponseId: options.previousResponseId,
    metadata: {
      userId: options.userId,
      workspaceId: options.workspaceId,
    },
    providerOptions: {
      runtimeRequest: options.runtimeRequest,
    },
  };
};

export const dispatchMeshGenerateRaw = async <Raw = unknown>(
  options: MeshDispatchOptions,
): Promise<Raw> => {
  const response = await applicationLlmMesh.generate(buildMeshRequest(options));
  return response.providerMetadata?.raw as Raw;
};

export const dispatchMeshStreamRaw = async (
  options: MeshDispatchOptions,
): Promise<AsyncIterable<unknown>> => {
  return await applicationLlmMesh.stream(buildMeshRequest(options)) as AsyncIterable<unknown>;
};

export const createCodexAccountAuthInput = (
  transport: { accessToken: string; accountId?: string | null },
): SecretAuthMaterial => ({
  type: 'codex-account',
  provider: 'codex',
  accessToken: transport.accessToken,
  accountId: transport.accountId ?? null,
});
