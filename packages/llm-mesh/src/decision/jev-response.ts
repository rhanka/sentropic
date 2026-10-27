import type { DecisionAdapterResult } from './adapter.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionRequest } from './request.js';
import { createDecisionError } from './errors.js';
import { parseDecisionUsage, unreportedDecisionUsage } from './receipt.js';
import { decodeJevVerdict } from './jev-verdict.js';
import { has, hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

export const sanitizeJevId = (value: unknown): string | null => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Validate identity, counters and verdict separately; refusal never discards valid counters. */
export function decodeJevResponse(candidate: unknown, request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor,
  requestId?: unknown): DecisionAdapterResult {
  const snapshot = snapshotBoundedJson(candidate);
  const body = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : null;
  const servedModelId = sanitizeJevId(body?.model);
  const providerRequestId = sanitizeJevId(requestId);
  const answered = body && isRecord(body.answers) && Object.keys(body.answers).length === 1
    && has(body.answers, 'verdict') && isRecord(body.answers.verdict);
  const nativeUsage = body && isRecord(body.usage) ? body.usage : {};
  const input = count(nativeUsage.input_tokens) ? nativeUsage.input_tokens : null;
  const output = count(nativeUsage.output_tokens) ? nativeUsage.output_tokens : null;
  const total = input !== null && output !== null && count(input + output) ? input + output : null;
  const token = (value: number | null) => value === null ? { value: null, source: 'not-reported' as const }
    : { value, source: 'provider' as const };
  const usage = parseDecisionUsage({ tokens: { input: token(input), output: token(output),
    total: total === null ? token(null) : { value: total, source: 'derived-sum' } },
    evaluatorCalls: answered ? 1 : null, explanations: answered ? 0 : null }) ?? unreportedDecisionUsage('unknown');
  const identityMatches = servedModelId !== null
    && descriptor.acceptedServedModelIds.includes(servedModelId);
  const evidence = { usage, servedModelId, servedEvaluator: identityMatches ? { ...descriptor.evaluator } : null,
    ...(providerRequestId === null ? {} : { providerRequestId }) };
  if (!body) return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'), ...evidence };
  if (!identityMatches) return { ok: false, error: createDecisionError('SERVED_IDENTITY_MISMATCH', 'parse'), ...evidence };
  if (input === null || output === null || total === null || !hasOnlyKeys(nativeUsage, ['input_tokens', 'output_tokens'])) {
    return { ok: false, error: createDecisionError('USAGE_INVALID', 'parse'), ...evidence };
  }
  if (!answered) return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'), ...evidence };
  const answer = (body.answers as Record<string, unknown>).verdict;
  if (!isRecord(answer) || !has(answer, 'type')) {
    return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'), ...evidence };
  }
  const verdict = decodeJevVerdict(answer, request, descriptor);
  return verdict.ok ? { ok: true, verdict: verdict.verdict, ...evidence }
    : { ok: false, error: createDecisionError(verdict.code, 'parse'), ...evidence };
}
