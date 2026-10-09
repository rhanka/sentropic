import { getSecretAuthMaterial } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { MistralAdapterClient } from '../adapters.js';
import type { LlmMeshMessage } from '../messages.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { StreamEvent, TokenUsage } from '../streaming.js';

export interface MistralRuntimeClientOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly originator?: string;
  readonly userAgent?: string;
}

// Serving wire facts [DOCUMENTED] from the Mistral API reference
// (api.mistral.ai, OpenAI-compatible chat completions): POST
// /v1/chat/completions, Authorization: Bearer <api_key>, request body
// { model, messages, stream?, tools?, tool_choice?, max_tokens?,
// temperature?, top_p? }, non-stream response
// { id, choices: [{ message: { content } }], usage },
// SSE chunks { choices: [{ delta: { content } }], usage? }.
// The mistral-vibe account transport mints a regular Mistral API key
// (long-lived, billed against the signed-in plan's Vibe Code quota), so the
// runtime credential is that key as the Bearer token.
const MISTRAL_DEFAULT_BASE_URL = 'https://api.mistral.ai';
const MISTRAL_SERVING_PATH = '/v1/chat/completions';

// [MEASURED] api.mistral.ai enforces a strict chat message schema (live 422
// extra_forbidden on body.messages[0].user.metadata): the gateway's canonical
// ingress attaches mesh-internal metadata to every message, which Meta
// tolerates but Mistral rejects. Project each mesh message onto the
// documented wire fields (role/content/name/tool_calls/tool_call_id) and drop
// everything else. The 'developer' role has no Mistral wire slot and maps to
// 'system'. Image parts map to the OpenAI-compat image_url shape; file parts
// have no documented chat-completions slot and are omitted (not silently
// re-encoded); provider-originated reasoning history is not a wire input.
type WireContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const toWireMessage = (message: LlmMeshMessage): Record<string, unknown> => {
  const content = typeof message.content === 'string'
    ? message.content
    : message.content
        .map((part): WireContentPart | null => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'reasoning') return null;
          if (part.type === 'image') {
            const url = part.url ?? `data:${part.mediaType ?? 'image/png'};base64,${part.data ?? ''}`;
            return { type: 'image_url', image_url: { url } };
          }
          return null;
        })
        .filter((part): part is WireContentPart => part !== null);
  const wire: Record<string, unknown> = {
    role: message.role === 'developer' ? 'system' : message.role,
    content,
  };
  if (message.name !== undefined) wire.name = message.name;
  if (message.role === 'assistant' && message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.toolCallId,
      type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText },
    }));
  }
  if (message.role === 'tool' && message.toolResult) {
    wire.tool_call_id = message.toolResult.toolCallId;
  }
  return wire;
};

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const extractText = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as Record<string, unknown>;
  const message = first.message;
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string' && content) return content;
  }
  const delta = first.delta;
  if (typeof delta === 'string' && delta) return delta;
  if (delta && typeof delta === 'object') {
    const dContent = (delta as Record<string, unknown>).content;
    if (typeof dContent === 'string' && dContent) return dContent;
  }
  return '';
};

const extractUsage = (payload: unknown): TokenUsage | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const usage = record.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const inputTokens = numOf(u.prompt_tokens) ?? numOf(u.input_tokens);
  const outputTokens = numOf(u.completion_tokens) ?? numOf(u.output_tokens);
  const totalTokens = numOf(u.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
};

const parseSseJson = async function* (
  body: ReadableStream<Uint8Array>,
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
        if (payload && payload) {
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

export class MistralRuntimeClient implements MistralAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly originator: string;
  private readonly userAgent: string;

  constructor(options: MistralRuntimeClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? MISTRAL_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.originator = options.originator ?? 'sentropic-llm-mesh';
    this.userAgent = options.userAgent ?? '@sentropic/llm-mesh';
  }

  private async post(
    request: GenerateRequest,
    context: ProviderRuntimeContext | undefined,
    accept: string,
    stream = false,
  ): Promise<Response> {
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || !('accessToken' in auth) || !auth.accessToken) {
      throw Object.assign(new Error('Mistral account token is missing'), { status: 401 });
    }
    // [DOCUMENTED] Mistral chat/completions takes OpenAI function tools
    // natively ({ function: { name, description, parameters } }); project the
    // mesh tool shape onto it (same projection as the muse wire).
    const openAiTools = request.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      },
    }));
    const body: Record<string, unknown> = {
      model: request.modelId ?? 'mistral-small-2603',
      messages: request.messages.map(toWireMessage),
      ...(stream ? { stream: true } : {}),
      ...(openAiTools?.length ? { tools: openAiTools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    };
    const response = await this.fetchFn(`${this.baseUrl}${MISTRAL_SERVING_PATH}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
        accept,
        originator: this.originator,
        'user-agent': this.userAgent,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Key never enters the message: status + retry hint only.
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(`Mistral HTTP error (${response.status})`), {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1_000 }
          : {}),
      });
    }
    return response;
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const response = await this.post(request, context, 'text/event-stream', true);
    if (!response.body) {
      const done: StreamEvent = { type: 'done', data: { finishReason: 'unknown' } };
      return (async function* (): AsyncGenerator<StreamEvent> { yield done; })();
    }
    return (async function* (): AsyncGenerator<StreamEvent> {
      let sawText = false;
      for await (const raw of parseSseJson(response.body!)) {
        const text = extractText(raw);
        const usage = extractUsage(raw);
        if (text) {
          sawText = true;
          yield { type: 'content_delta', data: { delta: text } };
        }
        if (usage) {
          yield {
            type: 'done',
            data: { finishReason: 'stop' as const, usage },
          };
          return;
        }
      }
      yield {
        type: 'done',
        data: { finishReason: sawText ? ('stop' as const) : ('unknown' as const) },
      };
    })();
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const response = await this.post(request, context, 'application/json');
    const payload: unknown = await response.json();
    const text = extractText(payload);
    const usage = extractUsage(payload);
    const rawId = payload && typeof payload === 'object'
      ? textOf((payload as Record<string, unknown>).id)
      : null;
    const id = rawId ?? 'mistral_response';
    return {
      id,
      providerId: 'mistral',
      modelId: request.modelId ?? 'mistral-small-2603',
      message: { role: 'assistant', content: text },
      text,
      toolCalls: [],
      finishReason: text ? 'stop' : 'unknown',
      ...(usage ? { usage } : {}),
    };
  }
}
