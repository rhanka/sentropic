import OpenAI from 'openai';
import { providerRegistry } from './provider-registry';
import { inferProviderFromModelId, resolveDefaultSelection } from './model-catalog';
import {
  resolveProviderCredential,
  type ResolvedProviderCredential
} from './provider-credentials';
import {
  GeminiProviderRuntime,
  type GeminiGenerateRequest,
  type GeminiStreamGenerateRequest
} from './providers/gemini-provider';
import {
  OpenAIProviderRuntime,
  type OpenAIGenerateRequest,
  type OpenAIStreamGenerateRequest
} from './providers/openai-provider';
import { isProviderId, type ProviderId } from './provider-runtime';
import { settingsService } from './settings';
import { createId } from '../utils/id';

const getOpenAIProvider = (): OpenAIProviderRuntime => {
  return providerRegistry.requireProvider('openai') as OpenAIProviderRuntime;
};

const getGeminiProvider = (): GeminiProviderRuntime => {
  return providerRegistry.requireProvider('gemini') as GeminiProviderRuntime;
};

const pickProviderCapabilities = (providerId: ProviderId) =>
  providerRegistry.requireProvider(providerId).provider.capabilities;

type RuntimeSelection = {
  providerId: ProviderId;
  model: string;
};

const resolveRuntimeSelection = async (input: {
  providerId?: string | null;
  model?: string | null;
  userId?: string | null;
}): Promise<RuntimeSelection> => {
  const [aiSettings, models] = await Promise.all([
    settingsService.getAISettings({ userId: input.userId ?? null }),
    Promise.resolve(providerRegistry.listModels()),
  ]);

  const requestedModel = (input.model ?? '').trim() || aiSettings.defaultModel;
  const inferredProvider = inferProviderFromModelId(
    models.map((entry) => ({
      provider_id: entry.providerId,
      model_id: entry.modelId,
      label: entry.label,
      reasoning_tier: entry.reasoningTier,
      supports_tools: entry.supportsTools,
      supports_streaming: entry.supportsStreaming,
      default_contexts: entry.defaultContexts,
    })),
    requestedModel
  );

  const requestedProvider = isProviderId(input.providerId ?? '')
    ? (input.providerId as ProviderId)
    : inferredProvider || (isProviderId(aiSettings.defaultProviderId) ? (aiSettings.defaultProviderId as ProviderId) : 'openai');

  const resolved = resolveDefaultSelection(
    {
      providerId: requestedProvider,
      modelId: requestedModel || aiSettings.defaultModel,
    },
    models.map((entry) => ({
      provider_id: entry.providerId,
      model_id: entry.modelId,
      label: entry.label,
      reasoning_tier: entry.reasoningTier,
      supports_tools: entry.supportsTools,
      supports_streaming: entry.supportsStreaming,
      default_contexts: entry.defaultContexts,
    }))
  );

  return {
    providerId: resolved.provider_id,
    model: resolved.model_id,
  };
};

const buildCredentialResolutionContext = (options: {
  providerId: ProviderId;
  credential?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
}): Promise<ResolvedProviderCredential> => {
  return resolveProviderCredential({
    providerId: options.providerId,
    requestCredential: options.credential,
    userId: options.userId,
    workspaceId: options.workspaceId,
  });
};

export interface CallOpenAIOptions {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  providerId?: ProviderId;
  model?: string;
  credential?: string;
  userId?: string;
  workspaceId?: string;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  responseFormat?: 'json_object';
  /**
   * Chat Completions: max output tokens for the assistant message.
   * If not set, OpenAI may use a small default which can truncate long outputs.
   */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface CallOpenAIResponseOptions {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  providerId?: ProviderId;
  model?: string;
  credential?: string;
  userId?: string;
  workspaceId?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /**
   * Responses API: permet de "continuer" une réponse précédente (tool call -> tool output -> continuation).
   * Si fourni, `rawInput` doit contenir uniquement les items additionnels (ex: function_call_output).
   */
  previousResponseId?: string;
  /**
   * Overrides `messages` conversion for Responses API. Use to send tool outputs properly:
   * [{ type:'function_call_output', call_id:'...', output:'...' }, ...]
   */
  rawInput?: unknown[];
  // Shorthand (mode JSON "legacy") — utile pour conserver l'API existante
  responseFormat?: 'json_object';
  // Structured Outputs (préféré): JSON Schema strict (subset) supporté par OpenAI
  structuredOutput?: {
    name: string;
    schema: Record<string, unknown>;
    description?: string;
    strict?: boolean;
  };
  toolChoice?: 'auto' | 'required' | 'none'; // laissé pour compat mais on n'impose rien (auto)
  /**
   * Responses API: max output tokens for the assistant output.
   * If not set, OpenAI may use a small default which can truncate long outputs.
   */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Types d'événements de streaming normalisés
 */
export type StreamEventType = 
  | 'reasoning_delta' 
  | 'content_delta' 
  | 'tool_call_start' 
  | 'tool_call_delta' 
  | 'tool_call_result' 
  | 'status' 
  | 'error' 
  | 'done';

export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

type GeminiRequestBuildOptions = {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  responseFormat?: 'json_object';
  structuredOutput?: {
    name: string;
    schema: Record<string, unknown>;
    description?: string;
    strict?: boolean;
  };
  maxOutputTokens?: number;
  rawInput?: unknown[];
};

const stringifyContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
};

const isFunctionTool = (
  tool: OpenAI.Chat.Completions.ChatCompletionTool
): tool is OpenAI.Chat.Completions.ChatCompletionFunctionTool => {
  return tool.type === 'function';
};

const toGeminiToolDeclarations = (
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | 'none'
): Array<Record<string, unknown>> => {
  if (!tools || tools.length === 0 || toolChoice === 'none') return [];

  return tools
    .filter(isFunctionTool)
    .filter((tool) => Boolean(tool.function?.name))
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function?.description,
      parameters: tool.function?.parameters ?? { type: 'object', properties: {} },
    }))
    .filter((tool) => typeof tool.name === 'string' && tool.name.length > 0);
};

const GEMINI_UNSUPPORTED_RESPONSE_SCHEMA_KEYS = new Set<string>([
  'additionalProperties',
  'unevaluatedProperties',
  'patternProperties',
  'propertyNames',
  'contains',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  '$schema',
  '$id',
  '$anchor',
  '$comment',
]);

const sanitizeGeminiResponseSchemaNode = (
  value: unknown,
  insideMap = false
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeGeminiResponseSchemaNode(entry, false));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(record)) {
    if (!insideMap && GEMINI_UNSUPPORTED_RESPONSE_SCHEMA_KEYS.has(key)) {
      continue;
    }
    // Gemini responseSchema currently rejects non-string enum values.
    // Keep string enums, drop numeric/mixed enums in provider-compiled schema.
    if (key === 'enum') {
      if (!Array.isArray(child)) continue;
      const stringEnum = child.filter((entry) => typeof entry === 'string');
      if (stringEnum.length === child.length && stringEnum.length > 0) {
        out[key] = stringEnum;
      }
      continue;
    }
    const nextInsideMap =
      key === 'properties' || key === '$defs' || key === 'definitions';
    out[key] = sanitizeGeminiResponseSchemaNode(child, nextInsideMap);
  }
  return out;
};

export const sanitizeGeminiResponseSchema = (
  schema: Record<string, unknown>
): Record<string, unknown> => {
  return sanitizeGeminiResponseSchemaNode(schema, false) as Record<string, unknown>;
};

const buildGeminiRequestBody = (
  options: GeminiRequestBuildOptions
): Record<string, unknown> => {
  const systemParts: string[] = [];
  const contents: Array<Record<string, unknown>> = [];

  for (const message of options.messages) {
    const role = message.role;
    const content = stringifyContent(
      (message as unknown as { content?: unknown }).content
    );

    if (role === 'system' || role === 'developer') {
      if (content.trim()) systemParts.push(content);
      continue;
    }

    if (role === 'tool') {
      const toolCallId = typeof (message as { tool_call_id?: string }).tool_call_id === 'string'
        ? (message as { tool_call_id?: string }).tool_call_id
        : 'tool_call';
      contents.push({
        role: 'user',
        parts: [{ text: `Tool output (${toolCallId}): ${content}` }],
      });
      continue;
    }

    contents.push({
      role: role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    });
  }

  if (Array.isArray(options.rawInput) && options.rawInput.length > 0) {
    for (const item of options.rawInput) {
      const record = item as Record<string, unknown>;
      const type = typeof record?.type === 'string' ? record.type : '';
      if (type !== 'function_call_output') continue;
      const callId = typeof record.call_id === 'string' ? record.call_id : '';
      const output = stringifyContent(record.output);
      contents.push({
        role: 'user',
        parts: [
          {
            text: callId
              ? `Tool output (${callId}): ${output}`
              : `Tool output: ${output}`,
          },
        ],
      });
    }
  }

  const generationConfig: Record<string, unknown> = {};
  if (
    typeof options.maxOutputTokens === 'number' &&
    Number.isFinite(options.maxOutputTokens) &&
    options.maxOutputTokens > 0
  ) {
    generationConfig.maxOutputTokens = Math.floor(options.maxOutputTokens);
  }
  if (options.responseFormat === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }
  if (options.structuredOutput) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = sanitizeGeminiResponseSchema(
      options.structuredOutput.schema
    );
  }

  const functionDeclarations = toGeminiToolDeclarations(
    options.tools,
    options.toolChoice
  );
  const body: Record<string, unknown> = {
    contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }],
    ...(systemParts.length > 0
      ? {
          systemInstruction: {
            parts: [{ text: systemParts.join('\n\n') }],
          },
        }
      : {}),
    ...(functionDeclarations.length > 0
      ? {
          tools: [{ functionDeclarations }],
          toolConfig:
            options.toolChoice === 'required'
              ? {
                  functionCallingConfig: { mode: 'ANY' },
                }
              : undefined,
        }
      : {}),
    ...(Object.keys(generationConfig).length > 0
      ? { generationConfig }
      : {}),
  };

  if (!body.toolConfig) {
    delete body.toolConfig;
  }

  return body;
};

const extractGeminiText = (payload: unknown): string => {
  const record = payload as Record<string, unknown> | null;
  if (!record) return '';
  const candidates = Array.isArray(record.candidates)
    ? (record.candidates as Array<Record<string, unknown>>)
    : [];
  const first = candidates[0];
  if (!first || typeof first !== 'object') return '';
  const content = first.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts)
    ? (content?.parts as Array<Record<string, unknown>>)
    : [];
  const texts = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter((value) => value.length > 0);
  return texts.join('');
};

const normalizeGeminiToolArgs = (
  args: unknown
): string => {
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '{}';
  }
};

/**
 * Méthode unique pour tous les appels OpenAI (non-streaming)
 */
export const callOpenAI = async (options: CallOpenAIOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
  const {
    messages,
    providerId,
    model,
    credential,
    userId,
    workspaceId,
    tools,
    toolChoice = 'auto',
    responseFormat,
    maxOutputTokens,
    signal
  } = options;

  const selection = await resolveRuntimeSelection({
    providerId,
    model,
    userId,
  });
  const credentialResolution = await buildCredentialResolutionContext({
    providerId: selection.providerId,
    credential,
    userId,
    workspaceId,
  });
  const capabilities = pickProviderCapabilities(selection.providerId);
  const filteredTools =
    capabilities.supportsTools && toolChoice !== 'none' ? tools : undefined;
  const normalizedToolChoice =
    !capabilities.supportsTools && toolChoice !== 'none' ? 'none' : toolChoice;

  if (!capabilities.supportsStreaming) {
    throw new Error(`Provider ${selection.providerId} does not support streaming`);
  }

  if (selection.providerId === 'gemini') {
    const provider = getGeminiProvider();
    const raw = await provider.generate({
      mode: 'generate-content',
      requestOptions: {
        model: selection.model,
        body: buildGeminiRequestBody({
          messages,
          tools: filteredTools,
          toolChoice: normalizedToolChoice,
          responseFormat,
          maxOutputTokens,
        }),
      },
      credential: credentialResolution.credential ?? undefined,
      signal,
    } satisfies GeminiGenerateRequest);

    const text = extractGeminiText(raw);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: `gemini_${createId()}`,
      object: 'chat.completion',
      created: nowSeconds,
      model: selection.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: text,
            refusal: null,
          },
          logprobs: null,
        },
      ],
      usage: null,
    } as unknown as OpenAI.Chat.Completions.ChatCompletion;
  }

  const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model: selection.model,
    messages,
    ...(filteredTools && { tools: filteredTools }),
    ...(normalizedToolChoice !== 'auto' && { tool_choice: normalizedToolChoice }),
    ...(responseFormat && { response_format: { type: responseFormat } }),
    ...(typeof maxOutputTokens === 'number' &&
    Number.isFinite(maxOutputTokens) &&
    maxOutputTokens > 0
      ? { max_tokens: Math.floor(maxOutputTokens) }
      : {}),
  };

  // Pass AbortSignal through request options to enable cooperative cancellation
  const provider = getOpenAIProvider();
  return await provider.generate({
    mode: 'chat-completions',
    requestOptions,
    credential: credentialResolution.credential ?? undefined,
    signal
  } satisfies OpenAIGenerateRequest) as OpenAI.Chat.Completions.ChatCompletion;
};

/**
 * Méthode pour les appels OpenAI en streaming
 * Retourne un AsyncIterable de StreamEvent normalisés
 */
export async function* callOpenAIStream(
  options: CallOpenAIOptions
): AsyncGenerator<StreamEvent, void, unknown> {
  const {
    messages,
    providerId,
    model,
    credential,
    userId,
    workspaceId,
    tools,
    toolChoice = 'auto',
    responseFormat,
    maxOutputTokens,
    signal
  } = options;

  const selection = await resolveRuntimeSelection({
    providerId,
    model,
    userId,
  });
  const credentialResolution = await buildCredentialResolutionContext({
    providerId: selection.providerId,
    credential,
    userId,
    workspaceId,
  });
  const capabilities = pickProviderCapabilities(selection.providerId);
  const filteredTools =
    capabilities.supportsTools && toolChoice !== 'none' ? tools : undefined;
  const normalizedToolChoice =
    !capabilities.supportsTools && toolChoice !== 'none' ? 'none' : toolChoice;

  if (selection.providerId === 'gemini') {
    try {
      yield { type: 'status', data: { state: 'started' } };
      const provider = getGeminiProvider();
      const stream = await provider.streamGenerate({
        mode: 'stream-generate-content',
        requestOptions: {
          model: selection.model,
          body: buildGeminiRequestBody({
            messages,
            tools: filteredTools,
            toolChoice: normalizedToolChoice,
            responseFormat,
            maxOutputTokens,
          }),
        },
        credential: credentialResolution.credential ?? undefined,
        signal,
      } satisfies GeminiStreamGenerateRequest);

      let toolCallIndex = 0;
      for await (const chunk of stream) {
        const record = chunk as Record<string, unknown>;
        const candidates = Array.isArray(record.candidates)
          ? (record.candidates as Array<Record<string, unknown>>)
          : [];
        const first = candidates[0];
        if (!first) continue;
        const content = first.content as Record<string, unknown> | undefined;
        const parts = Array.isArray(content?.parts)
          ? (content?.parts as Array<Record<string, unknown>>)
          : [];
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text) {
            yield { type: 'content_delta', data: { delta: part.text } };
          }
          const functionCall = part.functionCall as Record<string, unknown> | undefined;
          if (functionCall && typeof functionCall.name === 'string') {
            toolCallIndex += 1;
            const toolCallId = `gemini_call_${toolCallIndex}`;
            yield {
              type: 'tool_call_start',
              data: {
                tool_call_id: toolCallId,
                name: functionCall.name,
                args: normalizeGeminiToolArgs(functionCall.args),
              },
            };
          }
        }
      }
      yield { type: 'done', data: {} };
      return;
    } catch (error) {
      const normalized = getGeminiProvider().normalizeError(error);
      yield {
        type: 'error',
        data: {
          message: normalized.message,
          ...(normalized.code ? { code: normalized.code } : {}),
        },
      };
      throw error;
    }
  }

  const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: selection.model,
    messages,
    stream: true,
    ...(filteredTools && { tools: filteredTools }),
    ...(normalizedToolChoice !== 'auto' && { tool_choice: normalizedToolChoice }),
    ...(responseFormat && { response_format: { type: responseFormat } }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? { max_tokens: Math.floor(maxOutputTokens) }
      : {})
  };

  // État pour tracker les tool calls en cours
  const toolCallsInProgress = new Map<string, {
    id: string;
    name: string;
    args: string;
  }>();

  try {
    // Envoyer un événement status 'started'
    yield { type: 'status', data: { state: 'started' } };

    const provider = getOpenAIProvider();
    const stream = await provider.streamGenerate({
      mode: 'chat-completions',
      requestOptions,
      credential: credentialResolution.credential ?? undefined,
      signal
    } satisfies OpenAIStreamGenerateRequest) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    for await (const chunk of stream) {
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Stream aborted' } };
        return;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Gérer le reasoning (pour modèles comme o1, o3, gpt-5)
      // Le reasoning peut être dans delta.reasoning ou dans un champ spécifique
      // Vérifier si le chunk contient des informations de reasoning
      // Note: La structure exacte dépend de la version de l'API OpenAI
      const reasoning = (delta as unknown as { reasoning?: unknown }).reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        yield {
          type: 'reasoning_delta',
          data: { delta: reasoning }
        };
      }

      // Gérer le contenu (content)
      if (delta.content) {
        yield {
          type: 'content_delta',
          data: { delta: delta.content }
        };
      }

      // Gérer les tool calls
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const toolCallId = toolCallDelta.id;
          const toolCallIndex = toolCallDelta.index;

          // Utiliser index comme clé si id n'est pas encore disponible
          const trackingKey = toolCallId || `index_${toolCallIndex}`;

          // Nouveau tool call : index est défini et on n'a pas encore vu ce tool call
          if (toolCallIndex !== undefined && !toolCallsInProgress.has(trackingKey)) {
            const toolCallData = {
              id: toolCallId || '',
              name: toolCallDelta.function?.name || '',
              args: toolCallDelta.function?.arguments || ''
            };
            
            toolCallsInProgress.set(trackingKey, toolCallData);

            // Si on a maintenant un id, mettre à jour la clé
            if (toolCallId && trackingKey !== toolCallId) {
              toolCallsInProgress.delete(trackingKey);
              toolCallsInProgress.set(toolCallId, toolCallData);
            }

            yield {
              type: 'tool_call_start',
              data: {
                tool_call_id: toolCallId || trackingKey,
                name: toolCallDelta.function?.name || '',
                args: toolCallDelta.function?.arguments || ''
              }
            };
          }

          // Delta d'arguments pour un tool call existant
          if (toolCallDelta.function?.arguments) {
            const existing = toolCallsInProgress.get(toolCallId || trackingKey);
            if (existing) {
              existing.args += toolCallDelta.function.arguments;
              
              yield {
                type: 'tool_call_delta',
                data: {
                  tool_call_id: toolCallId || trackingKey,
                  delta: toolCallDelta.function.arguments
                }
              };
            }
          }

          // Mettre à jour le name si présent
          if (toolCallDelta.function?.name) {
            const existing = toolCallsInProgress.get(toolCallId || trackingKey);
            if (existing && !existing.name) {
              existing.name = toolCallDelta.function.name;
            }
          }
        }
      }

      // Fin du stream (finish_reason indique la fin)
      if (choice.finish_reason) {
        // Nettoyer les tool calls en cours
        toolCallsInProgress.clear();
        
        yield { type: 'done', data: {} };
        return;
      }
    }
  } catch (error) {
    const normalized = getOpenAIProvider().normalizeError(error);
    yield {
      type: 'error',
      data: {
        message: normalized.message,
        ...(normalized.code ? { code: normalized.code } : {})
      }
    };
    throw error;
  }
}

/**
 * Streaming via Responses API (support reasoning, modèle unique)
 * - N'injecte pas de reasoning.effort par défaut (on ne le spécifie que si demandé)
 */
export async function* callOpenAIResponseStream(
  options: CallOpenAIResponseOptions
): AsyncGenerator<StreamEvent, void, unknown> {
  const {
    messages,
    providerId,
    model,
    credential,
    userId,
    workspaceId,
    reasoningEffort,
    reasoningSummary,
    tools,
    responseFormat,
    structuredOutput,
    maxOutputTokens,
    signal,
    previousResponseId,
    rawInput
  } = options;

  const selection = await resolveRuntimeSelection({
    providerId,
    model,
    userId,
  });
  const credentialResolution = await buildCredentialResolutionContext({
    providerId: selection.providerId,
    credential,
    userId,
    workspaceId,
  });
  const capabilities = pickProviderCapabilities(selection.providerId);
  const filteredTools =
    capabilities.supportsTools && options.toolChoice !== 'none' ? tools : undefined;
  const normalizedToolChoice =
    !capabilities.supportsTools && options.toolChoice !== 'none'
      ? 'none'
      : options.toolChoice;
  const selectedModel = selection.model;

  if (!capabilities.supportsStreaming) {
    throw new Error(`Provider ${selection.providerId} does not support streaming`);
  }

  if (selection.providerId === 'gemini') {
    const provider = getGeminiProvider();
    const responseId = previousResponseId || `gemini_${createId()}`;
    const requestBody = buildGeminiRequestBody({
      messages,
      tools: filteredTools,
      toolChoice: normalizedToolChoice,
      responseFormat,
      structuredOutput,
      maxOutputTokens,
      rawInput,
    });

    try {
      yield { type: 'status', data: { state: 'started' } };
      yield {
        type: 'status',
        data: { state: 'response_created', response_id: responseId },
      };

      const stream = await provider.streamGenerate({
        mode: 'stream-generate-content',
        requestOptions: {
          model: selectedModel,
          body: requestBody,
        },
        credential: credentialResolution.credential ?? undefined,
        signal,
      } satisfies GeminiStreamGenerateRequest);

      let toolCallIndex = 0;
      let emittedContent = false;
      for await (const chunk of stream) {
        if (signal?.aborted) {
          yield { type: 'error', data: { message: 'Stream aborted' } };
          return;
        }

        const record = chunk as Record<string, unknown>;
        const candidates = Array.isArray(record.candidates)
          ? (record.candidates as Array<Record<string, unknown>>)
          : [];
        const first = candidates[0];
        if (!first) continue;
        const content = first.content as Record<string, unknown> | undefined;
        const parts = Array.isArray(content?.parts)
          ? (content?.parts as Array<Record<string, unknown>>)
          : [];

        for (const part of parts) {
          if (typeof part.text === 'string' && part.text) {
            emittedContent = true;
            yield {
              type: 'content_delta',
              data: { delta: part.text },
            };
          }

          const functionCall = part.functionCall as Record<string, unknown> | undefined;
          if (functionCall && typeof functionCall.name === 'string') {
            toolCallIndex += 1;
            const toolCallId = `gemini_call_${toolCallIndex}`;
            yield {
              type: 'tool_call_start',
              data: {
                tool_call_id: toolCallId,
                name: functionCall.name,
                args: normalizeGeminiToolArgs(functionCall.args),
              },
            };
          }
        }

        const finishReason =
          typeof first.finishReason === 'string' ? first.finishReason : '';
        if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          break;
        }
      }

      if (!emittedContent && filteredTools && filteredTools.length > 0) {
        yield {
          type: 'status',
          data: {
            state: 'provider_completed_without_content',
            provider_id: 'gemini',
          },
        };
      }
      yield { type: 'done', data: {} };
      return;
    } catch (error) {
      const normalized = provider.normalizeError(error);
      yield {
        type: 'error',
        data: {
          message: normalized.message,
          ...(normalized.code ? { code: normalized.code } : {}),
        },
      };
      throw error;
    }
  }

  // Certains modèles (ex: gpt-4.1-nano-*) ne supportent pas `reasoning.summary`.
  // On désactive complètement `reasoning` pour ces familles afin d'éviter un 400.
  const supportsReasoningParams = !selectedModel.startsWith('gpt-4.1');

  const mapReasoningEffort = (effort: CallOpenAIResponseOptions['reasoningEffort']): unknown => {
    if (!effort) return undefined;
    // OpenAI supports (notably for gpt-5-nano): minimal|low|medium|high.
    // App-level accepts: none|low|medium|high|xhigh.
    // Map to avoid 400s:
    // - none  -> minimal (ONLY for gpt-5-nano; gpt-5.2 appears to accept "none")
    // - xhigh -> high
    // - low/medium/high passthrough
    if (effort === 'none') return selectedModel.startsWith('gpt-5-nano') ? 'minimal' : 'none';
    if (effort === 'xhigh') return 'high';
    return effort;
  };

  // Convertir les messages chat en format input du Responses API
  // IMPORTANT:
  // - Le SDK définit `EasyInputMessage` (role user|assistant|system|developer) avec `content` string.
  // - Si on envoie `role:"assistant"` avec des content parts `type:"input_text"`, l'API renvoie:
  //   "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'."
  // => On utilise donc `content` en string pour tous les rôles.
  const input: OpenAI.Responses.ResponseCreateParamsStreaming['input'] = (rawInput && rawInput.length > 0)
    ? (rawInput as OpenAI.Responses.ResponseCreateParamsStreaming['input'])
    : messages.map((m) => {
        const role = (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system' | 'developer';
        const contentRaw = (m as unknown as { content?: unknown }).content;
        const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw ?? '');
        return { type: 'message', role, content };
      });

  // Mapper les tools "Chat Completions" -> "Responses" (format plat)
  const responseTools: OpenAI.Responses.ResponseCreateParamsStreaming['tools'] | undefined = filteredTools
    ? (filteredTools
        .filter((t) => t.type === 'function')
        .map((t) => ({
          type: 'function' as const,
          name: t.function?.name || '',
          description: t.function?.description,
          parameters: t.function?.parameters ?? null,
          // IMPORTANT: en mode strict, OpenAI exige un sous-ensemble JSON Schema (ex: additionalProperties:false).
          // Pour éviter de "sur-valider" nos tools (web_search/web_extract) à ce stade, on désactive strict.
          strict: false
        }))
        .filter((t) => !!t.name) as unknown as OpenAI.Responses.ResponseCreateParamsStreaming['tools'])
    : undefined;

  // Structured output via Responses API: text.format
  const textConfig: OpenAI.Responses.ResponseCreateParamsStreaming['text'] | undefined =
    structuredOutput
      ? {
          format: {
            type: 'json_schema',
            name: structuredOutput.name,
            schema: structuredOutput.schema,
            description: structuredOutput.description,
            strict: structuredOutput.strict ?? true
          }
        }
      : responseFormat
        ? { format: { type: responseFormat } }
        : undefined;

  // Reasoning (Responses API):
  // - Ne pas injecter `reasoning` par défaut.
  // - N'envoyer `reasoning.summary`/`reasoning.effort` que si explicitement demandé par l'appelant.
  const reasoning: OpenAI.Responses.ResponseCreateParamsStreaming['reasoning'] | undefined = (() => {
    if (!supportsReasoningParams) return undefined;
    if (!reasoningSummary && !reasoningEffort) return undefined;
    const mappedEffort = mapReasoningEffort(reasoningEffort);
    return {
      ...(reasoningSummary ? { summary: reasoningSummary } : {}),
      ...(mappedEffort ? { effort: mappedEffort } : {})
    } as OpenAI.Responses.ResponseCreateParamsStreaming['reasoning'];
  })();

  const requestOptions: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model: selectedModel,
    stream: true,
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(responseTools ? { tools: responseTools } : {}),
    ...(textConfig ? { text: textConfig } : {}),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? { max_output_tokens: Math.floor(maxOutputTokens) }
      : {})
  };

  try {
    yield { type: 'status', data: { state: 'started' } };

    const provider = getOpenAIProvider();
    const stream = await provider.streamGenerate({
      mode: 'responses',
      requestOptions,
      credential: credentialResolution.credential ?? undefined,
      signal
    } satisfies OpenAIStreamGenerateRequest) as AsyncIterable<unknown>;

    // Some streams can emit only `output_text.done` without `output_text.delta`.
    // Track whether we've seen any output_text.delta so we can avoid duplicating the full text on .done.
    let sawOutputTextDelta = false;

    // Suivre les tool calls par item_id (Responses API)
    const toolCallState = new Map<string, { started: boolean; sawDelta: boolean; name?: string }>();
    // Responses API: `function_call_output` doit cibler `call_id` (souvent "call_..."), pas forcément `item.id`.
    // On maintient un mapping item_id -> public_tool_call_id (call_id si disponible).
    const itemIdToCallId = new Map<string, string>();

    for await (const chunk of stream) {
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Stream aborted' } };
        return;
      }

      const record = chunk as unknown as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;
      if (!type) continue;

      // IMPORTANT:
      // - Ne jamais traiter `chunk.delta` comme du texte final sans vérifier `type`,
      //   sinon on concatène les arguments JSON des tool calls (cf. réponse Boeing).
      switch (type) {
        case 'response.created': {
          // Expose response_id for orchestration (previous_response_id continuation)
          const response = (record as Record<string, unknown>).response as Record<string, unknown> | undefined;
          const responseId =
            (response && typeof response.id === 'string' && response.id) ||
            (typeof (record as Record<string, unknown>).response_id === 'string' && ((record as Record<string, unknown>).response_id as string)) ||
            (typeof (record as Record<string, unknown>).id === 'string' && ((record as Record<string, unknown>).id as string)) ||
            '';
          if (responseId) yield { type: 'status', data: { state: 'response_created', response_id: responseId } };
          break;
        }
        case 'response.reasoning_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) yield { type: 'reasoning_delta', data: { delta } };
          break;
        }
        // Some models may emit alternate reasoning events (SDK/API drift).
        case 'response.reasoning.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : (typeof record.text === 'string' ? record.text : undefined);
          if (delta) yield { type: 'reasoning_delta', data: { delta } };
          break;
        }
        case 'response.reasoning_summary_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) yield { type: 'reasoning_delta', data: { delta, kind: 'summary' } };
          break;
        }
        case 'response.reasoning_summary.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : (typeof record.text === 'string' ? record.text : undefined);
          if (delta) yield { type: 'reasoning_delta', data: { delta, kind: 'summary' } };
          break;
        }
        case 'response.reasoning_summary_text.done': {
          const text = typeof record.text === 'string' ? record.text : undefined;
          if (text) yield { type: 'reasoning_delta', data: { delta: text, kind: 'summary_done' } };
          break;
        }
        case 'response.reasoning_summary.done': {
          const text = typeof record.text === 'string' ? record.text : (typeof record.delta === 'string' ? record.delta : undefined);
          if (text) yield { type: 'reasoning_delta', data: { delta: text, kind: 'summary_done' } };
          break;
        }
        case 'response.output_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) {
            sawOutputTextDelta = true;
            yield { type: 'content_delta', data: { delta } };
          }
          break;
        }
        case 'response.output_text.done': {
          // Fallback: some flows only provide the full text in the `.done` event.
          const text = typeof record.text === 'string' ? record.text : undefined;
          if (!sawOutputTextDelta && text) {
            yield { type: 'content_delta', data: { delta: text } };
          }
          break;
        }
        case 'response.output_item.added': {
          const item = record.item as unknown;
          const itemRec = item as Record<string, unknown> | null;
          // Tool call "function_call"
          if (itemRec && itemRec.type === 'function_call') {
            const itemId = (typeof itemRec.id === 'string' && itemRec.id) ? itemRec.id : '';
            const callId = (typeof itemRec.call_id === 'string' && itemRec.call_id) ? itemRec.call_id : '';
            // Public id used throughout our system: prefer call_id (required for function_call_output).
            const toolCallId = callId || itemId || '';
            const name = typeof itemRec.name === 'string' ? itemRec.name : '';
            const args = typeof itemRec.arguments === 'string' ? itemRec.arguments : '';
            if (itemId && toolCallId) {
              itemIdToCallId.set(itemId, toolCallId);
            }
            if (toolCallId) toolCallState.set(toolCallId, { started: true, sawDelta: false, name });
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name, args } };
          } else if (itemRec && itemRec.type === 'output_text') {
            // Some responses may provide the full output text as an output item (especially with structured outputs),
            // without streaming `response.output_text.delta`.
            const text = typeof itemRec.text === 'string' ? itemRec.text : undefined;
            if (!sawOutputTextDelta && text) {
              sawOutputTextDelta = true;
              yield { type: 'content_delta', data: { delta: text } };
            }
          }
          break;
        }
        case 'response.output_item.done': {
          const item = record.item as unknown;
          const itemRec = item as Record<string, unknown> | null;
          if (itemRec && itemRec.type === 'output_text') {
            const text = typeof itemRec.text === 'string' ? itemRec.text : undefined;
            if (!sawOutputTextDelta && text) {
              sawOutputTextDelta = true;
              yield { type: 'content_delta', data: { delta: text } };
            }
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const itemId = typeof record.item_id === 'string' ? record.item_id : undefined;
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (!itemId || !delta) break;
          const toolCallId = itemIdToCallId.get(itemId) || itemId;
          const state = toolCallState.get(toolCallId) || { started: false, sawDelta: false };
          state.sawDelta = true;
          toolCallState.set(toolCallId, state);
          yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta } };
          break;
        }
        case 'response.function_call_arguments.done': {
          const itemId = typeof record.item_id === 'string' ? record.item_id : undefined;
          const name = typeof record.name === 'string' ? record.name : undefined;
          const args = typeof record.arguments === 'string' ? record.arguments : undefined;
          if (!itemId) break;
          const toolCallId = itemIdToCallId.get(itemId) || itemId;
          const state = toolCallState.get(toolCallId) || { started: false, sawDelta: false };
          // Fallback: certains flux peuvent ne pas émettre de delta, uniquement "done"
          if (!state.started) {
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name: name || '', args: args || '' } };
          } else if (!state.sawDelta && args) {
            yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta: args } };
          }
          toolCallState.set(toolCallId, { started: true, sawDelta: true, name: name || state.name });
          break;
        }
        case 'response.error': {
          const err = record.error as unknown;
          const errRec = err as Record<string, unknown> | null;
          const message =
            (errRec && typeof errRec.message === 'string' && errRec.message) ? errRec.message : 'Unknown error';
          const requestId =
            (typeof (record as Record<string, unknown>).request_id === 'string' && ((record as Record<string, unknown>).request_id as string)) ||
            (errRec && typeof errRec.request_id === 'string' && (errRec.request_id as string)) ||
            '';
          yield { type: 'error', data: { message, ...(requestId ? { request_id: requestId } : {}) } };
          break;
        }
        case 'response.completed': {
          yield { type: 'done', data: {} };
          return;
        }
        default: {
          // Ignorer les autres events (output_text.done, output_item.done, etc.)
          break;
        }
      }
    }
  } catch (error) {
    const normalized = getOpenAIProvider().normalizeError(error);
    yield {
      type: 'error',
      data: {
        message: normalized.message,
        ...(normalized.code ? { code: normalized.code } : {})
      }
    };
    throw error;
  }
}
