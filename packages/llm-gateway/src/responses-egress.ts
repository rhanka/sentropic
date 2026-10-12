/**
 * Responses egress shared builders (spec §16.5): the item/usage/terminal
 * constructors used by both the JSON envelope and the SSE encoder. Pure
 * functions — bounds enforcement and event lifecycle live in the accumulator
 * below and in `responses-stream.ts`. Nothing here fabricates counts or ids.
 */
import type {
  FinishReason,
  GenerateResponse,
  StreamEvent,
  TokenUsage,
  ToolCall,
} from '@sentropic/llm-mesh';

/** Engineering-default output bounds (spec §16.7); a stricter host limit wins. */
export interface ResponsesLimits {
  readonly maxOutputItems: number;
  readonly maxAccumulatedBytes: number;
}

export const DEFAULT_RESPONSES_LIMITS: ResponsesLimits = {
  maxOutputItems: 1024,
  maxAccumulatedBytes: 8_388_608,
};

/** Overflow or protocol breach: aborts upstream and fails neutrally, never truncates silently. */
export class ResponsesBoundError extends Error {
  readonly code: 'responses_overflow' | 'responses_protocol';
  constructor(code: ResponsesBoundError['code'], message: string) {
    super(message);
    this.name = 'ResponsesBoundError';
    this.code = code;
  }
}

export type ResponsesStatus = 'completed' | 'incomplete' | 'failed';

export const responsesTerminal = (finishReason: FinishReason): {
  status: ResponsesStatus;
  incomplete_details: { reason: string } | null;
} => {
  if (finishReason === 'length') {
    return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
  }
  if (finishReason === 'content_filter') {
    return { status: 'incomplete', incomplete_details: { reason: 'content_filter' } };
  }
  if (finishReason === 'error' || finishReason === 'cancelled' || finishReason === 'unknown') {
    return { status: 'failed', incomplete_details: null };
  }
  return { status: 'completed', incomplete_details: null };
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

const finiteOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Provider usage mapped to the Responses shape with native detail preserved
 * through `providerRawUsage` (cached input tokens, reasoning output
 * tokens). Total is provider-reported or computed from known components.
 * Fully unknown usage is null — never a fabricated exact zero.
 */
export const responsesUsage = (usage?: TokenUsage): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
} | null => {
  if (!usage) return null;
  const raw = asRecord(usage.providerRawUsage) ?? {};
  const cached = finiteOrUndefined(asRecord(raw.input_tokens_details)?.cached_tokens);
  const reasoning = usage.reasoningTokens
    ?? finiteOrUndefined(asRecord(raw.output_tokens_details)?.reasoning_tokens);
  const input = usage.inputTokens ?? finiteOrUndefined(raw.input_tokens);
  const output = usage.outputTokens ?? finiteOrUndefined(raw.output_tokens);
  const total = usage.totalTokens ?? finiteOrUndefined(raw.total_tokens)
    ?? (input !== undefined && output !== undefined ? input + output : undefined);
  if (input === undefined && output === undefined && total === undefined) return null;
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: total ?? (input ?? 0) + (output ?? 0),
    ...(cached !== undefined ? { input_tokens_details: { cached_tokens: cached } } : {}),
    ...(reasoning !== undefined ? { output_tokens_details: { reasoning_tokens: reasoning } } : {}),
  };
};

export const messageItem = (id: string, text: string): Record<string, unknown> => ({
  type: 'message', id, role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }],
});

export const functionCallItem = (id: string, call: Pick<ToolCall, 'toolCallId' | 'providerCallId' | 'name' | 'argumentsText'>): Record<string, unknown> => ({
  type: 'function_call', id, call_id: call.providerCallId ?? call.toolCallId,
  name: call.name, arguments: call.argumentsText,
});

export const reasoningItem = (id: string, summaryText: string): Record<string, unknown> => ({
  type: 'reasoning', id, summary: [{ type: 'summary_text', text: summaryText }],
});

export interface ResponsesSnapshot {
  readonly items: readonly Record<string, unknown>[];
  readonly terminal: { finishReason: FinishReason };
  readonly usage?: TokenUsage;
  readonly failure?: { message: string; code?: string; type?: string };
}

export interface ResponsesAccumulator {
  observe(event: StreamEvent): void;
  ingest(response: GenerateResponse): void;
  snapshot(): ResponsesSnapshot;
}

/**
 * Shared bounded output accumulator for the JSON envelope and the SSE
 * encoder (spec §16.5): first-observation allocation with stable ids,
 * snapshot-wins dedup, bounded growth. Overflow or unknown call ids throw
 * `ResponsesBoundError` — abort upstream and fail neutrally.
 */
export const createResponsesAccumulator = (
  limits: ResponsesLimits = DEFAULT_RESPONSES_LIMITS,
): ResponsesAccumulator => {
  let text = '';
  const calls = new Map<string, { providerCallId?: string; name: string; args: string }>();
  const order: Array<{ kind: 'message' | 'tool'; key: string }> = [];
  let bytes = 0;
  let messageCount = 0;
  let toolCount = 0;
  let terminal: { finishReason: FinishReason } = { finishReason: 'unknown' };
  let usage: TokenUsage | undefined;
  let failure: ResponsesSnapshot['failure'];

  const itemCount = () => (text ? 1 : 0) + calls.size;

  const checkBounds = (growth: number, extraItems: number): void => {
    if (itemCount() + extraItems > limits.maxOutputItems) {
      throw new ResponsesBoundError('responses_overflow', 'responses output item cap exceeded');
    }
    if (bytes + growth > limits.maxAccumulatedBytes) {
      throw new ResponsesBoundError('responses_overflow', 'responses accumulated output cap exceeded');
    }
    bytes += growth;
  };

  const observe = (event: StreamEvent): void => {
    if (event.type === 'content_delta') {
      const added = text ? 0 : 1;
      checkBounds(event.data.delta.length, added);
      if (!text) order.push({ kind: 'message', key: '' });
      text += event.data.delta;
    } else if (event.type === 'tool_call_start') {
      const current = calls.get(event.data.toolCallId);
      const args = event.data.argumentsText ?? '';
      if (current) {
        if (args) {
          checkBounds(args.length, 0);
          bytes -= current.args.length;
          current.args = args;
        }
      } else {
        checkBounds(args.length, 1);
        order.push({ kind: 'tool', key: event.data.toolCallId });
        calls.set(event.data.toolCallId, {
          ...(event.data.providerCallId ? { providerCallId: event.data.providerCallId } : {}),
          name: event.data.name,
          args,
        });
      }
    } else if (event.type === 'tool_call_delta') {
      const current = calls.get(event.data.toolCallId);
      if (!current) {
        throw new ResponsesBoundError(
          'responses_protocol',
          `responses delta for unknown tool call ${event.data.toolCallId}`,
        );
      }
      checkBounds(event.data.delta.length, 0);
      current.args += event.data.delta;
    } else if (event.type === 'done') {
      terminal = { finishReason: event.data.finishReason ?? 'unknown' };
      if (event.data.usage) usage = event.data.usage;
    } else if (event.type === 'error') {
      terminal = { finishReason: 'error' };
      failure = {
        message: event.data.message,
        ...(event.data.code ? { code: event.data.code } : {}),
      };
    }
  };

  const ingest = (response: GenerateResponse): void => {
    const content = response.message.content;
    const incomingText = typeof content === 'string' ? content : content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('');
    if (incomingText) {
      checkBounds(incomingText.length, text ? 0 : 1);
      if (!text) order.push({ kind: 'message', key: '' });
      text = incomingText;
    }
    for (const call of response.toolCalls) {
      if (calls.has(call.toolCallId)) continue;
      checkBounds(call.argumentsText.length, 1);
      order.push({ kind: 'tool', key: call.toolCallId });
      calls.set(call.toolCallId, {
        ...(call.providerCallId ? { providerCallId: call.providerCallId } : {}),
        name: call.name,
        args: call.argumentsText,
      });
    }
    terminal = { finishReason: response.finishReason };
    if (response.usage) usage = response.usage;
  };

  const snapshot = (): ResponsesSnapshot => {
    const items: Record<string, unknown>[] = [];
    for (const entry of order) {
      if (entry.kind === 'message') {
        if (!text) continue;
        items.push(messageItem(`msg_${messageCount++}`, text));
      } else {
        const call = calls.get(entry.key);
        if (!call) continue;
        items.push(functionCallItem(`fc_${toolCount++}`, {
          toolCallId: entry.key, ...(call.providerCallId ? { providerCallId: call.providerCallId } : {}),
          name: call.name, argumentsText: call.args,
        }));
      }
    }
    return {
      items,
      terminal,
      ...(usage ? { usage } : {}),
      ...(failure ? { failure } : {}),
    };
  };

  return { observe, ingest, snapshot };
};
