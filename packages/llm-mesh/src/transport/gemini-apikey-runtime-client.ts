import { getSecretAuthMaterial } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { GeminiAdapterClient } from '../adapters.js';
import type { LlmMeshMessage } from '../messages.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { FinishReason, StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

export interface GeminiApiKeyRuntimeClientOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly userAgent?: string;
}

// Serving wire facts from the Gemini API reference
// (generativelanguage.googleapis.com, v1beta): POST
// /v1beta/models/{model}:generateContent, request body
// { system_instruction?, contents[], tools?, toolConfig?, generationConfig? },
// non-stream response
// { candidates: [{ content: { parts }, finishReason }], usageMetadata }.
// SSE via POST /v1beta/models/{model}:streamGenerateContent?alt=sse with
// `data: {...}` chunks of the same candidate shape. The paid fallback key is
// a long-lived AI Studio API key carried as the `x-goog-api-key` header (kept
// out of the URL so it never lands in access logs), provided per attempt as a
// `direct-token` by the host. This client holds no credential of its own.
const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_API_VERSION = 'v1beta';
const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

type WirePart = Record<string, unknown>;

const textPartsOf = (message: LlmMeshMessage): string[] => {
  if (typeof message.content === 'string') return message.content ? [message.content] : [];
  const out: string[] = [];
  for (const part of message.content) {
    if (part.type === 'text' && part.text) out.push(part.text);
  }
  return out;
};

const toWireParts = (message: LlmMeshMessage): WirePart[] => {
  const parts: WirePart[] = [];
  if (typeof message.content === 'string') {
    if (message.content) parts.push({ text: message.content });
  } else {
    for (const part of message.content) {
      if (part.type === 'text') {
        if (part.text) parts.push({ text: part.text });
      } else if (part.type === 'image') {
        // Inline bytes stay inline; a bare URL has no Gemini slot and is
        // carried as text rather than silently dropped.
        if (part.data) {
          parts.push({ inlineData: { mimeType: part.mediaType ?? 'image/png', data: part.data } });
        } else if (part.url) {
          parts.push({ text: part.url });
        }
      } else if (part.type === 'file') {
        if (part.data) {
          parts.push({ inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } });
        } else if (part.url) {
          parts.push({ text: part.url });
        }
      }
      // Reasoning history is provider-originated replay material, never a
      // GenerateContent input: skipped like the sibling translated clients.
    }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    for (const call of message.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.argumentsText || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: call.name, args } });
    }
  }
  return parts;
};

const toWireContents = (messages: readonly LlmMeshMessage[]): Array<Record<string, unknown>> => {
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    if (message.role === 'assistant') {
      const parts = toWireParts(message);
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }
    if (message.role === 'tool') {
      const name = typeof message.toolResult.name === 'string' && message.toolResult.name
        ? message.toolResult.name
        : undefined;
      if (name) {
        const output = message.toolResult.output;
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name,
              response: output && typeof output === 'object' && !Array.isArray(output)
                ? output
                : { output: output ?? '' },
            },
          }],
        });
        continue;
      }
      // Nameless tool results cannot form a valid functionResponse: carry
      // the output as text on a user turn rather than dropping it.
      const output = typeof message.toolResult.output === 'string'
        ? message.toolResult.output
        : JSON.stringify(message.toolResult.output ?? '');
      contents.push({ role: 'user', parts: output ? [{ text: output }] : [] });
      continue;
    }
    const parts = toWireParts(message);
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }
  return contents;
};

const toWireBody = (request: GenerateRequest): Record<string, unknown> => {
  const systems: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      systems.push(...textPartsOf(message));
    }
  }
  const body: Record<string, unknown> = {
    contents: toWireContents(request.messages),
  };
  if (systems.length > 0) {
    body.system_instruction = { parts: systems.map((text) => ({ text })) };
  }
  if (request.tools?.length) {
    body.tools = [{
      functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      })),
    }];
    // Gemini functionDeclarations have no strict slot: the validated mesh
    // strict flag is enforced by schema shape, never forwarded verbatim.
    const choice = request.toolChoice;
    if (choice === 'required') {
      body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
    } else if (choice === 'none') {
      body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    } else if (choice && typeof choice === 'object' && choice.type === 'tool') {
      body.toolConfig = {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] },
      };
    } else if (choice === 'auto') {
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
  }
  const generationConfig: Record<string, unknown> = {};
  if (request.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = request.maxOutputTokens;
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.topP !== undefined) generationConfig.topP = request.topP;
  if (request.responseFormat?.type === 'json-object') {
    generationConfig.responseMimeType = 'application/json';
  } else if (request.responseFormat?.type === 'json-schema') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = request.responseFormat.schema;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
};

const geminiFinishOf = (candidate: unknown): string | undefined => {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const reason = (candidate as Record<string, unknown>).finishReason;
  return typeof reason === 'string' && reason ? reason : undefined;
};

const terminalFinish = (args: {
  sawToolCalls: boolean; rawFinish?: string; sawText: boolean; sawCleanEnd?: boolean;
}): FinishReason => {
  if (args.sawToolCalls) return 'tool_calls';
  switch (args.rawFinish) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY':
    case 'IMAGE_SAFETY':
      return 'content_filter';
    default:
      return args.sawText && args.sawCleanEnd ? 'stop' : 'unknown';
  }
};

const extractParts = (payload: unknown): WirePart[] => {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const content = (candidates[0] as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return [];
  const parts = (content as Record<string, unknown>).parts;
  return Array.isArray(parts) ? (parts as WirePart[]) : [];
};

const extractText = (payload: unknown): string =>
  extractParts(payload)
    .map((part) => textOf((part as Record<string, unknown>).text) ?? '')
    .filter((text) => text.length > 0)
    .join('');

const extractToolCalls = (payload: unknown): ToolCall[] => {
  const calls: ToolCall[] = [];
  extractParts(payload).forEach((part, index) => {
    const record = part as Record<string, unknown>;
    const fn = record.functionCall;
    if (!fn || typeof fn !== 'object') return;
    const fnRecord = fn as Record<string, unknown>;
    if (typeof fnRecord.name !== 'string' || !fnRecord.name) return;
    const id = `gemini-call-${index}`;
    calls.push({
      toolCallId: id,
      providerCallId: id,
      name: fnRecord.name,
      argumentsText: fnRecord.args === undefined ? '' : JSON.stringify(fnRecord.args),
    });
  });
  return calls;
};

const extractUsage = (payload: unknown): TokenUsage | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as Record<string, unknown>).usageMetadata;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const inputTokens = numOf(u.promptTokenCount);
  const outputTokens = numOf(u.candidatesTokenCount);
  const thoughtsTokenCount = numOf(u.thoughtsTokenCount);
  const totalTokens = numOf(u.totalTokenCount);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
    && thoughtsTokenCount === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(thoughtsTokenCount !== undefined ? { thoughtsTokenCount } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
};

const parseSseJson = async function* (
  body: ReadableStream<Uint8Array>,
  state?: { sawCleanEnd?: boolean },
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (payload === '[DONE]') {
          if (state) state.sawCleanEnd = true;
        } else if (payload) {
          try {
            yield JSON.parse(payload);
          } catch {
            yield payload;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export class GeminiApiKeyRuntimeClient implements GeminiAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: GeminiApiKeyRuntimeClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.userAgent = options.userAgent ?? '@sentropic/llm-mesh';
  }

  private apiKeyOf(context: ProviderRuntimeContext | undefined): string {
    const auth = getSecretAuthMaterial(context?.auth);
    // Fail closed: only a host-minted direct-token carries the fallback key.
    // The key is referenced by name in ops config and never read from env
    // here, so product BYOK and subscription paths cannot leak into it.
    if (auth?.type === 'direct-token' && auth.token.trim().length > 0) {
      return auth.token;
    }
    throw Object.assign(new Error('Gemini fallback API key is missing'), { status: 401 });
  }

  private urlOf(model: string, stream: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const query = stream ? '?alt=sse' : '';
    return `${this.baseUrl}/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:${action}${query}`;
  }

  private async post(
    request: GenerateRequest,
    context: ProviderRuntimeContext | undefined,
    stream = false,
  ): Promise<Response> {
    const apiKey = this.apiKeyOf(context);
    const model = request.modelId ?? GEMINI_DEFAULT_MODEL;
    const response = await this.fetchFn(this.urlOf(model, stream), {
      method: 'POST',
      signal: request.signal,
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
        accept: stream ? 'text/event-stream' : 'application/json',
        'user-agent': this.userAgent,
      },
      body: JSON.stringify(toWireBody(request)),
    });
    if (!response.ok) {
      // Key never enters the message: status + retry hint only.
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(`Gemini API HTTP error (${response.status})`), {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1_000 }
          : {}),
      });
    }
    return response;
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const response = await this.post(request, context, true);
    if (!response.body) {
      const done: StreamEvent = { type: 'done', data: { finishReason: 'unknown' } };
      return (async function* (): AsyncGenerator<StreamEvent> { yield done; })();
    }
    return (async function* (): AsyncGenerator<StreamEvent> {
      let sawText = false;
      let sawToolCalls = false;
      let rawFinish: string | undefined;
      let stashedUsage: TokenUsage | undefined;
      const sseState: { sawCleanEnd?: boolean } = {};
      const toolCallIds = new Map<number, string>();
      for await (const raw of parseSseJson(response.body!, sseState)) {
        const text = extractText(raw);
        const usage = extractUsage(raw);
        const finish = raw ? geminiFinishOf(
          (raw as Record<string, unknown>).candidates?.[0],
        ) : undefined;
        if (finish) rawFinish = finish;
        if (text) {
          sawText = true;
          yield { type: 'content_delta', data: { delta: text } };
        }
        const streamedCalls = extractToolCalls(raw);
        for (let index = 0; index < streamedCalls.length; index += 1) {
          const call = streamedCalls[index]!;
          const known = toolCallIds.get(index);
          const toolCallId = known ?? call.toolCallId;
          if (!known) {
            toolCallIds.set(index, toolCallId);
            sawToolCalls = true;
            yield {
              type: 'tool_call_start',
              data: {
                toolCallId, providerCallId: toolCallId, name: call.name, argumentsText: '',
              },
            };
            if (!call.argumentsText) continue;
          }
          yield {
            type: 'tool_call_delta',
            data: { toolCallId, providerCallId: toolCallId, delta: call.argumentsText, name: call.name },
          };
        }
        if (usage) {
          if (!rawFinish) {
            stashedUsage = usage;
            continue;
          }
          yield {
            type: 'done',
            data: {
              finishReason: terminalFinish({ sawToolCalls, rawFinish, sawText }),
              ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
              usage,
            },
          };
          return;
        }
      }
      yield {
        type: 'done',
        data: {
          finishReason: terminalFinish({ sawToolCalls, rawFinish, sawText, sawCleanEnd: sseState.sawCleanEnd }),
          ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
          ...(stashedUsage ? { usage: stashedUsage } : {}),
        },
      };
    })();
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const response = await this.post(request, context, false);
    const payload: unknown = await response.json();
    const text = extractText(payload);
    const usage = extractUsage(payload);
    const toolCalls = extractToolCalls(payload);
    const modelId = request.modelId ?? GEMINI_DEFAULT_MODEL;
    const rawFinish = geminiFinishOf(
      (payload as Record<string, unknown> | null)?.candidates?.[0],
    );
    return {
      id: `gemini_${modelId}`,
      providerId: 'gemini',
      modelId,
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason: terminalFinish({ sawToolCalls: toolCalls.length > 0, rawFinish, sawText: text.length > 0 }),
      ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
      ...(usage ? { usage } : {}),
    };
  }
}
