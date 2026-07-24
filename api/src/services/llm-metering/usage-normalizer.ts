/**
 * LLM metering — provider usage normalizer (Lot 3, usage envelope).
 *
 * Every provider reports token usage under its own key and casing. The metering hook only
 * ever sees the mesh `TokenUsage` shape, so the raw provider payload is normalized HERE,
 * at the app/mesh boundary, and never inside `@sentropic/llm-mesh` (ACCOUNT_TRANSPORTS D2
 * keeps the package provider-agnostic and DB-agnostic).
 *
 * Known shapes:
 * - OpenAI chat-completions / Mistral: `usage.{prompt_tokens,completion_tokens,total_tokens}`
 * - OpenAI responses: `usage.{input_tokens,output_tokens,total_tokens}`
 *   + `usage.output_tokens_details.reasoning_tokens`
 * - Anthropic: `usage.{input_tokens,output_tokens}`
 * - Gemini / GCP: `usageMetadata.{promptTokenCount,candidatesTokenCount,totalTokenCount}`
 *   + `usageMetadata.thoughtsTokenCount`
 * - Cohere v2: `usage.tokens.{input_tokens,output_tokens}` (also exposed as `meta.tokens`)
 *
 * Unknown or absent usage yields `undefined` — observe-only metering records a row with null
 * token counts rather than inventing an estimate.
 */

import type { TokenUsage } from '@sentropic/llm-mesh';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** Read a non-negative finite token count; anything else (null, NaN, string) is ignored. */
const toTokenCount = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
};

const firstTokenCount = (
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined => {
  if (!source) return undefined;
  for (const key of keys) {
    const count = toTokenCount(source[key]);
    if (count !== undefined) return count;
  }
  return undefined;
};

const INPUT_KEYS = ['input_tokens', 'prompt_tokens', 'promptTokenCount', 'inputTokens'] as const;
const OUTPUT_KEYS = [
  'output_tokens',
  'completion_tokens',
  'candidatesTokenCount',
  'outputTokens',
] as const;
const TOTAL_KEYS = ['total_tokens', 'totalTokenCount', 'totalTokens'] as const;
const REASONING_KEYS = ['reasoning_tokens', 'thoughtsTokenCount', 'reasoningTokens'] as const;

/**
 * Locate the record that actually carries the token counters.
 *
 * Cohere v2 nests them one level down (`usage.tokens`), so the nested record wins whenever the
 * outer one carries no recognizable input/output counter.
 */
const resolveUsageRecord = (raw: Record<string, unknown>): Record<string, unknown> | undefined => {
  const candidates = [raw.usage, raw.usageMetadata, isRecord(raw.meta) ? raw.meta.tokens : undefined];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const hasDirectCounter =
      firstTokenCount(candidate, INPUT_KEYS) !== undefined ||
      firstTokenCount(candidate, OUTPUT_KEYS) !== undefined;
    if (hasDirectCounter) return candidate;
    if (isRecord(candidate.tokens)) return candidate.tokens;
  }

  return undefined;
};

/**
 * Normalize a raw provider response (non-stream generate, or a stream's terminal payload) into
 * the mesh `TokenUsage` shape. Returns `undefined` when the payload carries no usable counter,
 * so callers can distinguish "provider reported nothing" from "provider reported zero".
 */
export const normalizeProviderUsage = (raw: unknown): TokenUsage | undefined => {
  if (!isRecord(raw)) return undefined;

  const usageRecord = resolveUsageRecord(raw);
  if (!usageRecord) return undefined;

  const inputTokens = firstTokenCount(usageRecord, INPUT_KEYS);
  const outputTokens = firstTokenCount(usageRecord, OUTPUT_KEYS);
  const reasoningTokens =
    firstTokenCount(usageRecord, REASONING_KEYS) ??
    firstTokenCount(
      isRecord(usageRecord.output_tokens_details) ? usageRecord.output_tokens_details : undefined,
      REASONING_KEYS,
    );
  const totalTokens =
    firstTokenCount(usageRecord, TOTAL_KEYS) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    providerRawUsage: usageRecord,
  };
};

/**
 * Coerce whatever a stream's terminal `done` event carries into the mesh `TokenUsage` shape.
 *
 * Two shapes reach this point: the OpenAI-responses path forwards the provider payload verbatim
 * (`{input_tokens, output_tokens, …}`), while the other provider loops already accumulate a
 * normalized `TokenUsage`. An already-normalized value is passed through untouched so the
 * accumulated counters are never dropped.
 */
export const toMeshTokenUsage = (value: unknown): TokenUsage | undefined => {
  if (!isRecord(value)) return undefined;

  const isAlreadyNormalized =
    toTokenCount(value.inputTokens) !== undefined ||
    toTokenCount(value.outputTokens) !== undefined ||
    toTokenCount(value.totalTokens) !== undefined ||
    toTokenCount(value.reasoningTokens) !== undefined;

  return isAlreadyNormalized ? (value as TokenUsage) : normalizeProviderUsage({ usage: value });
};

/**
 * Accumulate usage across a provider stream.
 *
 * Providers spread the counters over the stream instead of sending them once: Anthropic reports
 * input tokens on `message_start` and output tokens on `message_delta`, Gemini repeats a growing
 * `usageMetadata` on every chunk, Mistral/Cohere only attach it to the terminal event. Each
 * reported counter therefore OVERWRITES the previous one (the later value is the more complete),
 * while counters absent from this event are carried forward.
 *
 * Returns `previous` unchanged when the event carries no usage, so a stream that never reports
 * usage still ends with `undefined` rather than an invented zero.
 */
export const mergeStreamUsage = (
  previous: TokenUsage | undefined,
  rawEvent: unknown,
): TokenUsage | undefined => {
  const nested = isRecord(rawEvent)
    ? [rawEvent, rawEvent.message, rawEvent.delta, rawEvent.response]
    : [rawEvent];

  let merged = previous;
  for (const candidate of nested) {
    const usage = normalizeProviderUsage(candidate);
    if (!usage) continue;
    merged = { ...(merged ?? {}), ...usage };
  }

  return merged;
};
