import { getSecretAuthMaterial } from '../auth.js';
import { MUSE_REASONING_EFFORTS } from '../catalog.js';
import type { GenerateRequest, GenerateResponse, ReasoningEffort, StreamRequest, StreamResult } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { MuseAdapterClient } from '../adapters.js';
import type { ProviderRuntimeContext } from '../registry.js';
import { requalifyResponseToolName, responsesCarrierOf } from '../responses-wire.js';
import type { FinishReason, StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

export interface MuseRuntimeClientOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly originator?: string;
  readonly userAgent?: string;
}

// Serving wire facts [MEASURED] from static analysis of the installed muse
// CLI (ELF muse-bin-1.3.0-R3401.1, read-only) and a local header capture of
// muse 1.4.23 (2026-11-17): the client serves on POST /v1/responses joined
// to the configured base URL (default https://api.meta.ai), with
// Authorization: Bearer <api_key> and the client identity headers below.
// The legacy Chat path (/v1/chat/completions) refuses seat-billed keys with
// 403 client_attestation_denied under every header set, while the same seat
// key serves 200 on /v1/responses — so this client emulates the muse client
// wire-for-wire, the way Cloud Code emulates the agy client.
export const MUSE_CLIENT_VERSION = '1.4.23';
export const MUSE_CLIENT_USER_AGENT =
  `muse-build/${MUSE_CLIENT_VERSION} (non-interactive; linux-x86_64)`;
export const MUSE_CLIENT_ID = 'tbh:exec';

const MUSE_DEFAULT_BASE_URL = 'https://api.meta.ai';
const MUSE_SERVING_PATH = '/v1/responses';

// Reasoning wire [DOCUMENTED] 2026-11-22, re-checked 2026-11-23: the
// Responses body nests `reasoning: { effort, summary }` — official Meta
// Reasoning docs (https://dev.meta.ai/docs/reasoning: "nest it as
// `reasoning.effort`"; the top-level `reasoning_effort` spelling belongs
// to Chat Completions) and the installed muse CLI bundle
// (muse-bin-1.4.25-R9361.1), whose request field table carries
// `reasoning` with nested `effort`/`summary`. Per-model tiers live ONLY
// in catalog.ts (MUSE_REASONING_EFFORTS, the single source shared with
// the catalog supportedEfforts): official Meta docs cap
// muse-spark-1.3-contributor below `max`, and `none` returns HTTP 400.
const MUSE_REASONING_SUMMARIES: readonly string[] = ['auto', 'concise', 'detailed'];

// Mesh ladder rungs, exhaustively tied to generation.ts ReasoningEffort
// (a new rung fails compilation until this record is extended). Meta
// also serves `minimal` upstream, so a value outside this record is
// refused as a ladder limitation of this package, never as a model one.
const MESH_REASONING_EFFORT_LADDER: Record<ReasoningEffort, true> = {
  none: true, low: true, medium: true, high: true, xhigh: true, max: true,
};

interface MuseWireReasoning {
  effort?: ReasoningEffort;
  summary?: string;
}

const unsupportedReasoning = (message: string): Error => Object.assign(new Error(message), {
  status: 400, code: 'unsupported_projection', param: 'reasoning',
});

/**
 * Validate mesh reasoning controls onto the proven Responses slots. Only
 * `effort` and `summary` have a wire slot; `enabled`/`budgetTokens` and an
 * effort the served model does not support fail closed before any I/O.
 */
const resolveMuseReasoning = (request: GenerateRequest): MuseWireReasoning | undefined => {
  const reasoning = request.reasoning;
  if (!reasoning) return undefined;
  if (reasoning.enabled !== undefined) {
    throw unsupportedReasoning('Muse Responses cannot preserve reasoning.enabled');
  }
  if (reasoning.budgetTokens !== undefined) {
    throw unsupportedReasoning('Muse Responses cannot preserve reasoning.budgetTokens');
  }
  const { effort, summary } = reasoning;
  if (effort === undefined && summary === undefined) return undefined;
  if (summary !== undefined && !MUSE_REASONING_SUMMARIES.includes(summary)) {
    throw unsupportedReasoning(
      `Muse Responses does not support reasoning summary "${summary}" (supported: auto, concise, detailed)`,
    );
  }
  // Any reasoning control (effort or summary alone) requires a known
  // model. Object.hasOwn keeps inherited keys (`constructor`, `toString`,
  // `__proto__`) from reading through the prototype as a non-array.
  const modelId = request.modelId ?? 'muse-spark-1.3';
  if (!Object.hasOwn(MUSE_REASONING_EFFORTS, modelId)) {
    throw unsupportedReasoning(
      `Unknown Muse model ${modelId}: no reasoning controls are supported`,
    );
  }
  const supported = MUSE_REASONING_EFFORTS[modelId]!;
  if (effort !== undefined && !supported.includes(effort)) {
    throw unsupportedReasoning(Object.hasOwn(MESH_REASONING_EFFORT_LADDER, effort)
      ? `Muse model ${modelId} does not support reasoning effort "${effort}" (supported: ${supported.join(', ')})`
      : `Muse reasoning effort "${effort}" is outside the mesh ReasoningEffort ladder (supported by ${modelId}: ${supported.join(', ')})`);
  }
  return {
    ...(effort !== undefined ? { effort } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
};

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

// Canonical ToolChoice uses { type: 'tool' }; the Responses wire takes
// { type: 'function', name } (spec §16.4). Strings pass through untouched.
const responsesToolChoice = (choice: GenerateRequest['toolChoice']): unknown =>
  choice && typeof choice === 'object' && choice.type === 'tool'
    ? { type: 'function', name: choice.name }
    : choice;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const usageOf = (usage: unknown): TokenUsage | undefined => {
  const u = asRecord(usage);
  if (!u) return undefined;
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

// Canonical history onto the Responses wire (spec §16.4): system/developer
// text collects into `instructions`; other messages project to message items
// (input_text in, output_text out, input_image for images); assistant tool
// calls project to function_call items and tool results to
// function_call_output. Canonical extras (metadata.ingress, providerCallId
// duplication, arguments objects) never reach the wire.
const contentOf = (message: LlmMeshMessage): unknown => {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      return {
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: part.text,
      };
    }
    if (part.type === 'image') {
      const imageUrl = part.url ?? (part.data
        ? `data:${part.mediaType ?? 'application/octet-stream'};base64,${part.data}`
        : '');
      return { type: 'input_image', image_url: imageUrl };
    }
    const fileData = part.url ?? (part.data
      ? `data:${part.mediaType ?? 'application/octet-stream'};base64,${part.data}`
      : '');
    return { type: 'input_file', filename: part.filename, file_data: fileData };
  });
};

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value ?? ''); } catch { return String(value ?? ''); }
};

const buildResponsesBody = (
  request: GenerateRequest,
  stream: boolean,
  reasoning?: MuseWireReasoning,
): Record<string, unknown> => {
  const instructions: string[] = [];
  const input: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = typeof message.content === 'string'
        ? message.content
        : message.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('');
      if (text) instructions.push(text);
      continue;
    }
    if (message.role === 'tool' && message.toolResult) {
      input.push({
        type: 'function_call_output',
        call_id: message.toolResult.providerCallId ?? message.toolResult.toolCallId,
        output: stringify(message.toolResult.output),
      });
      continue;
    }
    input.push({ type: 'message', role: message.role, content: contentOf(message) });
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.providerCallId ?? call.toolCallId,
          name: call.name,
          arguments: call.argumentsText,
        });
      }
    }
  }
  // Live-probed 2026-09-22: Meta 400s mesh-shape tools; the Responses wire
  // takes flat function tools ({ type: 'function', name, parameters }).
  const tools = request.tools?.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
  }));
  return {
    model: request.modelId ?? 'muse-spark-1.3',
    ...(instructions.length ? { instructions: instructions.join('\n\n') } : {}),
    input,
    ...(stream ? { stream: true } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(request.toolChoice ? { tool_choice: responsesToolChoice(request.toolChoice) } : {}),
    ...(request.parallelToolCalls !== undefined
      ? { parallel_tool_calls: request.parallelToolCalls } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_output_tokens: request.maxOutputTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    ...(reasoning ? { reasoning } : {}),
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
    // Flush a trailing block that ends at EOF without a blank-line boundary.
    const tail = buffer
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (tail && tail !== '[DONE]') {
      try {
        yield JSON.parse(tail);
      } catch {
        yield tail;
      }
    }
  } finally {
    reader.releaseLock();
  }
};

interface DecodedTerminal {
  finishReason: FinishReason;
  usage?: TokenUsage;
  responseId?: string;
  observedServedModelId?: string;
  sawToolCalls: boolean;
}

/** Decode one Responses SSE event into canonical stream events. */
const decodeMuseEvent = (
  raw: unknown,
  carrier: ReturnType<typeof responsesCarrierOf>,
  state: { sawToolCalls: boolean; seenToolCallIds: Set<string> },
): StreamEvent[] => {
  const record = asRecord(raw);
  const type = typeof record?.type === 'string' ? record.type : '';
  if (type === 'response.created') {
    const response = asRecord(record?.response);
    const observedServedModelId = textOf(response?.model) ?? undefined;
    return [{
      type: 'status',
      data: {
        status: 'started', providerId: 'muse',
        ...(typeof response?.id === 'string' ? { providerResponseId: response.id } : {}),
        ...(observedServedModelId ? { metadata: { observedServedModelId } } : {}),
      },
    }];
  }
  if (type === 'response.output_text.delta' && typeof record?.delta === 'string') {
    return [{ type: 'content_delta', data: { delta: record.delta } }];
  }
  if (type === 'response.reasoning_summary_text.delta' && typeof record?.delta === 'string') {
    return [{ type: 'reasoning_delta', data: { delta: record.delta, kind: 'summary' } }];
  }
  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = asRecord(record?.item);
    if (item?.type === 'function_call') {
      state.sawToolCalls = true;
      const callId = String(item.call_id ?? item.id ?? '');
      // The done item repeats the added snapshot; emit one start per call.
      if (type === 'response.output_item.done' && state.seenToolCallIds.has(callId)) return [];
      state.seenToolCallIds.add(callId);
      return [{
        type: 'tool_call_start',
        data: {
          toolCallId: callId,
          providerCallId: callId,
          name: requalifyResponseToolName(String(item.name ?? ''), carrier),
          argumentsText: String(item.arguments ?? ''),
        },
      }];
    }
    if (item?.type === 'reasoning' && Array.isArray(item.summary)) {
      const text = item.summary
        .map((part) => {
          const entry = asRecord(part);
          return entry?.type === 'summary_text' && typeof entry.text === 'string'
            ? entry.text
            : '';
        })
        .join('');
      if (text) return [{ type: 'reasoning_delta', data: { delta: text, kind: 'summary_done' } }];
    }
    return [];
  }
  if (type === 'response.function_call_arguments.delta' && typeof record?.delta === 'string') {
    return [{
      type: 'tool_call_delta',
      data: {
        toolCallId: String(record.call_id ?? record.item_id ?? ''),
        ...(record.call_id ? { providerCallId: String(record.call_id) } : {}),
        delta: record.delta,
      },
    }];
  }
  if (type === 'error' || type === 'response.failed') {
    const failure = asRecord(record?.error) ?? asRecord(asRecord(record?.response)?.error);
    return [{
      type: 'error',
      data: {
        providerId: 'muse',
        message: String(failure?.message ?? 'Muse request failed'),
        code: String(failure?.code ?? type),
        retryable: Boolean(failure?.retryable),
      },
    }];
  }
  return [];
};

const terminalOf = (raw: unknown, sawToolCalls: boolean): DecodedTerminal | undefined => {
  const record = asRecord(raw);
  const type = typeof record?.type === 'string' ? record.type : '';
  if (type !== 'response.completed' && type !== 'response.incomplete') return undefined;
  const response = asRecord(record?.response);
  const usage = usageOf(response?.usage);
  const observedServedModelId = textOf(response?.model) ?? undefined;
  const hasToolCall = Array.isArray(response?.output)
    && response.output.some((item) => asRecord(item)?.type === 'function_call');
  let finishReason: FinishReason = hasToolCall || sawToolCalls ? 'tool_calls' : 'stop';
  if (type === 'response.incomplete') {
    const reason = asRecord(response?.incomplete_details)?.reason;
    finishReason = reason === 'max_output_tokens' ? 'length'
      : reason === 'content_filter' ? 'content_filter' : 'unknown';
  }
  return {
    finishReason,
    ...(usage ? { usage } : {}),
    ...(typeof response?.id === 'string' ? { responseId: response.id } : {}),
    ...(observedServedModelId ? { observedServedModelId } : {}),
    sawToolCalls: hasToolCall || sawToolCalls,
  };
};

export class MuseRuntimeClient implements MuseAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly originator?: string;
  private readonly userAgent: string;

  constructor(options: MuseRuntimeClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? MUSE_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.originator = options.originator;
    this.userAgent = options.userAgent ?? MUSE_CLIENT_USER_AGENT;
  }

  private async post(
    request: GenerateRequest,
    context: ProviderRuntimeContext | undefined,
    accept: string,
    stream = false,
  ): Promise<Response> {
    const reasoning = resolveMuseReasoning(request);
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || !('accessToken' in auth) || !auth.accessToken) {
      throw Object.assign(new Error('Muse account token is missing'), { status: 401, code: 'AUTHENTICATION_FAILED' });
    }
    const metadata = 'metadata' in auth ? auth.metadata : undefined;
    const stableSessionId = typeof metadata?.stableSessionId === 'string'
      ? metadata.stableSessionId : undefined;
    const response = await this.fetchFn(`${this.baseUrl}${MUSE_SERVING_PATH}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
        accept,
        'user-agent': this.userAgent,
        'x-client-id': MUSE_CLIENT_ID,
        ...(this.originator ? { originator: this.originator } : {}),
        ...(stableSessionId ? {
          'x-meta-ai-gateway-session-id': stableSessionId,
          'x-tbh-session-id': stableSessionId,
          'x-tbh-thread-id': stableSessionId,
          'x-tbh-root-session-id': stableSessionId,
        } : {}),
      },
      body: JSON.stringify(buildResponsesBody(request, stream, reasoning)),
    });
    if (!response.ok) {
      // Key never enters the message: status + retry hint only. A 401/403
      // is an auth rejection (expired or revoked key), never a transport
      // failure: carry the typed code so consumers map it to reauth.
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(`Muse HTTP error (${response.status})`), {
        status: response.status,
        ...((response.status === 401 || response.status === 403)
          ? { code: 'AUTHENTICATION_FAILED' }
          : {}),
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
      const state = { sawToolCalls: false, seenToolCallIds: new Set<string>() };
      let terminal: DecodedTerminal | undefined;
      let observedServedModelId: string | undefined;
      let failed = false;
      for await (const raw of parseSseJson(response.body!)) {
        const done = terminalOf(raw, state.sawToolCalls);
        if (done) {
          terminal = done;
          if (done.observedServedModelId) observedServedModelId = done.observedServedModelId;
          continue;
        }
        for (const event of decodeMuseEvent(raw, carrier, state)) {
          if (event.type === 'status') {
            const served = event.data.metadata?.observedServedModelId;
            if (typeof served === 'string') observedServedModelId = served;
          }
          if (event.type === 'error') failed = true;
          yield event;
        }
        if (failed) return;
      }
      // Spec §16.4 (R4-MIN-3): only a provider terminal (response.completed /
      // response.incomplete) is a served completion. A truncated close is
      // `unknown`, never a `stop` success.
      yield {
        type: 'done',
        data: {
          finishReason: terminal?.finishReason ?? 'unknown',
          ...(terminal?.responseId ? { providerResponseId: terminal.responseId } : {}),
          ...(terminal?.usage ? { usage: terminal.usage } : {}),
          ...(observedServedModelId ? { metadata: { observedServedModelId } } : {}),
        },
      };
    })();
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const response = await this.post(request, context, 'application/json');
    const payload: unknown = await response.json();
    const record = asRecord(payload);
    const carrier = responsesCarrierOf(request.providerOptions);
    const output = Array.isArray(record?.output) ? record.output : [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const item of output) {
      const entry = asRecord(item);
      if (!entry) continue;
      if (entry.type === 'message' && Array.isArray(entry.content)) {
        for (const part of entry.content) {
          const content = asRecord(part);
          if (content?.type === 'output_text' && typeof content.text === 'string') {
            text += content.text;
          }
        }
      }
      if (entry.type === 'function_call') {
        const callId = textOf(entry.call_id) ?? textOf(entry.id);
        const name = textOf(entry.name);
        if (!callId || !name) continue;
        toolCalls.push({
          toolCallId: callId,
          providerCallId: callId,
          name: requalifyResponseToolName(name, carrier),
          argumentsText: typeof entry.arguments === 'string' ? entry.arguments : '',
        });
      }
    }
    if (!text) {
      const direct = textOf(record?.output_text) ?? textOf(record?.text);
      if (direct) text = direct;
    }
    const usage = usageOf(record?.usage);
    const observedServedModelId = textOf(record?.model) ?? undefined;
    const incompleteReason = asRecord(record?.incomplete_details)?.reason;
    const finishReason: FinishReason = toolCalls.length > 0 ? 'tool_calls'
      : record?.status === 'incomplete'
        ? incompleteReason === 'max_output_tokens' ? 'length'
          : incompleteReason === 'content_filter' ? 'content_filter' : 'unknown'
        : text ? 'stop' : 'unknown';
    return {
      id: textOf(record?.id) ?? 'muse_response',
      providerId: 'muse',
      modelId: request.modelId ?? 'muse-spark-1.3',
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason,
      ...(usage ? { usage } : {}),
      ...(observedServedModelId ? { providerMetadata: { observedServedModelId } } : {}),
    };
  }
}
