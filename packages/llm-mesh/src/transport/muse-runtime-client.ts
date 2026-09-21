import { getSecretAuthMaterial } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { MuseAdapterClient } from '../adapters.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { StreamEvent, TokenUsage } from '../streaming.js';

export interface MuseRuntimeClientOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly originator?: string;
  readonly userAgent?: string;
}

// Serving wire facts [MEASURED] from static analysis of the installed muse
// CLI (ELF muse-bin-1.3.0-R3401.1, read-only): provider path
// /muse-code/models joined to the configured base URL (default
// https://api.meta.ai), Authorization: Bearer <api_key>, header slot
// x-meta-ai-gateway-session-id.
// [GAP] response schema: field extraction below tries the documented
// Anthropic/OpenAI-adjacent shapes first and falls back to the raw JSON;
// shapes observed live feed back here, nothing is asserted about Meta's.
const MUSE_DEFAULT_BASE_URL = 'https://api.meta.ai';
// Corrected by live probe (2026-09-21): POST /v1/chat/completions,
// OpenAI body, returns 402 billing_not_configured (exists + parsed).
// /muse-code/models is GET-only (models list).
const MUSE_SERVING_PATH = '/v1/chat/completions';

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const extractText = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  for (const key of ['output_text', 'text']) {
    const direct = textOf(record[key]);
    if (direct) return direct;
  }
  const message = record.message;
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string' && content) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            return textOf((part as Record<string, unknown>).text) ?? '';
          }
          return '';
        })
        .join('');
      if (text) return text;
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const inner = first.message ?? first;
    if (inner && typeof inner === 'object') {
      const content = (inner as Record<string, unknown>).content;
      if (typeof content === 'string' && content) return content;
    }
    const delta = textOf(first.delta);
    if (delta) return delta;
  }
  return '';
};

const extractUsage = (payload: unknown): TokenUsage | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const usage = record.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const inputTokens = numOf(u.input_tokens) ?? numOf(u.inputTokens) ?? numOf(u.prompt_tokens);
  const outputTokens = numOf(u.output_tokens) ?? numOf(u.outputTokens) ?? numOf(u.completion_tokens);
  const totalTokens = numOf(u.total_tokens) ?? numOf(u.totalTokens);
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
        if (payload && payload !== '[DONE]') {
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

export class MuseRuntimeClient implements MuseAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly originator: string;
  private readonly userAgent: string;

  constructor(options: MuseRuntimeClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? MUSE_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.originator = options.originator ?? 'sentropic-llm-mesh';
    this.userAgent = options.userAgent ?? '@sentropic/llm-mesh';
  }

  private async post(
    request: GenerateRequest,
    context: ProviderRuntimeContext | undefined,
    accept: string,
  ): Promise<Response> {
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || !('accessToken' in auth) || !auth.accessToken) {
      throw Object.assign(new Error('Muse account token is missing'), { status: 401 });
    }
    const metadata = 'metadata' in auth ? auth.metadata : undefined;
    const stableSessionId = typeof metadata?.stableSessionId === 'string'
      ? metadata.stableSessionId : undefined;
    const body: Record<string, unknown> = {
      model: request.modelId ?? 'muse-spark-1.3',
      messages: request.messages,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    };
    const response = await this.fetchFn(`${this.baseUrl}${MUSE_SERVING_PATH}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
        accept,
        originator: this.originator,
        'user-agent': this.userAgent,
        ...(stableSessionId ? { 'x-meta-ai-gateway-session-id': stableSessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Key never enters the message: status + retry hint only.
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(`Muse HTTP error (${response.status})`), {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1_000 }
          : {}),
      });
    }
    return response;
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const response = await this.post(request, context, 'text/event-stream');
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
    const id = rawId ?? 'muse_response';
    return {
      id,
      providerId: 'muse',
      modelId: request.modelId ?? 'muse-spark-1.3',
      message: { role: 'assistant', content: text },
      text,
      toolCalls: [],
      finishReason: text ? 'stop' : 'unknown',
      ...(usage ? { usage } : {}),
    };
  }
}
