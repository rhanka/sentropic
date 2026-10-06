import type { JudgeAdapterResult } from './adapter.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import type { JudgeRequest } from './request.js';
import { createJudgeError } from './errors.js';
import { parseJudgeUsage, unreportedJudgeUsage } from './receipt.js';
import { decodeJevVerdict } from './jev-verdict.js';
import { has, hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

export const sanitizeJevId = (value: unknown): string | null => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Validate identity, counters and verdict separately; refusal never discards valid counters. */
export function decodeJevResponse(candidate: unknown, request: JudgeRequest, descriptor: EvaluatorDescriptor,
  requestId?: unknown): JudgeAdapterResult {
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
  const usage = parseJudgeUsage({ tokens: { input: token(input), output: token(output),
    total: total === null ? token(null) : { value: total, source: 'derived-sum' } },
    evaluatorCalls: answered ? 1 : null, explanations: answered ? 0 : null }) ?? unreportedJudgeUsage('unknown');
  const identityMatches = servedModelId !== null && descriptor.qualification.servedIdentity === 'qualified'
    && descriptor.acceptedServedModelIds.includes(servedModelId);
  const evidence = { usage, servedModelId, servedEvaluator: identityMatches ? { ...descriptor.evaluator } : null,
    ...(providerRequestId === null ? {} : { providerRequestId }) };
  if (!body) return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse'), ...evidence };
  if (!identityMatches) return { ok: false, error: createJudgeError('SERVED_IDENTITY_MISMATCH', 'parse'), ...evidence };
  if (input === null || output === null || total === null || !hasOnlyKeys(nativeUsage, ['input_tokens', 'output_tokens'])) {
    return { ok: false, error: createJudgeError('USAGE_INVALID', 'parse'), ...evidence };
  }
  if (!answered) return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse'), ...evidence };
  const verdict = decodeJevVerdict((body.answers as Record<string, unknown>).verdict, request, descriptor);
  return verdict.ok ? { ok: true, verdict: verdict.verdict, ...evidence }
    : { ok: false, error: createJudgeError(verdict.code, 'parse'), ...evidence };
}
