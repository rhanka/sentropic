import { getSecretAuthMaterial } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { MuseAdapterClient } from '../adapters.js';
import type { ProviderRuntimeContext } from '../registry.js';
import { requalifyResponseToolName, responsesCarrierOf } from '../responses-wire.js';
import type { FinishReason, StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

/** Canonical terminal reason: provider finish_reason wins over inference (spec §16.4). */
const terminalFinish = (args: { sawToolCalls: boolean; rawFinish?: string; sawText: boolean }): FinishReason => {
  if (args.sawToolCalls || args.rawFinish === 'tool_calls') return 'tool_calls';
  if (args.rawFinish === 'length') return 'length';
  if (args.rawFinish === 'content_filter') return 'content_filter';
  return args.sawText ? 'stop' : 'unknown';
};

/** Latest string `choices[0].finish_reason` on a Chat JSON/SSE payload, if any. */
const rawFinishOf = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object') return undefined;
  const reason = (first as Record<string, unknown>).finish_reason;
  return typeof reason === 'string' && reason ? reason : undefined;
};

/** Decode OpenAI Chat `message.tool_calls` — malformed entries are skipped, never fatal (spec §16.3). */
const extractToolCalls = (message: unknown): ToolCall[] => {
  if (!message || typeof message !== 'object') return [];
  const calls = (message as Record<string, unknown>).tool_calls;
  if (!Array.isArray(calls)) return [];
  const decoded: ToolCall[] = [];
  for (const entry of calls) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn = record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : {};
    if (typeof record.id !== 'string' || typeof fn.name !== 'string') continue;
    decoded.push({
      toolCallId: record.id,
      providerCallId: record.id,
      name: fn.name,
      argumentsText: typeof fn.arguments === 'string' ? fn.arguments : '',
    });
  }
  return decoded;
};

/** Decode OpenAI Chat SSE `choices[].delta.tool_calls[]` fragments keyed by stream index. */
const extractToolDeltas = (raw: unknown): Array<{ index: number; id?: string; name?: string; fragment: string }> => {
  if (!raw || typeof raw !== 'object') return [];
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const delta = (choices[0] as Record<string, unknown>)?.delta;
  if (!delta || typeof delta !== 'object') return [];
  const calls = (delta as Record<string, unknown>).tool_calls;
  if (!Array.isArray(calls)) return [];
  const out: Array<{ index: number; id?: string; name?: string; fragment: string }> = [];
  for (const entry of calls) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const index = typeof record.index === 'number' ? record.index : out.length;
    const fn = record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : {};
    const name = typeof fn.name === 'string' && fn.name ? fn.name : undefined;
    const id = typeof record.id === 'string' && record.id ? record.id : undefined;
    const fragment = typeof fn.arguments === 'string' ? fn.arguments : '';
    if (!id && !name && !fragment) continue;
    out.push({ index, id, name, fragment });
  }
  return out;
};

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

// Canonical ToolChoice uses { type: 'tool' }; the Chat Completions wire
// takes the nested OpenAI shape { type: 'function', function: { name } }
// (spec §16.4) — the flat { type: 'function', name } form is Responses-only.
// Strings pass through untouched.
const openAiToolChoice = (choice: GenerateRequest['toolChoice']): unknown =>
  choice && typeof choice === 'object' && choice.type === 'tool'
    ? { type: 'function', function: { name: choice.name } }
    : choice;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

// Canonical history onto the Chat Completions wire (spec §16.4, R4-MAJ-2):
// same projection rules as the Mistral translated client — developer maps to
// system, reasoning parts have no wire slot and are dropped, images map to
// the OpenAI-compat image_url shape, assistant tool calls project to
// { id, type: 'function', function: { name, arguments } }, tool results
// carry tool_call_id. Canonical extras (metadata.ingress, providerCallId,
// arguments object) never reach the wire.
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
    // Live Meta SSE chunks carry choices[].delta as an OBJECT
    // ({ content, role }), not a string — read .content (probed 2026-09-22;
    // the string-only read silently dropped every content delta).
    const delta = first.delta;
    if (typeof delta === 'string' && delta) return delta;
    if (delta && typeof delta === 'object') {
      const dContent = (delta as Record<string, unknown>).content;
      if (typeof dContent === 'string' && dContent) return dContent;
    }
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
    stream = false,
  ): Promise<Response> {
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || !('accessToken' in auth) || !auth.accessToken) {
      throw Object.assign(new Error('Muse account token is missing'), { status: 401 });
    }
    const metadata = 'metadata' in auth ? auth.metadata : undefined;
    const stableSessionId = typeof metadata?.stableSessionId === 'string'
      ? metadata.stableSessionId : undefined;
    // Live-probed 2026-09-22: Meta 400s mesh-shape tools; the serving wire
    // takes OpenAI function tools ({ function: { name, description,
    // parameters } }), so project them (200 with the projection).
    const openAiTools = request.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      },
    }));
    const body: Record<string, unknown> = {
      model: request.modelId ?? 'muse-spark-1.3',
      messages: request.messages.map(toWireMessage),
      // Live-probed 2026-09-22: without stream:true Meta answers 200 with a
      // full JSON completion (content-type application/json) — no SSE frames,
      // so the stream reader yields nothing and ends done/unknown.
      ...(stream ? { stream: true } : {}),
      ...(openAiTools?.length ? { tools: openAiTools } : {}),
      ...(request.toolChoice ? { tool_choice: openAiToolChoice(request.toolChoice) } : {}),
      ...(request.parallelToolCalls !== undefined
        ? { parallel_tool_calls: request.parallelToolCalls } : {}),
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
    const carrier = responsesCarrierOf(request.providerOptions);
    const response = await this.post(request, context, 'text/event-stream', true);
    if (!response.body) {
      const done: StreamEvent = { type: 'done', data: { finishReason: 'unknown' } };
      return (async function* (): AsyncGenerator<StreamEvent> { yield done; })();
    }
    return (async function* (): AsyncGenerator<StreamEvent> {
      let sawText = false;
      let sawToolCalls = false;
      let rawFinish: string | undefined;
      let stashedUsage: TokenUsage | undefined;
      const toolCallIds = new Map<number, string>();
      for await (const raw of parseSseJson(response.body!)) {
        const text = extractText(raw);
        const usage = extractUsage(raw);
        const finish = rawFinishOf(raw);
        if (finish) rawFinish = finish;
        if (text) {
          sawText = true;
          yield { type: 'content_delta', data: { delta: text } };
        }
        for (const toolDelta of extractToolDeltas(raw)) {
          const known = toolCallIds.get(toolDelta.index);
          const toolCallId = known ?? toolDelta.id ?? `muse-call-${toolDelta.index}`;
          if (!known) {
            toolCallIds.set(toolDelta.index, toolCallId);
            sawToolCalls = true;
            yield {
              type: 'tool_call_start',
              data: {
                toolCallId,
                providerCallId: toolDelta.id ?? toolCallId,
                name: requalifyResponseToolName(toolDelta.name ?? '', carrier),
                argumentsText: '',
              },
            };
            // A first fragment carrying only an id/name emits no empty
            // delta; argument text arrives as real fragments.
            if (!toolDelta.fragment) continue;
          } else if (!toolDelta.fragment && !toolDelta.name) {
            continue;
          }
          yield {
            type: 'tool_call_delta',
            data: {
              toolCallId,
              providerCallId: toolDelta.id ?? toolCallId,
              delta: toolDelta.fragment,
              ...(toolDelta.name ? { name: requalifyResponseToolName(toolDelta.name, carrier) } : {}),
            },
          };
        }
        if (usage) {
          // A usage-only chunk before any content/finish/terminal is
          // accounting, not a terminal stop (spec §16.4): stash and continue.
          if (!sawText && !sawToolCalls && !rawFinish) {
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
          finishReason: terminalFinish({ sawToolCalls, rawFinish, sawText }),
          ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
          ...(stashedUsage ? { usage: stashedUsage } : {}),
        },
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
    const firstChoice = payload && typeof payload === 'object'
      && Array.isArray((payload as Record<string, unknown>).choices)
      ? ((payload as Record<string, unknown>).choices as Array<unknown>)[0]
      : undefined;
    const choiceMessage = firstChoice && typeof firstChoice === 'object'
      ? (firstChoice as Record<string, unknown>).message
      : undefined;
    const carrier = responsesCarrierOf(request.providerOptions);
    const toolCalls = extractToolCalls(choiceMessage).map((call) => ({
      ...call, name: requalifyResponseToolName(call.name, carrier),
    }));
    const rawFinish = firstChoice && typeof firstChoice === 'object'
      ? textOf((firstChoice as Record<string, unknown>).finish_reason)
      : null;
    return {
      id,
      providerId: 'muse',
      modelId: request.modelId ?? 'muse-spark-1.3',
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls'
        : rawFinish === 'length' ? 'length'
        : rawFinish === 'content_filter' ? 'content_filter'
        : text ? 'stop' : 'unknown',
      ...(usage ? { usage } : {}),
      ...(rawFinish ? { providerRawFinishReason: rawFinish } : {}),
    };
  }
}
