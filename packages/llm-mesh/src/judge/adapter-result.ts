import type { JudgeAdapterResult } from './adapter.js';
import type { JudgeRequest } from './request.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import { createJudgeError, isJudgeErrorCode } from './errors.js';
import { parseJudgeUsage, unreportedJudgeUsage } from './receipt.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevVerdict } from './jev-verdict.js';
import { sanitizeJevId } from './jev-response.js';
import { isRecord, snapshotBoundedJson } from './validation.js';

/** Rebuild the JEV verdict from native evidence, never return a live plugin envelope. */
export function parseJudgeAdapterResult(candidate: unknown, request: JudgeRequest,
  descriptor: EvaluatorDescriptor, secret: string): JudgeAdapterResult {
  const snapshot = snapshotBoundedJson(candidate);
  const value = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : {};
  const usage = parseJudgeUsage(value.usage) ?? unreportedJudgeUsage('unknown');
  const safeId = (id: unknown) => typeof id === 'string' && id.includes(secret) ? undefined : sanitizeJevId(id);
  const servedModelId = safeId(value.servedModelId) ?? null;
  const providerRequestId = safeId(value.providerRequestId);
  const matched = servedModelId !== null && descriptor.acceptedServedModelIds.includes(servedModelId);
  const evidence = { usage, servedModelId, servedEvaluator: matched ? { ...descriptor.evaluator } : null,
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(typeof value.providerLatencyMs === 'number' && Number.isFinite(value.providerLatencyMs) && value.providerLatencyMs >= 0
      ? { providerLatencyMs: value.providerLatencyMs } : {}) };
  const failed = (code: Parameters<typeof createJudgeError>[0], phase: 'dispatch' | 'parse' = 'parse'): JudgeAdapterResult =>
    ({ ok: false, error: createJudgeError(code, phase), ...evidence });
  if (value.ok === false) {
    const error = isRecord(value.error) ? value.error : {};
    return failed(isJudgeErrorCode(error.code) ? error.code : 'VERDICT_INVALID', error.phase === 'parse' ? 'parse' : 'dispatch');
  }
  if (value.ok !== true) return failed('VERDICT_INVALID');
  if (!matched) return failed('SERVED_IDENTITY_MISMATCH');
  if (usage.tokens.input.source !== 'provider' || usage.tokens.output.source !== 'provider'
    || usage.evaluatorCalls !== 1 || usage.explanations !== 0) return failed('USAGE_INVALID');
  const encoded = encodeJevRequest(request, descriptor);
  const verdict = value.verdict;
  if (!encoded.ok || !isRecord(verdict)) return failed('VERDICT_INVALID');
  let native: unknown;
  if (encoded.criterion.kind === 'binary') {
    native = isRecord(verdict.score) ? { noul: verdict.score.value } : null;
  } else {
    if (!Array.isArray(verdict.distribution)) return failed('VERDICT_INVALID');
    const probabilities: Record<string, unknown> = {};
    for (const item of verdict.distribution) {
      if (!isRecord(item) || typeof item.nativeOutcome !== 'string') return failed('VERDICT_INVALID');
      probabilities[item.nativeOutcome] = item.probability;
    }
    const confidence = isRecord(verdict.confidence) ? verdict.confidence.value : null;
    native = encoded.criterion.kind === 'choice'
      ? { choice: isRecord(verdict.label) ? verdict.label.value : null, probabilities, confidence }
      : { score: isRecord(verdict.score) ? verdict.score.value : null, probabilities, confidence,
        legend: Object.fromEntries(encoded.criterion.levels.map((level, index) => [String(index), level.description])) };
  }
  const decoded = decodeJevVerdict(native, request, descriptor);
  // Compare detached data structurally, so property insertion order has no authority.
  if (!decoded.ok || !sameJson(verdict, decoded.verdict)) return failed('VERDICT_INVALID');
  return { ok: true, verdict: decoded.verdict, ...evidence };
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => sameJson(v, right[i]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
