import { encodeJevRequest } from './jev-codec.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionRequest } from './request.js';
import type { DecisionErrorCode } from './errors.js';
import { deriveDecision, mapDecisionDistribution, parseDecisionConfidence, parseDecisionScore } from './verdict.js';
import type { DecisionVerdict } from './verdict.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

export type JevVerdictResult = { ok: true; verdict: DecisionVerdict } | { ok: false; code: DecisionErrorCode };
/** Build a fresh typed envelope only from validated request and native-value snapshots. */
export function decodeJevVerdict(candidate: unknown, request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): JevVerdictResult {
  const encoded = encodeJevRequest(request, descriptor);
  if (!encoded.ok) return encoded;
  const snapshot = snapshotBoundedJson(candidate);
  const invalid = { ok: false, code: 'VERDICT_INVALID' } as const;
  if (!snapshot.ok || !isRecord(snapshot.value)) return invalid;
  const { type, ...answer } = snapshot.value;
  const { criterion } = encoded;
  // The pinned System One wire includes a discriminator. Primitive projections
  // used by host reconstruction omit it; a supplied discriminator is binding.
  const expectedType = criterion.kind === 'binary' ? 'noul' : criterion.kind === 'graded' ? 'score' : 'choice';
  if (Object.hasOwn(snapshot.value, 'type') && type !== expectedType) return invalid;
  let score: DecisionVerdict['score'] = null;
  let label: DecisionVerdict['label'] = null;
  let confidence: DecisionVerdict['confidence'] = null;
  let distribution: DecisionVerdict['distribution'] = null;
  let declaredLabels: string[] = [];
  if (criterion.kind === 'binary') {
    if (!hasOnlyKeys(answer, ['noul'])) return invalid;
    score = parseDecisionScore({ value: answer.noul, meaning: 'probability-true',
      scale: { kind: 'bounded', min: 0, max: 1, direction: 'unordered' } });
    if (!score) return invalid;
  } else if (criterion.kind === 'choice') {
    if (!hasOnlyKeys(answer, ['choice', 'probabilities', 'confidence'])) return invalid;
    declaredLabels = criterion.options.map((option) => option.id);
    distribution = mapDecisionDistribution(answer.probabilities, declaredLabels.map((outcome) => ({ outcome, nativeOutcome: outcome })));
    if (!distribution || typeof answer.choice !== 'string') return invalid;
    const selected = distribution.find((entry) => entry.outcome === answer.choice);
    if (!selected || selected.probability !== Math.max(...distribution.map((entry) => entry.probability))) return invalid;
    label = { value: selected.outcome, origin: 'provider' };
    confidence = parseDecisionConfidence({ value: answer.confidence, ...descriptor.confidence, origin: 'provider' });
    if (!confidence || confidence.meaning !== 'provider-confidence') return invalid;
  } else {
    if (!hasOnlyKeys(answer, ['score', 'probabilities', 'legend', 'confidence']) || !isRecord(answer.legend)
      || Object.keys(answer.legend).length !== criterion.levels.length) return invalid;
    const outcomes = criterion.levels.map((level, index) => ({ outcome: level.label, nativeOutcome: String(index) }));
    const legend = answer.legend;
    if (!outcomes.every((entry, index) => legend[entry.nativeOutcome] === criterion.levels[index].description)) return invalid;
    distribution = mapDecisionDistribution(answer.probabilities, outcomes);
    score = parseDecisionScore({ value: answer.score, meaning: 'rubric-grade',
      scale: { kind: 'bounded', min: 0, max: criterion.levels.length - 1, direction: criterion.direction } });
    confidence = parseDecisionConfidence({ value: answer.confidence, ...descriptor.confidence, origin: 'provider' });
    if (!distribution || !score || !confidence || confidence.meaning !== 'provider-confidence') return invalid;
    const weighted = distribution.reduce((sum, entry, index) => sum + index * entry.probability, 0);
    if (Math.abs(weighted - score.value) > descriptor.probabilityTolerance) return invalid;
  }
  if (distribution && Math.abs(distribution.reduce((sum, entry) => sum + entry.probability, 0) - 1)
    > descriptor.probabilityTolerance) return invalid;
  const decision = deriveDecision({ rule: encoded.request.decision, score, label: label?.value ?? null,
    providerDecision: null, declaredLabels });
  if (!decision.ok) return decision;
  return { ok: true, verdict: { criterionKind: encoded.request.criterion.kind, resolvedCriterionKind: criterion.kind,
    score, label, decision: decision.decision, rationale: null, confidence, distribution } };
}
