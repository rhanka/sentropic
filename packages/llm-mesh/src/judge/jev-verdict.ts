import { encodeJevRequest } from './jev-codec.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import type { JudgeRequest } from './request.js';
import type { JudgeErrorCode } from './errors.js';
import { deriveJudgeDecision, mapJudgeDistribution, parseJudgeConfidence, parseJudgeScore } from './verdict.js';
import type { JudgeVerdict } from './verdict.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

export type JevVerdictResult = { ok: true; verdict: JudgeVerdict } | { ok: false; code: JudgeErrorCode };
/** Build a fresh typed envelope only from validated request and native-value snapshots. */
export function decodeJevVerdict(candidate: unknown, request: JudgeRequest, descriptor: EvaluatorDescriptor): JevVerdictResult {
  const encoded = encodeJevRequest(request, descriptor);
  if (!encoded.ok) return encoded;
  const snapshot = snapshotBoundedJson(candidate);
  const invalid = { ok: false, code: 'VERDICT_INVALID' } as const;
  if (!snapshot.ok || !isRecord(snapshot.value)) return invalid;
  const answer = snapshot.value;
  const { criterion } = encoded;
  let score: JudgeVerdict['score'] = null;
  let label: JudgeVerdict['label'] = null;
  let confidence: JudgeVerdict['confidence'] = null;
  let distribution: JudgeVerdict['distribution'] = null;
  let declaredLabels: string[] = [];
  if (criterion.kind === 'binary') {
    if (!hasOnlyKeys(answer, ['noul'])) return invalid;
    score = parseJudgeScore({ value: answer.noul, meaning: 'probability-true',
      scale: { kind: 'bounded', min: 0, max: 1, direction: 'unordered' } });
    if (!score) return invalid;
  } else if (criterion.kind === 'choice') {
    if (!hasOnlyKeys(answer, ['choice', 'probabilities', 'confidence'])) return invalid;
    declaredLabels = criterion.options.map((option) => option.id);
    distribution = mapJudgeDistribution(answer.probabilities, declaredLabels.map((outcome) => ({ outcome, nativeOutcome: outcome })));
    if (!distribution || typeof answer.choice !== 'string') return invalid;
    const selected = distribution.find((entry) => entry.outcome === answer.choice);
    if (!selected || selected.probability !== Math.max(...distribution.map((entry) => entry.probability))) return invalid;
    label = { value: selected.outcome, origin: 'provider' };
    confidence = parseJudgeConfidence({ value: answer.confidence, ...descriptor.confidence, origin: 'provider' });
    if (!confidence || confidence.meaning !== 'provider-confidence') return invalid;
  } else return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
  const decision = deriveJudgeDecision({ rule: encoded.request.decision, score, label: label?.value ?? null,
    providerDecision: null, declaredLabels });
  if (!decision.ok) return decision;
  return { ok: true, verdict: { criterionKind: encoded.request.criterion.kind, resolvedCriterionKind: criterion.kind,
    score, label, decision: decision.decision, rationale: null, confidence, distribution } };
}
