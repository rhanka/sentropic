import type { GeminiAdapterClient } from '../adapters.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { FinishReason, StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

export interface GeminiApiKeyRuntimeClientOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly modelId?: string;
  readonly originator?: string;
  readonly userAgent?: string;
}

// Serving wire facts [DOCUMENTED] from the Generative Language API
// (generativelanguage.googleapis.com): POST
// /v1beta/models/{model}:generateContent, header
// `x-goog-api-key: <api_key>`, request body
// { contents: [{ role, parts }], systemInstruction?, tools?, toolConfig?,
// generationConfig? }, response
// { candidates: [{ content: { parts }, finishReason }], usageMetadata? }.
const GEMINI_API_KEY_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_API_KEY_DEFAULT_MODEL_ID = 'gemini-3.8-flash';

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasHeaderValue = (value: string): boolean =>
  value.trim().length > 0 && !/[\r\n]/.test(value);

// Mesh history projected onto the GenerateContent wire: system/developer
// messages become the systemInstruction, user/assistant/tool messages become
// contents. Reasoning parts map to thought parts; images to inlineData;
// file parts without bytes are omitted (no documented file-uri slot).
const toWireParts = (message: LlmMeshMessage): Array<Record<string, unknown>> => {
  if (typeof message.content === 'string') return [{ text: message.content }];
  const parts: Array<Record<string, unknown>> = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
    } else if (part.type === 'reasoning') {
      parts.push({
        text: part.text,
        thought: true,
        ...(part.signature ? { thoughtSignature: part.signature } : {}),
      });
    } else if (part.type === 'image') {
      if (part.data) {
        parts.push({ inlineData: { mimeType: part.mediaType ?? 'image/png', data: part.data } });
      } else if (part.url) {
        parts.push({ fileData: { mimeType: part.mediaType ?? 'image/png', fileUri: part.url } });
      }
    } else if (part.data) {
      parts.push({ inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } });
    }
  }
  return parts;
};

const toWireContents = (messages: readonly LlmMeshMessage[]): Array<Record<string, unknown>> => {
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.toolResult.name ?? 'tool',
            response: message.toolResult.output ?? null,
          },
        }],
      });
      continue;
    }
    const parts = toWireParts(message);
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        let args: unknown = null;
        try {
          args = call.arguments ?? JSON.parse(call.argumentsText);
        } catch {
          args = call.argumentsText;
        }
        parts.push({ functionCall: { name: call.name, args: asRecord(args) ?? {} } });
      }
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
};

const toWireBody = (request: GenerateRequest): Record<string, unknown> => {
  const systemParts = request.messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .flatMap(toWireParts);
  const functionDeclarations = request.tools?.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
  }));
  const toolChoice = request.toolChoice;
  return {
    contents: toWireContents(request.messages),
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(functionDeclarations?.length ? { tools: [{ functionDeclarations }] } : {}),
    ...(toolChoice === 'none'
      ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } }
      : toolChoice === 'required' || (typeof toolChoice === 'object' && toolChoice.type === 'tool')
        ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
              ...(typeof toolChoice === 'object'
                ? { allowedFunctionNames: [toolChoice.name] }
                : {}),
            },
          },
        }
        : {}),
    generationConfig: {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.responseFormat?.type === 'json-object' || request.responseFormat?.type === 'json-schema'
        ? { responseMimeType: 'application/json' }
        : {}),
      ...(request.responseFormat?.type === 'json-schema'
        ? { responseSchema: request.responseFormat.schema }
        : {}),
    },
  };
};

const candidateOf = (payload: unknown): Record<string, unknown> | null => {
  const record = asRecord(payload);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return asRecord(candidates[0]);
};

const extractText = (payload: unknown): string => {
  const parts = asRecord(asRecord(candidateOf(payload))?.content)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => textOf(asRecord(part)?.text) ?? '')
    .join('');
};

const extractToolCalls = (payload: unknown): ToolCall[] => {
  const parts = asRecord(asRecord(candidateOf(payload))?.content)?.parts;
  if (!Array.isArray(parts)) return [];
  const calls: ToolCall[] = [];
  for (const part of parts) {
    const call = asRecord(asRecord(part)?.functionCall);
    if (!call || typeof call.name !== 'string' || !call.name) continue;
    const args = 'args' in call ? call.args : undefined;
    const argumentsText = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    const toolCallId = `gemini-apikey-call-${calls.length}`;
    calls.push({
      toolCallId,
      providerCallId: toolCallId,
      name: call.name,
      argumentsText,
      ...(typeof args === 'object' && args !== null ? { arguments: args } : {}),
    });
  }
  return calls;
};

const rawFinishOf = (payload: unknown): string | null => {
  const finish = asRecord(candidateOf(payload))?.finishReason;
  return typeof finish === 'string' && finish ? finish : null;
};

const finishOf = (rawFinish: string | null, sawToolCalls: boolean, text: string): FinishReason => {
  if (sawToolCalls) return 'tool_calls';
  if (rawFinish === 'MAX_TOKENS') return 'length';
  if (rawFinish === 'SAFETY' || rawFinish === 'BLOCKLIST' || rawFinish === 'PROHIBITED_CONTENT') {
    return 'content_filter';
  }
  return text ? 'stop' : 'unknown';
};

const extractUsage = (payload: unknown): TokenUsage | undefined => {
  const usage = asRecord(asRecord(payload)?.usageMetadata);
  if (!usage) return undefined;
  const inputTokens = numOf(usage.promptTokenCount);
  const outputTokens = numOf(usage.candidatesTokenCount);
  const totalTokens = numOf(usage.totalTokenCount);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    providerRawUsage: payload,
  };
};

interface ClassifiedFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

// Fixed messages only: the provider body and the key never enter errors.
const classifyFailure = (status: number, body: unknown): ClassifiedFailure => {
  const error = asRecord(asRecord(body)?.error);
  const code = textOf(error?.code) ?? textOf(error?.status) ?? '';
  const normalized = code.toUpperCase();
  if (status === 429 || normalized === 'RESOURCE_EXHAUSTED' || normalized.includes('RATE_LIMIT')) {
    return { status: 429, code: 'rate_limited', message: 'Gemini API key rate limit exceeded (429)' };
  }
  if (status === 402 || normalized.includes('BILLING') || normalized === 'FAILED_PRECONDITION') {
    return {
      status: 402,
      code: 'billing_unavailable',
      message: 'Gemini API key billing unavailable (402): prepayment credits are depleted',
    };
  }
  if (status === 401 || status === 403
    || normalized === 'UNAUTHENTICATED' || normalized === 'PERMISSION_DENIED') {
    return { status, code: 'auth_failed', message: `Gemini API key authentication failed (${status})` };
  }
  return { status, code: 'http_error', message: `Gemini API key HTTP error (${status})` };
};

export class GeminiApiKeyRuntimeClient implements GeminiAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly apiKey: string;
  private readonly originator: string;
  private readonly userAgent: string;

  constructor(options: GeminiApiKeyRuntimeClientOptions) {
    if (!hasHeaderValue(options.apiKey)) {
      throw Object.assign(new Error('Gemini API key is missing'), { status: 401, code: 'auth_failed' });
    }
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? GEMINI_API_KEY_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.modelId = options.modelId ?? GEMINI_API_KEY_DEFAULT_MODEL_ID;
    this.originator = options.originator ?? 'sentropic-llm-mesh';
    this.userAgent = options.userAgent ?? '@sentropic/llm-mesh';
  }

  private async post(request: GenerateRequest, modelId: string): Promise<Response> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'x-goog-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
        originator: this.originator,
        'user-agent': this.userAgent,
      },
      body: JSON.stringify(toWireBody(request)),
    });
    if (!response.ok) {
      // Key and provider prose never enter the message: status + code only.
      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch {
        body = undefined;
      }
      const failure = classifyFailure(response.status, body);
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(failure.message), {
        status: failure.status,
        code: failure.code,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1_000 }
          : {}),
      });
    }
    return response;
  }

  async generate(request: GenerateRequest, _context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const modelId = request.modelId ?? this.modelId;
    const response = await this.post(request, modelId);
    const payload: unknown = await response.json();
    const text = extractText(payload);
    const toolCalls = extractToolCalls(payload);
    const rawFinish = rawFinishOf(payload);
    const usage = extractUsage(payload);
    return {
      id: textOf(asRecord(payload)?.responseId) ?? 'gemini_apikey_response',
      providerId: 'gemini',
      modelId,
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason: finishOf(rawFinish, toolCalls.length > 0, text),
      ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const response = await this.generate(request, context);
    return (async function* (): AsyncGenerator<StreamEvent> {
      if (response.text) {
        yield { type: 'content_delta', data: { delta: response.text } };
      }
      for (const call of response.toolCalls) {
        yield { type: 'tool_call_start', data: call };
      }
      yield {
        type: 'done',
        data: {
          finishReason: response.finishReason,
          ...(response.providerRawFinishReason
            ? { providerRawFinishReason: response.providerRawFinishReason }
            : {}),
          ...(response.usage ? { usage: response.usage } : {}),
        },
      };
    })();
  }
}

export const createGeminiApiKeyClient = (
  apiKeyOrOptions: string | GeminiApiKeyRuntimeClientOptions,
  rest: Partial<GeminiApiKeyRuntimeClientOptions> = {},
): GeminiApiKeyRuntimeClient => {
  if (typeof apiKeyOrOptions === 'string') {
    return new GeminiApiKeyRuntimeClient({ ...rest, apiKey: apiKeyOrOptions });
  }
  return new GeminiApiKeyRuntimeClient({ ...rest, ...apiKeyOrOptions });
};
