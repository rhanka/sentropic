/**
 * Responses egress shared builders (spec §16.5): the item/usage/terminal
 * constructors used by both the JSON envelope and the SSE encoder. Pure
 * functions — bounds enforcement and event lifecycle live in the accumulator
 * below and in `responses-stream.ts`. Nothing here fabricates counts or ids.
 */
import type { FinishReason, TokenUsage, ToolCall } from '@sentropic/llm-mesh';

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
