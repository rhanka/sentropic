import {
  createDefaultProviderAdapters,
  createLlmMesh,
  createProviderRegistry,
  getSecretAuthMaterial,
  type AuthInput,
  type GenerateRequest,
  type GenerateResponse,
  type LlmMeshMessage,
  type LlmMeshResponseEvent,
  type LlmMeshRequestMetadata,
  type ProviderAdapterClient,
  type ProviderRuntimeContext,
  type ResponseFormat,
  type SecretAuthMaterial,
  type StreamEvent,
  type StreamRequest,
  type StreamResult,
  type ToolChoice,
  type ToolDefinition,
  type MessageContent,
} from '@sentropic/llm-mesh';
import type OpenAI from 'openai';

import { normalizeProviderUsage, recordLlmUsage, toMeshTokenUsage } from '../llm-metering';
import { logger } from '../../logger';
import { providerRegistry } from '../provider-registry';
import type { ProviderId } from '../provider-runtime';
import type { ResolvedProviderCredential } from '../provider-credentials';
import { mintGcpAccessToken } from '../providers/gcp-provider';
import { env } from '../../config/env';
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

const toMeshContent = (value: unknown): MessageContent => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return stringifyContent(value);

  const parts = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const type = typeof item.type === 'string' ? item.type : '';
      if (type === 'text' || type === 'input_text') {
        const text = typeof item.text === 'string' ? item.text : '';
        return text ? { type: 'text' as const, text } : null;
      }
      if (type === 'image_url') {
        const imageUrl = item.image_url;
        const url =
          typeof imageUrl === 'string'
            ? imageUrl
            : isRecord(imageUrl) && typeof imageUrl.url === 'string'
              ? imageUrl.url
              : '';
        return url ? { type: 'image' as const, url } : null;
      }
      if (type === 'input_image') {
        const url = typeof item.image_url === 'string' ? item.image_url : '';
        return url ? { type: 'image' as const, url } : null;
      }
      if (type === 'image') {
        const mediaType = typeof item.mediaType === 'string' ? item.mediaType : undefined;
        const data = typeof item.data === 'string' ? item.data : undefined;
        const url = typeof item.url === 'string' ? item.url : undefined;
        return data || url
          ? { type: 'image' as const, ...(mediaType ? { mediaType } : {}), ...(data ? { data } : {}), ...(url ? { url } : {}) }
          : null;
      }
      if (type === 'file') {
        const mediaType = typeof item.mediaType === 'string' ? item.mediaType : undefined;
        const data = typeof item.data === 'string' ? item.data : undefined;
        const url = typeof item.url === 'string' ? item.url : undefined;
        const filename = typeof item.filename === 'string' ? item.filename : undefined;
        return data || url
          ? { type: 'file' as const, ...(mediaType ? { mediaType } : {}), ...(data ? { data } : {}), ...(url ? { url } : {}), ...(filename ? { filename } : {}) }
          : null;
      }
      return null;
    })
    .filter((part): part is Exclude<MessageContent, string>[number] => part !== null);

  return parts.length > 0 ? parts : stringifyContent(value);
};

const toMeshMessages = (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): LlmMeshMessage[] => {
  return messages.map((message) => {
    const record = message as unknown as Record<string, unknown>;
    const rawRole = typeof record.role === 'string' ? record.role : 'user';
    const content = rawRole === 'tool' ? stringifyContent(record.content) : toMeshContent(record.content);

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
          output: stringifyContent(record.content),
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
  if (providerId === 'cohere') return 'COHERE_API_KEY';
  // GCP auth is ADC-minted, not an API-key env var; this descriptor exists
  // only for symmetry. The bearer is carried as a `direct-token` (see
  // toMeshAuthInput), never read from this env var.
  if (providerId === 'gcp') return 'GCP_ADC';
  // Explicit, safe fallthrough: never silently mis-name an unknown provider's
  // env var as Cohere's (the prior implicit default).
  return `${String(providerId).toUpperCase()}_API_KEY`;
};

const toMeshAuthInput = async (
  options: Pick<MeshDispatchOptions, 'providerId' | 'credentialResolution' | 'userId' | 'workspaceId' | 'authOverride'>,
): Promise<AuthInput> => {
  if (options.authOverride) return options.authOverride;

  const credential = options.credentialResolution.credential ?? undefined;
  if (options.credentialResolution.source === 'request_override' && credential) {
    return { type: 'direct-token', token: credential, label: 'request override' };
  }

  // BR-43 / §B / M2 — GCP auth ordering fix. The mesh validates auth BEFORE
  // the runtime runs (mesh.ts prepare() throws on `!ok` pre-dispatch), and the
  // string credential resolver is BYPASSED for `gcp` (no stored API key —
  // resolveProviderCredential('gcp') legitimately returns source:'none').
  // So the ADC bearer is MINTED HERE, PRE-DISPATCH, and carried as a
  // `direct-token`: this single shape (a) passes adapter.validateAuth
  // (hasText(token)) AND (b) flows through extractCredential's actual-token
  // forward path into GcpProviderRuntime. An envVar-only `environment-token`
  // is explicitly NOT used (it passes validation but forwards no bearer). A
  // request-override bearer already took precedence above. The minted bearer
  // MUST NOT be logged anywhere.
  if (options.providerId === 'gcp') {
    const project = (env.GOOGLE_CLOUD_PROJECT ?? '').trim();
    const location = (env.GOOGLE_CLOUD_LOCATION ?? '').trim();
    if (project && location) {
      const bearer = await mintGcpAccessToken({ project, location });
      return { type: 'direct-token', token: bearer, label: 'gcp adc' };
    }
    // Unconfigured: fall through to `none` so the mesh validateAuth gate
    // surfaces a clear "auth not configured" error rather than minting.
    return { type: 'none' };
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
    // Lot 3 — usage envelope. The app runtime keeps returning the provider `raw` payload to its
    // own callers; surfacing normalized usage here is what lets the mesh `onResponse` hook meter
    // non-stream calls, which previously carried no usage at all.
    const usage = normalizeProviderUsage(raw);
    return {
      id: `${providerId}_${createId()}`,
      providerId,
      modelId,
      message: { role: 'assistant', content: '' },
      text: '',
      toolCalls: [],
      finishReason: 'unknown',
      ...(usage ? { usage } : {}),
      providerMetadata: { raw },
    };
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const providerId = request.providerId as ProviderId;
    const provider = providerRegistry.requireProvider(providerId);
    const stream = await provider.streamGenerate(
      buildProviderRuntimeRequest(request, context),
    ) as StreamResult;

    // Lot 3 — usage envelope. Provider loops report their terminal usage in their own shape
    // (raw for the OpenAI-responses path, already-normalized elsewhere); coerce it once here so
    // the mesh `onResponse` hook always observes the same `TokenUsage`. Events are otherwise
    // forwarded untouched.
    return (async function* (): AsyncGenerator<StreamEvent> {
      for await (const event of stream) {
        if (event.type !== 'done') {
          yield event;
          continue;
        }
        const usage = toMeshTokenUsage(event.data?.usage);
        yield { ...event, data: { ...event.data, ...(usage ? { usage } : {}) } };
      }
    })();
  }
}

const applicationProviderClient = new ApplicationProviderMeshClient();

const METERING_CALL_ID_ATTRIBUTE = 'sentropic.metering.callId';
const METERING_CREDENTIAL_SOURCE_ATTRIBUTE = 'sentropic.metering.credentialSource';

type MeshMeteringMetadata = LlmMeshRequestMetadata & {
  attributes: Record<string, unknown> & {
    [METERING_CALL_ID_ATTRIBUTE]: string;
    [METERING_CREDENTIAL_SOURCE_ATTRIBUTE]: string;
  };
};

const createMeteringMetadata = (options: MeshDispatchOptions): MeshMeteringMetadata => ({
  correlationId: createId(),
  userId: options.userId,
  workspaceId: options.workspaceId,
  attributes: {
    [METERING_CALL_ID_ATTRIBUTE]: createId(),
    [METERING_CREDENTIAL_SOURCE_ATTRIBUTE]: options.credentialResolution.source,
  },
});

const isMeteringMetadata = (metadata: LlmMeshRequestMetadata | undefined): metadata is MeshMeteringMetadata => {
  const attributes = metadata?.attributes;
  return typeof attributes?.[METERING_CALL_ID_ATTRIBUTE] === 'string'
    && typeof attributes[METERING_CREDENTIAL_SOURCE_ATTRIBUTE] === 'string';
};

const recordMeshResponseUsage = async (event: LlmMeshResponseEvent): Promise<void> => {
  if (!isMeteringMetadata(event.metadata)) {
    logger.warn(
      { operation: event.operation, providerId: event.providerId, modelId: event.modelId },
      'LLM metering response was missing dispatch attribution',
    );
    return;
  }

  const { metadata } = event;
  const callId = metadata.attributes[METERING_CALL_ID_ATTRIBUTE];

  try {
    await recordLlmUsage({
      callId,
      operation: event.operation,
      providerId: event.providerId,
      modelId: event.modelId,
      credentialSource: metadata.attributes[METERING_CREDENTIAL_SOURCE_ATTRIBUTE],
      userId: metadata.userId ?? undefined,
      workspaceId: metadata.workspaceId ?? undefined,
      finishReason: event.finishReason,
      responseId: event.responseId,
      usage: event.usage,
    });
  } catch (error) {
    logger.error(
      { err: error, callId, operation: event.operation, providerId: event.providerId, modelId: event.modelId },
      'Failed to record LLM usage observation',
    );
  }
};

const applicationLlmMesh = createLlmMesh({
  registry: createProviderRegistry(
    createDefaultProviderAdapters({
      openai: applicationProviderClient,
      gemini: applicationProviderClient,
      anthropic: applicationProviderClient,
      mistral: applicationProviderClient,
      cohere: applicationProviderClient,
      gcp: applicationProviderClient,
    }),
  ),
  hooks: {
    onResponse: recordMeshResponseUsage,
  },
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

const buildMeshRequest = async (options: MeshDispatchOptions): Promise<StreamRequest> => {
  const auth = await toMeshAuthInput(options);
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
    metadata: createMeteringMetadata(options),
    providerOptions: {
      runtimeRequest: options.runtimeRequest,
    },
  };
};

export const dispatchMeshGenerateRaw = async <Raw = unknown>(
  options: MeshDispatchOptions,
): Promise<Raw> => {
  const response = await applicationLlmMesh.generate(await buildMeshRequest(options));
  return response.providerMetadata?.raw as Raw;
};

export const dispatchMeshStreamRaw = async (
  options: MeshDispatchOptions,
): Promise<AsyncIterable<unknown>> => {
  return await applicationLlmMesh.stream(await buildMeshRequest(options)) as AsyncIterable<unknown>;
};

export const createCodexAccountAuthInput = (
  transport: { accessToken: string; accountId?: string | null; accountLabel?: string | null; stableSessionId?: string | null },
): SecretAuthMaterial => ({
  type: 'account-transport',
  provider: 'codex',
  accessToken: transport.accessToken,
  accountId: transport.accountId ?? null,
  ...(transport.accountLabel ? { accountLabel: transport.accountLabel } : {}),
  descriptor: {
    metadata: {
      transportSessionId: transport.stableSessionId ?? null,
    },
  },
});

export const createClaudeCodeAccountAuthInput = (
  transport: {
    accessToken: string;
    refreshToken?: string | null;
    accountId?: string | null;
    accountLabel?: string | null;
    expiresAt?: string | null;
    stableSessionId?: string | null;
  },
): SecretAuthMaterial => ({
  type: 'account-transport',
  provider: 'claude-code',
  accessToken: transport.accessToken,
  ...(transport.refreshToken ? { refreshToken: transport.refreshToken } : {}),
  accountId: transport.accountId ?? null,
  ...(transport.accountLabel ? { accountLabel: transport.accountLabel } : {}),
  ...(transport.expiresAt ? { expiresAt: transport.expiresAt } : {}),
  descriptor: {
    metadata: {
      transportSessionId: transport.stableSessionId ?? null,
    },
  },
});
