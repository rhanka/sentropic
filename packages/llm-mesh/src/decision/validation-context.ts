import { hasOnlyKeys, isRecord, isText } from './validation.js';
import { freezeDecisionData } from './descriptor-validation.js';
import type { DecisionCriterion, DecisionRequest, EvaluatorRef } from './request.js';

/** Closed validation relation and version, published with the selected definition. */
export interface DecisionValidationProfile {
  profile: 'native-distribution-v1' | 'scalar-label-v1';
  version: string;
}

export interface DecisionValidationScoreSemantics {
  meaning: string;
  min: number;
  max: number;
}

export interface DecisionValidationConfidenceSemantics {
  meaning: string;
  min: number;
  max: number;
}

/** Evidence the selected profile admits for one resolved kind. Null score or
 * confidence forbids that carrier; rationale stays forbidden unless optional. */
export interface DecisionValidationSemantics {
  nativeDecision: boolean;
  score: DecisionValidationScoreSemantics | null;
  confidence: DecisionValidationConfidenceSemantics | null;
  rationale: 'forbidden' | 'optional';
}

export type DirectDecisionCriterion = Exclude<DecisionCriterion, { kind: 'registered' }>;

/** Trusted resolution of one registered criterion: exact requested identity,
 * resolved direct criterion, trusted timestamp and consumer-set age bound. */
export interface DecisionRegisteredResolution {
  criteriaId: string;
  revision: string;
  resolvedKind: 'binary' | 'graded' | 'choice';
  criterion: DirectDecisionCriterion;
  resolvedAt: string;
  maxAgeMs: number;
}

/** The only source of revision-specific validation facts. The response never
 * selects or weakens its own profile. Detached and frozen on parse. */
export interface DecisionValidationContext {
  evaluator: EvaluatorRef;
  validationProfile: DecisionValidationProfile;
  acceptedServedModelIds: readonly string[];
  semantics: DecisionValidationSemantics;
  registeredResolution?: DecisionRegisteredResolution;
  definitionDigest: string;
}

export type DecisionValidationContextResolver = (
  snapshot: DecisionRequest,
) => DecisionValidationContext | null | undefined | Promise<DecisionValidationContext | null | undefined>;

const KNOWN_PROFILES = new Set(['native-distribution-v1', 'scalar-label-v1']);
const RESOLVED_KINDS = new Set(['binary', 'graded', 'choice']);
const DIGEST_RE = /^[0-9a-f]{64}$/;

const isEvaluatorRef = (value: unknown): value is EvaluatorRef =>
  isRecord(value) && hasOnlyKeys(value, ['providerId', 'evaluatorId', 'revision'])
  && isText(value.providerId) && isText(value.evaluatorId) && isText(value.revision);

const sameEvaluatorRef = (left: EvaluatorRef, right: EvaluatorRef): boolean =>
  left.providerId === right.providerId && left.evaluatorId === right.evaluatorId && left.revision === right.revision;

const isBoundedMeaning = (value: unknown): value is DecisionValidationScoreSemantics =>
  isRecord(value) && hasOnlyKeys(value, ['meaning', 'min', 'max'])
  && isText(value.meaning) && typeof value.min === 'number' && Number.isFinite(value.min)
  && typeof value.max === 'number' && Number.isFinite(value.max) && value.min < value.max;

const isDirectCriterionOfKind = (value: unknown, kind: 'binary' | 'graded' | 'choice'): value is DirectDecisionCriterion => {
  if (!isRecord(value) || value.kind !== kind || !isText(value.instructions)) return false;
  if (kind === 'graded') {
    return (value.direction === 'higher-is-better' || value.direction === 'lower-is-better' || value.direction === 'unordered')
      && Array.isArray(value.levels) && value.levels.length > 0
      && hasOnlyKeys(value, ['kind', 'instructions', 'direction', 'levels'])
      && value.levels.every((level) => isRecord(level) && hasOnlyKeys(level, ['label', 'description'])
        && isText(level.label) && isText(level.description));
  }
  if (kind === 'choice') {
    return Array.isArray(value.options) && value.options.length > 0
      && hasOnlyKeys(value, ['kind', 'instructions', 'options'])
      && value.options.every((option) => isRecord(option) && hasOnlyKeys(option, ['id', 'description'])
        && isText(option.id) && isText(option.description));
  }
  return hasOnlyKeys(value, ['kind', 'instructions', 'criteria'])
    || hasOnlyKeys(value, ['kind', 'instructions']);
};

const MAX_CONTEXT_AGE_MS = 86_400_000;

const isRegisteredResolution = (value: unknown, request: DecisionRequest, nowMs: number): value is DecisionRegisteredResolution => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['criteriaId', 'revision', 'resolvedKind', 'criterion', 'resolvedAt', 'maxAgeMs'])) return false;
  if (!isText(value.criteriaId) || !isText(value.revision) || !RESOLVED_KINDS.has(value.resolvedKind as string)) return false;
  if (request.criterion.kind !== 'registered') return false;
  if (value.criteriaId !== request.criterion.criteriaId || value.revision !== request.criterion.revision) return false;
  if (!isDirectCriterionOfKind(value.criterion, value.resolvedKind as 'binary' | 'graded' | 'choice')) return false;
  if (value.criterion.kind !== value.resolvedKind) return false;
  if (!isText(value.resolvedAt)) return false;
  const resolvedAt = Date.parse(value.resolvedAt);
  if (!Number.isFinite(resolvedAt) || resolvedAt > nowMs) return false;
  if (typeof value.maxAgeMs !== 'number' || !Number.isSafeInteger(value.maxAgeMs) || value.maxAgeMs < 1
    || value.maxAgeMs > MAX_CONTEXT_AGE_MS) return false;
  return nowMs - resolvedAt <= value.maxAgeMs;
};

/** Parse, bind to the transmitted snapshot and freeze. Null on any fault:
 * wrong shape, wrong evaluator, unknown profile, empty model set, missing or
 * stale/future registered resolution. Direct criteria resolve from the
 * request snapshot and never consult a resolution. */
export function parseDecisionValidationContext(candidate: unknown, request: DecisionRequest,
  nowMs: number): DecisionValidationContext | null {
  if (!isRecord(candidate)) return null;
  if (!hasOnlyKeys(candidate, ['evaluator', 'validationProfile', 'acceptedServedModelIds',
    'semantics', 'definitionDigest', 'registeredResolution'])
    && !hasOnlyKeys(candidate, ['evaluator', 'validationProfile', 'acceptedServedModelIds', 'semantics', 'definitionDigest'])) {
    return null;
  }
  if (!isEvaluatorRef(candidate.evaluator) || !sameEvaluatorRef(candidate.evaluator, request.evaluator)) return null;
  const profile = candidate.validationProfile;
  if (!isRecord(profile) || !hasOnlyKeys(profile, ['profile', 'version'])
    || !KNOWN_PROFILES.has(profile.profile as string) || !isText(profile.version)) return null;
  const models = candidate.acceptedServedModelIds;
  if (!Array.isArray(models) || models.length === 0 || !models.every(isText)
    || new Set(models).size !== models.length) return null;
  const semantics = candidate.semantics;
  if (!isRecord(semantics) || !hasOnlyKeys(semantics, ['nativeDecision', 'score', 'confidence', 'rationale'])) return null;
  if (typeof semantics.nativeDecision !== 'boolean') return null;
  if (semantics.score !== null && !isBoundedMeaning(semantics.score)) return null;
  if (semantics.confidence !== null && !isBoundedMeaning(semantics.confidence)) return null;
  if (semantics.rationale !== 'forbidden' && semantics.rationale !== 'optional') return null;
  if (!isText(candidate.definitionDigest) || !DIGEST_RE.test(candidate.definitionDigest)) return null;
  const registered = request.criterion.kind === 'registered';
  if (registered && !isRegisteredResolution(candidate.registeredResolution, request, nowMs)) return null;
  if (!registered && candidate.registeredResolution !== undefined) return null;
  const context: DecisionValidationContext = registered
    ? { evaluator: { ...candidate.evaluator }, validationProfile: { ...(profile as DecisionValidationProfile) },
      acceptedServedModelIds: [...models as string[]], semantics: { ...(semantics as DecisionValidationSemantics) },
      registeredResolution: candidate.registeredResolution as DecisionRegisteredResolution,
      definitionDigest: candidate.definitionDigest as string }
    : { evaluator: { ...candidate.evaluator }, validationProfile: { ...(profile as DecisionValidationProfile) },
      acceptedServedModelIds: [...models as string[]], semantics: { ...(semantics as DecisionValidationSemantics) },
      definitionDigest: candidate.definitionDigest as string };
  return freezeDecisionData(context);
}
