import OpenAI from 'openai';
import { providerRegistry } from '../provider-registry';
import {
  inferProviderFromModelIdWithLegacy,
  resolveDefaultSelection,
} from '../model-catalog';
import {
  resolveProviderCredential,
  type ResolvedProviderCredential
} from '../provider-credentials';
import { getOpenAITransportMode, resolveConnectedCodexTransport } from '../provider-connections';
import {
  GeminiProviderRuntime,
  type GeminiGenerateRequest,
  type GeminiStreamGenerateRequest
} from '../providers/gemini-provider';
import {
  OpenAIProviderRuntime,
  type OpenAIGenerateRequest,
  type OpenAIStreamGenerateRequest
} from '../providers/openai-provider';
import {
  ClaudeProviderRuntime,
  type ClaudeGenerateRequest,
  type ClaudeStreamGenerateRequest
} from '../providers/claude-provider';
import {
  MistralProviderRuntime,
  type MistralGenerateRequest,
  type MistralStreamGenerateRequest
} from '../providers/mistral-provider';
import {
  CohereProviderRuntime,
  type CohereGenerateRequest,
  type CohereStreamGenerateRequest
} from '../providers/cohere-provider';
import { isProviderId, type ProviderId } from '../provider-runtime';
import { settingsService } from '../settings';
import { createId } from '../../utils/id';

const getOpenAIProvider = (): OpenAIProviderRuntime => {
  return providerRegistry.requireProvider('openai') as OpenAIProviderRuntime;
};

const getGeminiProvider = (): GeminiProviderRuntime => {
  return providerRegistry.requireProvider('gemini') as GeminiProviderRuntime;
};

const getClaudeProvider = (): ClaudeProviderRuntime => {
  return providerRegistry.requireProvider('anthropic') as ClaudeProviderRuntime;
};

const getMistralProvider = (): MistralProviderRuntime => {
  return providerRegistry.requireProvider('mistral') as MistralProviderRuntime;
};

const getCohereProvider = (): CohereProviderRuntime => {
  return providerRegistry.requireProvider('cohere') as CohereProviderRuntime;
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
  const inferredProvider = inferProviderFromModelIdWithLegacy(
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

export interface CallLLMOptions {
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

export interface CallLLMStreamOptions {
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

export const buildGeminiRequestBody = (
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

// ---------------------------------------------------------------------------
// Claude message format conversion
// ---------------------------------------------------------------------------

type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

const buildClaudeMessages = (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): { system: string; messages: ClaudeMessage[] } => {
  const systemParts: string[] = [];
  const claudeMessages: ClaudeMessage[] = [];

  for (const message of messages) {
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
      claudeMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCallId,
            content,
          },
        ],
      });
      continue;
    }

    if (role === 'assistant') {
      // Forward tool_calls as tool_use blocks so Claude can pair tool_results
      const toolCalls = (message as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }).tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        const contentBlocks: Array<Record<string, unknown>> = [];
        if (content.trim()) {
          contentBlocks.push({ type: 'text', text: content });
        }
        for (const tc of toolCalls) {
          let parsedInput: unknown = {};
          try { parsedInput = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep empty */ }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
        claudeMessages.push({ role: 'assistant', content: contentBlocks });
      } else {
        claudeMessages.push({ role: 'assistant', content });
      }
      continue;
    }

    claudeMessages.push({ role: 'user', content });
  }

  return {
    system: systemParts.join('\n\n'),
    messages: claudeMessages,
  };
};

const buildClaudeTools = (
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | 'none'
): Array<Record<string, unknown>> | undefined => {
  if (!tools || tools.length === 0 || toolChoice === 'none') return undefined;
  return tools
    .filter(isFunctionTool)
    .filter((tool) => Boolean(tool.function?.name))
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function?.description || '',
      input_schema: tool.function?.parameters ?? { type: 'object', properties: {} },
    }));
};

const extractClaudeText = (payload: unknown): string => {
  const record = payload as Record<string, unknown> | null;
  if (!record) return '';
  const content = Array.isArray(record.content)
    ? (record.content as Array<Record<string, unknown>>)
    : [];
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
};

// ---------------------------------------------------------------------------
// Mistral message format conversion (OpenAI-compatible)
// ---------------------------------------------------------------------------

type MistralMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  [key: string]: unknown;
};

const buildMistralMessages = (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): MistralMessage[] => {
  return messages.map((m) => {
    const content = stringifyContent(
      (m as unknown as { content?: unknown }).content
    );
    const role = m.role as MistralMessage['role'];
    const base: MistralMessage = { role, content };
    if (role === 'assistant') {
      // Forward tool_calls from assistant messages (camelCase for Mistral SDK)
      const src = m as Record<string, unknown>;
      const rawCalls = src.toolCalls ?? src.tool_calls;
      if (Array.isArray(rawCalls) && rawCalls.length > 0) {
        base.toolCalls = rawCalls.map((tc: Record<string, unknown>) => {
          const fn = (tc.function ?? tc.fn) as Record<string, unknown> | undefined;
          return {
            id: typeof tc.id === 'string' ? tc.id : '',
            type: 'function' as const,
            function: {
              name: typeof fn?.name === 'string' ? fn.name : '',
              arguments: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {}),
            },
          };
        });
      }
    }
    if (role === 'tool') {
      // Mistral SDK expects camelCase toolCallId + name
      const src = m as Record<string, unknown>;
      const toolCallId = (src.toolCallId ?? src.tool_call_id) as string | undefined;
      if (toolCallId) base.toolCallId = toolCallId;
      const name = src.name as string | undefined;
      if (name) base.name = name;
    }
    return base;
  });
};

const buildMistralTools = (
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | 'none'
): Array<Record<string, unknown>> | undefined => {
  if (!tools || tools.length === 0 || toolChoice === 'none') return undefined;
  return tools
    .filter(isFunctionTool)
    .filter((tool) => Boolean(tool.function?.name))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function?.description || '',
        parameters: tool.function?.parameters ?? { type: 'object', properties: {} },
      },
    }));
};

const extractMistralText = (payload: unknown): string => {
  const record = payload as Record<string, unknown> | null;
  if (!record) return '';
  const choices = Array.isArray(record.choices)
    ? (record.choices as Array<Record<string, unknown>>)
    : [];
  const first = choices[0];
  if (!first) return '';
  const message = first.message as Record<string, unknown> | undefined;
  return typeof message?.content === 'string' ? message.content : '';
};

// ---------------------------------------------------------------------------
// Cohere message format conversion (V2 API - OpenAI-compatible)
// ---------------------------------------------------------------------------

type CohereMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  [key: string]: unknown;
};

const buildCohereMessages = (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): CohereMessage[] => {
  return messages.map((m) => {
    const content = stringifyContent(
      (m as unknown as { content?: unknown }).content
    );
    const role = (m.role === 'developer' ? 'system' : m.role) as CohereMessage['role'];
    const base: CohereMessage = { role, content };
    if (role === 'assistant') {
      // Forward toolCalls from assistant messages (camelCase for Cohere SDK)
      const src = m as Record<string, unknown>;
      const rawCalls = src.tool_calls ?? src.toolCalls;
      if (Array.isArray(rawCalls) && rawCalls.length > 0) {
        base.toolCalls = rawCalls.map((tc: Record<string, unknown>) => {
          const fn = (tc.function ?? tc.fn) as Record<string, unknown> | undefined;
          return {
            id: typeof tc.id === 'string' ? tc.id : '',
            type: 'function' as const,
            function: {
              name: typeof fn?.name === 'string' ? fn.name : '',
              arguments: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {}),
            },
          };
        });
      }
    }
    if (role === 'tool') {
      // Cohere SDK expects camelCase toolCallId
      const src = m as Record<string, unknown>;
      const toolCallId = (src.tool_call_id ?? src.toolCallId) as string | undefined;
      if (toolCallId) base.toolCallId = toolCallId;
    }
    return base;
  });
};

const buildCohereTools = (
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | 'none'
): Array<Record<string, unknown>> | undefined => {
  if (!tools || tools.length === 0 || toolChoice === 'none') return undefined;
  return tools
    .filter(isFunctionTool)
    .filter((tool) => Boolean(tool.function?.name))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function?.description || '',
        parameters: tool.function?.parameters ?? { type: 'object', properties: {} },
      },
    }));
};

const extractCohereText = (payload: unknown): string => {
  const record = payload as Record<string, unknown> | null;
  if (!record) return '';
  const message = record.message as Record<string, unknown> | undefined;
  if (!message) return '';
  const content = Array.isArray(message.content)
    ? (message.content as Array<Record<string, unknown>>)
    : [];
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
};

// ---------------------------------------------------------------------------
// Reasoning parameter mapping
// ---------------------------------------------------------------------------

const CLAUDE_REASONING_BUDGET: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
  xhigh: 32768,
};

const mapClaudeReasoningParams = (
  model: string,
  reasoningEffort?: string
): { thinkingParams: Record<string, unknown>; minMaxTokens: number } | undefined => {
  // Extended thinking is available on Claude Opus and Sonnet (4+)
  if (!model.includes('opus') && !model.includes('sonnet')) return undefined;
  if (!reasoningEffort || reasoningEffort === 'none') return undefined;
  const budgetTokens = CLAUDE_REASONING_BUDGET[reasoningEffort] ?? CLAUDE_REASONING_BUDGET.medium;
  return {
    thinkingParams: {
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens,
      },
    },
    // Claude requires max_tokens > budget_tokens
    minMaxTokens: budgetTokens + 4096,
  };
};

/**
 * Méthode unique pour tous les appels OpenAI (non-streaming)
 */
export const callLLM = async (options: CallLLMOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
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
  // Structured output routing constraint: warn if provider does not support structured output
  if (!capabilities.supportsStructuredOutput && responseFormat) {
    console.warn(`[llm-runtime] Provider ${selection.providerId} does not support structured output — responseFormat ignored`);
  }

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

  if (selection.providerId === 'anthropic') {
    const provider = getClaudeProvider();
    const { system, messages: claudeMessages } = buildClaudeMessages(messages);
    const claudeTools = buildClaudeTools(filteredTools, normalizedToolChoice);
    const raw = await provider.generate({
      mode: 'messages',
      requestOptions: {
        model: selection.model,
        max_tokens: typeof maxOutputTokens === 'number' && maxOutputTokens > 0
          ? Math.floor(maxOutputTokens)
          : 4096,
        ...(system ? { system } : {}),
        messages: claudeMessages as unknown[],
        ...(claudeTools ? { tools: claudeTools as unknown[] } : {}),
        // Claude API does not support response_format — JSON output must be requested via prompt
      } as unknown as import('@anthropic-ai/sdk').Anthropic.MessageCreateParams,
      credential: credentialResolution.credential ?? undefined,
      signal,
    } satisfies ClaudeGenerateRequest);

    const text = extractClaudeText(raw);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: `claude_${createId()}`,
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

  if (selection.providerId === 'mistral') {
    const provider = getMistralProvider();
    const mistralMessages = buildMistralMessages(messages);
    const mistralTools = buildMistralTools(filteredTools, normalizedToolChoice);
    const raw = await provider.generate({
      mode: 'chat-completions',
      requestOptions: {
        model: selection.model,
        messages: mistralMessages,
        ...(mistralTools ? { tools: mistralTools } : {}),
        ...(!mistralTools && responseFormat === 'json_object'
          ? { responseFormat: { type: 'json_object' } }
          : {}),
        ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0
          ? { max_tokens: Math.floor(maxOutputTokens) }
          : {}),
      },
      credential: credentialResolution.credential ?? undefined,
      signal,
    } satisfies MistralGenerateRequest);

    const text = extractMistralText(raw);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: `mistral_${createId()}`,
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

  if (selection.providerId === 'cohere') {
    const provider = getCohereProvider();
    const cohereMessages = buildCohereMessages(messages);
    const cohereTools = buildCohereTools(filteredTools, normalizedToolChoice);
    const raw = await provider.generate({
      mode: 'chat',
      requestOptions: {
        model: selection.model,
        messages: cohereMessages,
        ...(cohereTools ? { tools: cohereTools } : {}),
        ...(responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0
          ? { max_tokens: Math.floor(maxOutputTokens) }
          : {}),
      },
      credential: credentialResolution.credential ?? undefined,
      signal,
    } satisfies CohereGenerateRequest);

    const text = extractCohereText(raw);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: `cohere_${createId()}`,
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
 * Streaming via Responses API (support reasoning, modèle unique)
 * - N'injecte pas de reasoning.effort par défaut (on ne le spécifie que si demandé)
 */
export async function* callLLMStream(
  options: CallLLMStreamOptions
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
  // Structured output routing constraint: warn and degrade if provider does not support structured output
  if (!capabilities.supportsStructuredOutput && (structuredOutput || responseFormat)) {
    console.warn(`[llm-runtime] Provider ${selection.providerId} does not support structured output — structuredOutput/responseFormat ignored`);
  }
  const effectiveStructuredOutput = capabilities.supportsStructuredOutput ? structuredOutput : undefined;
  const effectiveResponseFormat = capabilities.supportsStructuredOutput ? responseFormat : undefined;
  const selectedModel = selection.model;
  const codexTransport =
    selection.providerId === 'openai' &&
    typeof userId === 'string' &&
    userId.trim().length > 0 &&
    selectedModel === 'gpt-5.4' &&
    (await getOpenAITransportMode()) === 'codex'
      ? await resolveConnectedCodexTransport(userId)
      : null;
  const useCodexTransport = Boolean(codexTransport);

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
      responseFormat: effectiveResponseFormat,
      structuredOutput: effectiveStructuredOutput,
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

  if (selection.providerId === 'anthropic') {
    const provider = getClaudeProvider();
    const responseId = previousResponseId || `claude_${createId()}`;
    const { system, messages: claudeMessages } = buildClaudeMessages(messages);
    const claudeTools = buildClaudeTools(filteredTools, normalizedToolChoice);
    const claudeReasoning = mapClaudeReasoningParams(selectedModel, reasoningEffort);

    // Handle rawInput: inject assistant tool_use blocks then user tool_result blocks
    if (Array.isArray(rawInput) && rawInput.length > 0) {
      // 1) Collect function_call items → assistant message with tool_use blocks
      const toolUseBlocks: Array<Record<string, unknown>> = [];
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type === 'function_call') {
          let parsedArgs: unknown = {};
          try { parsedArgs = JSON.parse(typeof record.arguments === 'string' ? record.arguments : '{}'); } catch { /* keep empty */ }
          toolUseBlocks.push({
            type: 'tool_use',
            id: typeof record.call_id === 'string' ? record.call_id : '',
            name: typeof record.name === 'string' ? record.name : '',
            input: parsedArgs,
          });
        }
      }
      if (toolUseBlocks.length > 0) {
        claudeMessages.push({ role: 'assistant', content: toolUseBlocks });
      }
      // 2) Collect function_call_output items → user message with tool_result blocks
      const toolResultBlocks: Array<Record<string, unknown>> = [];
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type === 'function_call_output') {
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: typeof record.call_id === 'string' ? record.call_id : '',
            content: stringifyContent(record.output),
          });
        }
      }
      if (toolResultBlocks.length > 0) {
        claudeMessages.push({ role: 'user', content: toolResultBlocks });
      }
    }

    try {
      yield { type: 'status', data: { state: 'started' } };
      yield {
        type: 'status',
        data: { state: 'response_created', response_id: responseId },
      };

      const claudeBaseMaxTokens = typeof maxOutputTokens === 'number' && maxOutputTokens > 0
        ? Math.floor(maxOutputTokens)
        : 4096;
      const claudeMaxTokens = claudeReasoning
        ? Math.max(claudeBaseMaxTokens, claudeReasoning.minMaxTokens)
        : claudeBaseMaxTokens;

      const stream = await provider.streamGenerate({
        mode: 'messages',
        requestOptions: {
          model: selectedModel,
          max_tokens: claudeMaxTokens,
          ...(system ? { system } : {}),
          messages: claudeMessages as unknown[],
          ...(claudeTools ? { tools: claudeTools as unknown[] } : {}),
          ...(claudeReasoning?.thinkingParams ?? {}),
          // Claude API does not support response_format — JSON output must be requested via prompt
        } as unknown as import('@anthropic-ai/sdk').Anthropic.MessageCreateParams,
        credential: credentialResolution.credential ?? undefined,
        signal,
      } satisfies ClaudeStreamGenerateRequest);

      let emittedContent = false;
      for await (const chunk of stream) {
        if (signal?.aborted) {
          yield { type: 'error', data: { message: 'Stream aborted' } };
          return;
        }
        const event = chunk as Record<string, unknown>;
        const eventType = typeof event.type === 'string' ? event.type : '';

        if (eventType === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            yield { type: 'reasoning_delta', data: { delta: delta.thinking } };
          } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            emittedContent = true;
            yield { type: 'content_delta', data: { delta: delta.text } };
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const contentBlockIndex = typeof event.index === 'number' ? event.index : 0;
            const toolCallId = `claude_call_${contentBlockIndex}`;
            yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta: delta.partial_json } };
          }
        } else if (eventType === 'content_block_start') {
          const contentBlock = event.content_block as Record<string, unknown> | undefined;
          if (contentBlock?.type === 'tool_use') {
            const contentBlockIndex = typeof event.index === 'number' ? event.index : 0;
            const toolCallId = `claude_call_${contentBlockIndex}`;
            const name = typeof contentBlock.name === 'string' ? contentBlock.name : '';
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name, args: '' } };
          }
        } else if (eventType === 'message_stop') {
          break;
        }
      }

      if (!emittedContent && filteredTools && filteredTools.length > 0) {
        yield {
          type: 'status',
          data: {
            state: 'provider_completed_without_content',
            provider_id: 'anthropic',
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

  if (selection.providerId === 'mistral') {
    const provider = getMistralProvider();
    const responseId = previousResponseId || `mistral_${createId()}`;
    const mistralMessages = buildMistralMessages(messages);
    const mistralTools = buildMistralTools(filteredTools, normalizedToolChoice);

    // Handle rawInput: reconstruct assistant toolCalls + tool results (camelCase for Mistral SDK)
    if (Array.isArray(rawInput) && rawInput.length > 0) {
      // 1) Collect function_call items → assistant message with toolCalls
      const toolCallItems: Array<{ id: string; name: string; arguments: string }> = [];
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type === 'function_call') {
          toolCallItems.push({
            id: typeof record.call_id === 'string' ? record.call_id : '',
            name: typeof record.name === 'string' ? record.name : '',
            arguments: typeof record.arguments === 'string' ? record.arguments : JSON.stringify(record.arguments ?? {}),
          });
        }
      }
      if (toolCallItems.length > 0) {
        mistralMessages.push({
          role: 'assistant',
          content: '',
          toolCalls: toolCallItems.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      }
      // 2) Collect function_call_output items → tool messages with toolCallId + name
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type !== 'function_call_output') continue;
        const callId = typeof record.call_id === 'string' ? record.call_id : '';
        const output = stringifyContent(record.output);
        // Find matching function_call to get the tool name
        const matchingCall = toolCallItems.find((tc) => tc.id === callId);
        mistralMessages.push({
          role: 'tool',
          content: output,
          toolCallId: callId,
          name: matchingCall?.name || 'unknown',
        });
      }
    }

    try {
      yield { type: 'status', data: { state: 'started' } };
      yield {
        type: 'status',
        data: { state: 'response_created', response_id: responseId },
      };

      const stream = await provider.streamGenerate({
        mode: 'chat-completions',
        requestOptions: {
          model: selectedModel,
          messages: mistralMessages,
          ...(mistralTools ? { tools: mistralTools, toolChoice: normalizedToolChoice === 'required' ? 'any' : normalizedToolChoice } : {}),
          // Mistral rejects responseFormat combined with tools (error 3051)
          ...(!mistralTools && (effectiveStructuredOutput || effectiveResponseFormat === 'json_object')
            ? { responseFormat: { type: 'json_object' } }
            : {}),
          ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0
            ? { maxTokens: Math.floor(maxOutputTokens) }
            : {}),
        },
        credential: credentialResolution.credential ?? undefined,
        signal,
      } satisfies MistralStreamGenerateRequest);

      let emittedContent = false;
      const mistralToolCallsInProgress = new Map<string, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        if (signal?.aborted) {
          yield { type: 'error', data: { message: 'Stream aborted' } };
          return;
        }
        const record = chunk as Record<string, unknown>;
        const data = (record.data ?? record) as Record<string, unknown>;
        const choices = Array.isArray(data.choices)
          ? (data.choices as Array<Record<string, unknown>>)
          : [];
        const choice = choices[0];
        if (!choice) continue;

        // Check finishReason BEFORE delta — last chunk may have finishReason but no delta
        const rawFinishReason = choice.finishReason ?? choice.finish_reason;
        const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason : null;

        const delta = choice.delta as Record<string, unknown> | undefined;

        if (delta) {
          // Magistral reasoning: content can be array of {type:"thinking"} / {type:"text"} chunks
          if (Array.isArray(delta.content)) {
            for (const chunk of delta.content as Array<Record<string, unknown>>) {
              if (chunk.type === 'thinking') {
                const thinkingParts = Array.isArray(chunk.thinking) ? chunk.thinking as Array<Record<string, unknown>> : [];
                for (const part of thinkingParts) {
                  if (typeof part.text === 'string' && part.text) {
                    yield { type: 'reasoning_delta', data: { delta: part.text } };
                  }
                }
              } else if (chunk.type === 'text') {
                if (typeof chunk.text === 'string' && chunk.text) {
                  emittedContent = true;
                  yield { type: 'content_delta', data: { delta: chunk.text } };
                }
              }
            }
          } else if (typeof delta.content === 'string' && delta.content) {
            emittedContent = true;
            yield { type: 'content_delta', data: { delta: delta.content } };
          }

          // Mistral SDK returns camelCase (toolCalls) not snake_case (tool_calls)
          const rawToolCalls = delta.toolCalls ?? delta.tool_calls;
          const toolCalls = Array.isArray(rawToolCalls)
            ? (rawToolCalls as Array<Record<string, unknown>>)
            : [];
          for (const tc of toolCalls) {
            const tcId = typeof tc.id === 'string' ? tc.id : '';
            const tcIndex = typeof tc.index === 'number' ? tc.index : 0;
            const trackingKey = tcId || `mistral_index_${tcIndex}`;
            const fn = tc.function as Record<string, unknown> | undefined;

            if (!mistralToolCallsInProgress.has(trackingKey)) {
              mistralToolCallsInProgress.set(trackingKey, {
                id: tcId,
                name: typeof fn?.name === 'string' ? fn.name : '',
                args: typeof fn?.arguments === 'string' ? fn.arguments : '',
              });
              yield {
                type: 'tool_call_start',
                data: {
                  tool_call_id: trackingKey,
                  name: typeof fn?.name === 'string' ? fn.name : '',
                  args: typeof fn?.arguments === 'string' ? fn.arguments : '',
                },
              };
            } else if (typeof fn?.arguments === 'string' && fn.arguments) {
              const existing = mistralToolCallsInProgress.get(trackingKey)!;
              existing.args += fn.arguments;
              yield { type: 'tool_call_delta', data: { tool_call_id: trackingKey, delta: fn.arguments } };
            }
          }
        }

        if (finishReason) break;
      }

      if (!emittedContent && filteredTools && filteredTools.length > 0) {
        yield {
          type: 'status',
          data: {
            state: 'provider_completed_without_content',
            provider_id: 'mistral',
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

  if (selection.providerId === 'cohere') {
    const provider = getCohereProvider();
    const responseId = previousResponseId || `cohere_${createId()}`;
    const cohereMessages = buildCohereMessages(messages);
    const cohereTools = buildCohereTools(filteredTools, normalizedToolChoice);

    // Handle rawInput: reconstruct assistant toolCalls + tool result messages
    if (Array.isArray(rawInput) && rawInput.length > 0) {
      // 1) Collect function_call items → assistant message with toolCalls (skip empty/phantom entries)
      const toolCallItems: Array<{ id: string; name: string; arguments: string }> = [];
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type === 'function_call') {
          const callId = typeof record.call_id === 'string' ? record.call_id : '';
          const name = typeof record.name === 'string' ? record.name : '';
          if (!callId || !name) continue; // skip phantom tool calls with empty id/name
          toolCallItems.push({
            id: callId,
            name,
            arguments: typeof record.arguments === 'string' ? record.arguments : JSON.stringify(record.arguments ?? {}),
          });
        }
      }
      if (toolCallItems.length > 0) {
        cohereMessages.push({
          role: 'assistant',
          content: '',
          toolCalls: toolCallItems.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      }
      // 2) Collect function_call_output items → tool messages (camelCase toolCallId for Cohere SDK)
      for (const item of rawInput) {
        const record = item as Record<string, unknown>;
        if (record?.type !== 'function_call_output') continue;
        const callId = typeof record.call_id === 'string' ? record.call_id : '';
        if (!callId) continue; // skip phantom outputs
        const output = stringifyContent(record.output);
        cohereMessages.push({
          role: 'tool',
          content: output,
          toolCallId: callId,
        });
      }
    }

    try {
      yield { type: 'status', data: { state: 'started' } };
      yield {
        type: 'status',
        data: { state: 'response_created', response_id: responseId },
      };

      const stream = await provider.streamGenerate({
        mode: 'chat',
        requestOptions: {
          model: selectedModel,
          messages: cohereMessages,
          ...(cohereTools
            ? {
                tools: cohereTools,
                // command-a-reasoning does not support tool_choice
                ...(selectedModel.includes('reasoning') ? {} : { tool_choice: normalizedToolChoice === 'required' ? 'required' : normalizedToolChoice }),
              }
            : {}),
          ...(effectiveStructuredOutput
            ? { response_format: { type: 'json_object' } }
            : effectiveResponseFormat === 'json_object'
              ? { response_format: { type: 'json_object' } }
              : {}),
          ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0
            ? { max_tokens: Math.floor(maxOutputTokens) }
            : {}),
        },
        credential: credentialResolution.credential ?? undefined,
        signal,
      } satisfies CohereStreamGenerateRequest);

      let emittedContent = false;
      let currentCohereToolCallId = '';
      for await (const chunk of stream) {
        if (signal?.aborted) {
          yield { type: 'error', data: { message: 'Stream aborted' } };
          return;
        }
        const event = chunk as Record<string, unknown>;
        const eventType = typeof event.type === 'string' ? event.type : '';
        if (eventType === 'tool-plan-delta') {
          // Cohere reasoning: tool plan is the model's thinking before tool calls
          const deltaObj = event.delta as Record<string, unknown> | undefined;
          const msgObj = deltaObj?.message as Record<string, unknown> | undefined;
          const toolPlan = typeof msgObj?.toolPlan === 'string' ? msgObj.toolPlan : undefined;
          if (toolPlan) {
            yield { type: 'reasoning_delta', data: { delta: toolPlan } };
          }
        } else if (eventType === 'content-delta') {
          const deltaObj = event.delta as Record<string, unknown> | undefined;
          const msgObj = deltaObj?.message as Record<string, unknown> | undefined;
          const contentObj = msgObj?.content as Record<string, unknown> | undefined;
          // Cohere reasoning model: thinking blocks use `thinking` key, text blocks use `text` key
          const thinking = typeof contentObj?.thinking === 'string' ? contentObj.thinking : undefined;
          const text = typeof contentObj?.text === 'string' ? contentObj.text : undefined;
          if (thinking) {
            yield { type: 'reasoning_delta', data: { delta: thinking } };
          } else if (text) {
            emittedContent = true;
            yield { type: 'content_delta', data: { delta: text } };
          }
        } else if (eventType === 'tool-call-start') {
          // Cohere SDK: delta.message.toolCalls (camelCase, single ToolCallV2)
          const tcDelta = event.delta as Record<string, unknown> | undefined;
          const tcMsg = tcDelta?.message as Record<string, unknown> | undefined;
          const toolCall = (tcMsg?.toolCalls ?? tcDelta?.toolCall ?? tcDelta?.tool_call) as Record<string, unknown> | undefined;
          const toolCallId = typeof toolCall?.id === 'string' ? toolCall.id : '';
          const fn = toolCall?.function as Record<string, unknown> | undefined;
          const name = typeof fn?.name === 'string' ? fn.name : '';
          if (toolCallId && name) {
            currentCohereToolCallId = toolCallId;
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name, args: '' } };
          }
        } else if (eventType === 'tool-call-delta') {
          // Cohere deltas don't carry id — use the id from the last tool-call-start
          const tcDelta = event.delta as Record<string, unknown> | undefined;
          const tcMsg = tcDelta?.message as Record<string, unknown> | undefined;
          const toolCallDelta = (tcMsg?.toolCalls ?? tcDelta?.toolCall ?? tcDelta?.tool_call) as Record<string, unknown> | undefined;
          const fn = toolCallDelta?.function as Record<string, unknown> | undefined;
          const args = typeof fn?.arguments === 'string' ? fn.arguments : '';
          if (currentCohereToolCallId && args) {
            yield { type: 'tool_call_delta', data: { tool_call_id: currentCohereToolCallId, delta: args } };
          }
        } else if (eventType === 'tool-call-end') {
          currentCohereToolCallId = '';
        } else if (eventType === 'message-end') {
          break;
        }
      }

      if (!emittedContent && filteredTools && filteredTools.length > 0) {
        yield {
          type: 'status',
          data: {
            state: 'provider_completed_without_content',
            provider_id: 'cohere',
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

  const mapReasoningEffort = (effort: CallLLMStreamOptions['reasoningEffort']): unknown => {
    if (!effort) return undefined;
    // OpenAI supports (notably for gpt-5-nano): minimal|low|medium|high.
    // App-level accepts: none|low|medium|high|xhigh.
    // Map to avoid 400s:
    // - none  -> minimal (ONLY for gpt-5-nano; current gpt-5 models appear to accept "none")
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
  const codexInstructions: string[] = [];
  const messageInput = messages
    .map((m) => {
      const role = (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system' | 'developer';
      const contentRaw = (m as unknown as { content?: unknown }).content;
      const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw ?? '');
      if (useCodexTransport && (role === 'system' || role === 'developer')) {
        if (content.trim()) codexInstructions.push(content);
        return null;
      }
      return { type: 'message' as const, role, content };
    })
    .filter((item): item is { type: 'message'; role: 'user' | 'assistant'; content: string } => item !== null);
  const input: OpenAI.Responses.ResponseCreateParamsStreaming['input'] =
    rawInput && rawInput.length > 0
      ? useCodexTransport && !previousResponseId
        ? ([...messageInput, ...rawInput] as OpenAI.Responses.ResponseCreateParamsStreaming['input'])
        : (rawInput as OpenAI.Responses.ResponseCreateParamsStreaming['input'])
      : messageInput;

  // Mapper les tools "Chat Completions" -> "Responses" (format plat)
  const responseTools: OpenAI.Responses.ResponseCreateParamsStreaming['tools'] | undefined = filteredTools
    ? (filteredTools
        .filter((t): t is OpenAI.Chat.Completions.ChatCompletionFunctionTool => t.type === 'function')
        .map((t) => ({
          type: 'function' as const,
          name: t.function.name || '',
          description: t.function.description,
          parameters: t.function.parameters ?? null,
          // IMPORTANT: en mode strict, OpenAI exige un sous-ensemble JSON Schema (ex: additionalProperties:false).
          // Pour éviter de "sur-valider" nos tools (web_search/web_extract) à ce stade, on désactive strict.
          strict: false
        }))
        .filter((t) => !!t.name) as unknown as OpenAI.Responses.ResponseCreateParamsStreaming['tools'])
    : undefined;

  // Structured output via Responses API: text.format
  const textConfig: OpenAI.Responses.ResponseCreateParamsStreaming['text'] | undefined =
    effectiveStructuredOutput
      ? {
          format: {
            type: 'json_schema',
            name: effectiveStructuredOutput.name,
            schema: effectiveStructuredOutput.schema,
            description: effectiveStructuredOutput.description,
            strict: effectiveStructuredOutput.strict ?? true
          }
        }
      : effectiveResponseFormat
        ? { format: { type: effectiveResponseFormat } }
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
    ...(useCodexTransport ? { store: false } : {}),
    ...(useCodexTransport
      ? { instructions: codexInstructions.join('\n\n').trim() || 'You are a helpful assistant.' }
      : {}),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(responseTools ? { tools: responseTools } : {}),
    ...(textConfig ? { text: textConfig } : {}),
    ...(!useCodexTransport &&
      typeof maxOutputTokens === 'number' &&
      Number.isFinite(maxOutputTokens) &&
      maxOutputTokens > 0
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
      ...(codexTransport ? { codexTransport } : {}),
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
