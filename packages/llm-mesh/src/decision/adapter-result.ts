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
import type { DecisionVerdict } from './verdict.js';
import { STRUCTURED_SCORE_MEANING } from './structured.js';
import { encodeOpenAiDecisionsRequest } from './openai-request.js';
import { openAiDecisionsContext } from './openai-verdict.js';
import { isValidDecisionVerdict } from './client.js';

/** Closed structured envelope at the host boundary (V-K1/V-K2). Undeclared
 * carriers, substituted score meaning/scale/direction and provider raw data
 * are rejected; the surviving verdict is rebuilt field by field from
 * validated values bound to the descriptor and request criterion. */
const STRUCTURED_HOST_VERDICT_KEYS = ['criterionKind', 'resolvedCriterionKind', 'score', 'decision', 'label',
  'rationale', 'confidence', 'distribution'] as const;
function parseStructuredHostVerdict(candidate: unknown, request: DecisionRequest,
  descriptor: DecisionEvaluatorDescriptor): { verdict: DecisionVerdict } | null {
  if (!isRecord(candidate) || request.criterion.kind === 'registered') return null;
  if (!hasOnlyKeys(candidate, [...STRUCTURED_HOST_VERDICT_KEYS])) return null;
  if (candidate.criterionKind !== request.criterion.kind || candidate.resolvedCriterionKind !== request.criterion.kind) return null;
  if (candidate.distribution !== null || candidate.rationale !== null || candidate.confidence !== null) return null;
  if (Object.hasOwn(candidate, 'providerRaw')) return null;
  const expectedMeaning = descriptor.scoreSemantics?.meaning
    ?? ((descriptor.protocol ?? 'structured-llm') === 'structured-llm' ? STRUCTURED_SCORE_MEANING : null);
  if (expectedMeaning === null) return null;
  if (request.criterion.kind === 'choice') {
    if (!isRecord(candidate.label) || !hasOnlyKeys(candidate.label, ['value', 'origin'])
      || candidate.label.origin !== 'provider' || !isText(candidate.label.value) || candidate.score !== null) return null;
    const labelValue = candidate.label.value;
    if (!request.criterion.options.some((option) => option.id === labelValue)) return null;
    const derived = deriveDecision({ rule: request.decision, score: null, label: labelValue,
      providerDecision: null, declaredLabels: request.criterion.options.map((option) => option.id) });
    if (!derived.ok || JSON.stringify(derived.decision) !== JSON.stringify(candidate.decision)) return null;
    return { verdict: { criterionKind: 'choice', resolvedCriterionKind: 'choice', score: null,
      decision: derived.decision, label: { value: labelValue, origin: 'provider' },
      rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict };
  }
  if (request.criterion.kind !== 'binary' && request.criterion.kind !== 'graded') return null;
  if (candidate.label !== null || !isRecord(candidate.score)) return null;
  const score = candidate.score;
  if (!hasOnlyKeys(score, ['value', 'meaning', 'scale']) || score.meaning !== expectedMeaning) return null;
  if (!isRecord(score.scale) || !hasOnlyKeys(score.scale, ['kind', 'min', 'max', 'direction'])) return null;
  const scale = score.scale;
  const max = request.criterion.kind === 'graded' ? request.criterion.levels.length - 1 : 1;
  const direction = request.criterion.kind === 'graded' ? request.criterion.direction : 'unordered';
  if (scale.kind !== 'bounded' || scale.min !== 0 || scale.max !== max || scale.direction !== direction) return null;
  if (typeof score.value !== 'number' || !Number.isFinite(score.value) || score.value < 0 || score.value > max) return null;
  const rebuiltScore = { value: score.value, meaning: expectedMeaning,
    scale: { kind: 'bounded' as const, min: 0, max, direction } };
  const derived = deriveDecision({ rule: request.decision, score: rebuiltScore as never, label: null, providerDecision: null });
  if (!derived.ok || JSON.stringify(derived.decision) !== JSON.stringify(candidate.decision)) return null;
  return { verdict: { criterionKind: request.criterion.kind, resolvedCriterionKind: request.criterion.kind,
    score: rebuiltScore, decision: derived.decision, label: null,
    rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict };
}

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
  if (descriptor.protocol === 'openai-decisions') {
    const encoded = encodeOpenAiDecisionsRequest(request, descriptor);
    if (!encoded.ok || !isValidDecisionVerdict(value.verdict, encoded.request,
      openAiDecisionsContext(encoded.request, encoded.criterion, descriptor)) || value.verdict.providerRaw !== undefined) return failed('VERDICT_INVALID');
    const verdict = value.verdict;
    return { ok: true, verdict: { criterionKind: verdict.criterionKind, resolvedCriterionKind: verdict.resolvedCriterionKind,
      score: structuredClone(verdict.score), decision: structuredClone(verdict.decision), label: structuredClone(verdict.label),
      rationale: null, confidence: structuredClone(verdict.confidence), distribution: structuredClone(verdict.distribution) }, ...evidence };
  }
  if ((descriptor.protocol ?? 'jev-native') !== 'jev-native' && descriptor.protocol !== 'systemone-local') {
    const closed = parseStructuredHostVerdict(value.verdict, request, descriptor);
    if (!closed) return failed('VERDICT_INVALID');
    return { ok: true, verdict: closed.verdict, ...evidence };
  }
  const encoded = encodeJevRequest(request, descriptor);
  const verdict = value.verdict;
  if (descriptor.protocol === 'systemone-local' && isRecord(verdict) && Object.hasOwn(verdict, 'providerRaw')) return failed('VERDICT_INVALID');
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
