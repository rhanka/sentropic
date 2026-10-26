import type { DecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionAdapterResult } from './adapter.js';
import { createDecisionError } from './errors.js';
import { unreportedDecisionUsage } from './receipt.js';
import { sanitizeJevId } from './jev-response.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';
import { encodeOpenAiDecisionsRequest } from './openai-request.js';
import { decodeOpenAiDecisionsVerdict } from './openai-verdict.js';
export { encodeOpenAiDecisionsRequest } from './openai-request.js';

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Independently validate usage and identity even when the named answer is refused. */
export function decodeOpenAiDecisionsResponse(candidate: unknown, request: DecisionRequest,
  descriptor: DecisionEvaluatorDescriptor, requestId?: unknown): DecisionAdapterResult {
  const snapshot = snapshotBoundedJson(candidate);
  const body = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : null;
  const native = isRecord(body?.usage) ? body.usage : {};
  const input = count(native.input_tokens) ? native.input_tokens : null;
  const output = count(native.output_tokens) ? native.output_tokens : null;
  const sum = input !== null && output !== null && count(input + output) ? input + output : null;
  const token = (value: number | null) => value === null ? { value: null, source: 'not-reported' as const }
    : { value, source: 'provider' as const };
  const usage = unreportedDecisionUsage('unknown');
  usage.tokens = { input: token(input), output: token(output), total: token(count(native.total_tokens) && native.total_tokens === sum ? sum : null) };
  const answered = Array.isArray(body?.answers) && body.answers.length === 1 && isRecord(body.answers[0]) && body.answers[0].name === 'verdict';
  usage.evaluatorCalls = answered ? 1 : null;
  usage.explanations = answered ? 0 : null;
  const servedModelId = sanitizeJevId(body?.model);
  const matched = servedModelId !== null
    && descriptor.acceptedServedModelIds.includes(servedModelId);
  const providerRequestId = sanitizeJevId(requestId);
  const evidence = { usage, servedModelId, servedEvaluator: matched ? { ...descriptor.evaluator } : null,
    ...(providerRequestId ? { providerRequestId } : {}) };
  const failed = (code: Parameters<typeof createDecisionError>[0]): DecisionAdapterResult => {
    // Contradictory or unpriced details invalidate the counters as billing evidence.
    if (code === 'USAGE_INVALID') usage.tokens = unreportedDecisionUsage('unknown').tokens;
    return { ok: false, error: createDecisionError(code, 'parse'), ...evidence };
  };
  if (!body || !hasOnlyKeys(body, ['model', 'answers', 'usage'])) return failed('VERDICT_INVALID');
  if (!matched) return failed('SERVED_IDENTITY_MISMATCH');
  const cache = native.input_tokens_details;
  const reasoning = native.output_tokens_details;
  if (input === null || output === null || sum === null || native.total_tokens !== sum
    || !hasOnlyKeys(native, ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'])
    || !isRecord(cache) || !hasOnlyKeys(cache, ['cached_tokens', 'cache_write_tokens'])
    || cache.cached_tokens !== 0 || cache.cache_write_tokens !== 0
    || !isRecord(reasoning) || !hasOnlyKeys(reasoning, ['reasoning_tokens'])
    || !count(reasoning.reasoning_tokens) || reasoning.reasoning_tokens > output) return failed('USAGE_INVALID');
  if (!answered) return failed('VERDICT_INVALID');
  const answer = (body.answers as Record<string, unknown>[])[0];
  if (answer.type === 'refusal') return failed(hasOnlyKeys(answer, ['name', 'type']) ? 'PROVIDER_REJECTED' : 'VERDICT_INVALID');
  const encoded = encodeOpenAiDecisionsRequest(request, descriptor);
  if (!encoded.ok) return failed(encoded.code);
  const verdict = decodeOpenAiDecisionsVerdict(answer, encoded.request, encoded.criterion, descriptor);
  return verdict ? { ok: true, verdict, ...evidence } : failed('VERDICT_INVALID');
}
