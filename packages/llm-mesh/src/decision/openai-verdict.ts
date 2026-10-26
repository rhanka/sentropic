import type { DecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor, ResolvedDecisionCriterion } from './descriptor.js';
import type { DecisionValidationContext } from './validation-context.js';
import type { DecisionVerdict } from './verdict.js';
import { deriveDecision, parseDecisionConfidence, parseDecisionScore } from './verdict.js';
import { isValidDecisionVerdict } from './client.js';
import { hasOnlyKeys, isRecord } from './validation.js';

/** Trusted native semantics projection, shared by decode and host reconstruction. */
export function openAiDecisionsContext(request: DecisionRequest, criterion: ResolvedDecisionCriterion,
  descriptor: DecisionEvaluatorDescriptor): DecisionValidationContext {
  return { evaluator: { ...descriptor.evaluator }, validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
    acceptedServedModelIds: [...descriptor.acceptedServedModelIds], definitionDigest: descriptor.definition.bundleDigest,
    semantics: { nativeDecision: false, rationale: 'forbidden',
      score: criterion.kind === 'choice' ? null : { meaning: criterion.kind === 'binary' ? 'probability-true' : 'rubric-grade',
        min: 0, max: criterion.kind === 'binary' ? 1 : criterion.levels.length - 1 },
      confidence: criterion.kind === 'binary' ? null : { ...descriptor.confidence } },
    ...(request.criterion.kind === 'registered' ? { registeredResolution: { criteriaId: request.criterion.criteriaId,
      revision: request.criterion.revision, resolvedKind: criterion.kind, criterion,
      resolvedAt: new Date().toISOString(), maxAgeMs: 1 } } : {}) };
}

/** Closed vendor codec. Typed choice values are never coerced into string IDs. */
export function decodeOpenAiDecisionsVerdict(answer: unknown, request: DecisionRequest,
  criterion: ResolvedDecisionCriterion, descriptor: DecisionEvaluatorDescriptor): DecisionVerdict | null {
  if (!isRecord(answer) || answer.name !== 'verdict') return null;
  let score: DecisionVerdict['score'] = null;
  let label: DecisionVerdict['label'] = null;
  let confidence: DecisionVerdict['confidence'] = null;
  let distribution: DecisionVerdict['distribution'] = null;
  if (criterion.kind === 'binary') {
    if (answer.type !== 'predicate' || !hasOnlyKeys(answer, ['type', 'name', 'probability'])) return null;
    score = parseDecisionScore({ value: answer.probability, meaning: 'probability-true',
      scale: { kind: 'bounded', min: 0, max: 1, direction: 'unordered' } });
    if (!score) return null;
  } else {
    if (!hasOnlyKeys(answer, ['type', 'name', 'confidence', 'probabilities', criterion.kind === 'choice' ? 'choice' : 'score'])
      || answer.type !== (criterion.kind === 'choice' ? 'choice' : 'score') || !Array.isArray(answer.probabilities)) return null;
    const entries: NonNullable<DecisionVerdict['distribution']>[number][] = [];
    for (const entry of answer.probabilities) {
      if (!isRecord(entry) || !hasOnlyKeys(entry, criterion.kind === 'choice' ? ['value', 'probability'] : ['value', 'label', 'probability'])) return null;
      if (criterion.kind === 'choice') {
        if (typeof entry.value !== 'string' || !criterion.options.some((option) => option.id === entry.value)) return null;
        entries.push({ outcome: entry.value, nativeOutcome: entry.value, probability: entry.probability as number });
      } else {
        if (typeof entry.value !== 'number' || !Number.isSafeInteger(entry.value)
          || entry.value < 0 || entry.value >= criterion.levels.length || entry.label !== criterion.levels[entry.value].label) return null;
        entries.push({ outcome: criterion.levels[entry.value].label, nativeOutcome: String(entry.value), probability: entry.probability as number });
      }
    }
    distribution = entries;
    confidence = parseDecisionConfidence({ value: answer.confidence, ...descriptor.confidence, origin: 'provider' });
    if (!confidence) return null;
    if (criterion.kind === 'choice') {
      if (typeof answer.choice !== 'string') return null;
      label = { value: answer.choice, origin: 'provider' };
    } else {
      score = parseDecisionScore({ value: answer.score, meaning: 'rubric-grade',
        scale: { kind: 'bounded', min: 0, max: criterion.levels.length - 1, direction: criterion.direction } });
      if (!score) return null;
    }
  }
  const derived = deriveDecision({ rule: request.decision, score, label: label?.value ?? null, providerDecision: null,
    declaredLabels: criterion.kind === 'choice' ? criterion.options.map((option) => option.id) : [] });
  if (!derived.ok) return null;
  const verdict: DecisionVerdict = { criterionKind: request.criterion.kind, resolvedCriterionKind: criterion.kind,
    score, decision: derived.decision, label, confidence, distribution, rationale: null };
  return isValidDecisionVerdict(verdict, request, openAiDecisionsContext(request, criterion, descriptor)) ? verdict : null;
}
