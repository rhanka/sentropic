import type { DecisionAdapterResult } from './adapter.js';
import type { DecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { createDecisionError, isDecisionErrorCode } from './errors.js';
import { parseDecisionUsage, unreportedDecisionUsage } from './receipt.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevVerdict } from './jev-verdict.js';
import { sanitizeJevId } from './jev-response.js';
import { hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';
import { parseJevProviderRaw } from './raw.js';
import { deriveDecision } from './verdict.js';

/** Rebuild the JEV verdict from native evidence, never return a live plugin envelope. */
export function parseDecisionAdapterResult(candidate: unknown, request: DecisionRequest,
  descriptor: DecisionEvaluatorDescriptor, secret: string): DecisionAdapterResult {
  const snapshot = snapshotBoundedJson(candidate);
  const value = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : {};
  const usage = parseDecisionUsage(value.usage) ?? unreportedDecisionUsage('unknown');
  const safeId = (id: unknown) => typeof id === 'string' && id.includes(secret) ? undefined : sanitizeJevId(id);
  const servedModelId = safeId(value.servedModelId) ?? null;
  const providerRequestId = safeId(value.providerRequestId);
  const matched = servedModelId !== null && descriptor.acceptedServedModelIds.includes(servedModelId);
  const evidence = { usage, servedModelId, servedEvaluator: matched ? { ...descriptor.evaluator } : null,
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(typeof value.providerLatencyMs === 'number' && Number.isFinite(value.providerLatencyMs) && value.providerLatencyMs >= 0
      ? { providerLatencyMs: value.providerLatencyMs } : {}) };
  const failed = (code: Parameters<typeof createDecisionError>[0], phase: 'dispatch' | 'parse' = 'parse'): DecisionAdapterResult =>
    ({ ok: false, error: createDecisionError(code, phase), ...evidence });
  if (value.ok === false) {
    const error = isRecord(value.error) ? value.error : {};
    return failed(isDecisionErrorCode(error.code) ? error.code : 'VERDICT_INVALID', error.phase === 'parse' ? 'parse' : 'dispatch');
  }
  if (value.ok !== true) return failed('VERDICT_INVALID');
  if (!matched) return failed('SERVED_IDENTITY_MISMATCH');
  if (usage.tokens.input.source !== 'provider' || usage.tokens.output.source !== 'provider'
    || usage.evaluatorCalls !== 1 || usage.explanations !== 0) return failed('USAGE_INVALID');
  if ((descriptor.protocol ?? 'jev-native') !== 'jev-native') {
    const verdict = value.verdict;
    if (!isRecord(verdict) || request.criterion.kind === 'registered') return failed('VERDICT_INVALID');
    if (verdict.criterionKind !== request.criterion.kind
      || verdict.resolvedCriterionKind !== request.criterion.kind) return failed('VERDICT_INVALID');
    if (verdict.distribution !== null || verdict.rationale !== null || verdict.confidence !== null) return failed('VERDICT_INVALID');
    if (Object.hasOwn(verdict, 'providerRaw')) return failed('VERDICT_INVALID');
    if (request.criterion.kind === 'choice') {
      const labelValue = isRecord(verdict.label) && hasOnlyKeys(verdict.label, ['value', 'origin'])
        && verdict.label.origin === 'provider' && isText(verdict.label.value) ? verdict.label.value : null;
      if (verdict.score !== null || labelValue === null
        || !request.criterion.options.some((option) => option.id === labelValue)) return failed('VERDICT_INVALID');
      const derived = deriveDecision({ rule: request.decision, score: null, label: labelValue,
        providerDecision: null, declaredLabels: request.criterion.options.map((option) => option.id) });
      if (!derived.ok || JSON.stringify(derived.decision) !== JSON.stringify(verdict.decision)) return failed('VERDICT_INVALID');
    } else {
      if (!isRecord(verdict.score) || verdict.label !== null) return failed('VERDICT_INVALID');
      const max = request.criterion.kind === 'graded' ? request.criterion.levels.length - 1 : 1;
      const direction = request.criterion.kind === 'graded' ? request.criterion.direction : 'unordered';
      const score = verdict.score as Record<string, unknown>;
      if (typeof score.value !== 'number' || !Number.isFinite(score.value) || score.value < 0 || score.value > max) {
        return failed('VERDICT_INVALID');
      }
      const derived = deriveDecision({ rule: request.decision, score: verdict.score as never, label: null, providerDecision: null });
      if (!derived.ok || JSON.stringify(derived.decision) !== JSON.stringify(verdict.decision)) return failed('VERDICT_INVALID');
      void direction;
    }
    return { ok: true, verdict: verdict as never, ...evidence };
  }
  const encoded = encodeJevRequest(request, descriptor);
  const verdict = value.verdict;
  if (!encoded.ok || !isRecord(verdict)) return failed('VERDICT_INVALID');
  let native: unknown;
  if (encoded.criterion.kind === 'binary') {
    native = isRecord(verdict.score) ? { noul: verdict.score.value } : null;
  } else {
    if (!Array.isArray(verdict.distribution)) return failed('VERDICT_INVALID');
    const probabilities: Record<string, unknown> = Object.create(null);
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
  const { providerRaw, ...typed } = verdict;
  if (!decoded.ok || !sameJson(typed, decoded.verdict)) return failed('VERDICT_INVALID');
  if (Object.hasOwn(verdict, 'providerRaw')) {
    const raw = parseJevProviderRaw(providerRaw, native, request);
    if (!raw) return failed('VERDICT_INVALID');
    decoded.verdict.providerRaw = raw;
  }
  return { ok: true, verdict: decoded.verdict, ...evidence };
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => sameJson(v, right[i]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
