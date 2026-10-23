import { hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';
import { freezeDecisionData } from './descriptor-validation.js';
import { isDecisionCriterion } from './criterion.js';
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
  meaningRef: string;
  min: number;
  max: number;
}

const KNOWN_PROFILE_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  'native-distribution-v1': ['v1'],
  'scalar-label-v1': ['v1'],
};

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

const isBoundedConfidence = (value: unknown): value is DecisionValidationConfidenceSemantics =>
  isRecord(value) && hasOnlyKeys(value, ['meaning', 'meaningRef', 'min', 'max'])
  && isText(value.meaning) && isText(value.meaningRef) && typeof value.min === 'number' && Number.isFinite(value.min)
  && typeof value.max === 'number' && Number.isFinite(value.max) && value.min <= value.max;

const isDirectCriterionOfKind = (value: unknown, kind: 'binary' | 'graded' | 'choice'): value is DirectDecisionCriterion => {
  if (!isDecisionCriterion(value) || value.kind !== kind) return false;
  return true;
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
  const snapshot = snapshotBoundedJson(candidate);
  if (!snapshot.ok || !isRecord(snapshot.value)) return null;
  const source = snapshot.value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ['evaluator', 'validationProfile', 'acceptedServedModelIds',
    'semantics', 'definitionDigest', 'registeredResolution'])
    && !hasOnlyKeys(source, ['evaluator', 'validationProfile', 'acceptedServedModelIds', 'semantics', 'definitionDigest'])) {
    return null;
  }
  if (!isEvaluatorRef(source.evaluator) || !sameEvaluatorRef(source.evaluator, request.evaluator)) return null;
  const profile = source.validationProfile;
  if (!isRecord(profile) || !hasOnlyKeys(profile, ['profile', 'version'])
    || !KNOWN_PROFILES.has(profile.profile as string) || !isText(profile.version)) return null;
  const allowedVersions = KNOWN_PROFILE_VERSIONS[profile.profile as string];
  if (!allowedVersions || !allowedVersions.includes(profile.version as string)) return null;
  const models = source.acceptedServedModelIds;
  if (!Array.isArray(models) || models.length === 0 || !models.every(isText)
    || new Set(models).size !== models.length) return null;
  const semantics = source.semantics;
  if (!isRecord(semantics) || !hasOnlyKeys(semantics, ['nativeDecision', 'score', 'confidence', 'rationale'])) return null;
  if (typeof semantics.nativeDecision !== 'boolean') return null;
  if (semantics.score !== null && !isBoundedMeaning(semantics.score)) return null;
  if (semantics.confidence !== null && !isBoundedConfidence(semantics.confidence)) return null;
  if (semantics.rationale !== 'forbidden' && semantics.rationale !== 'optional') return null;
  // §3.4 native-distribution-v1 forbids fabricated native evidence: a context
  // that permits rationale under the native profile contradicts the profile
  // and must fail before headers or fetch, never redefine native semantics.
  if (profile.profile === 'native-distribution-v1' && semantics.rationale !== 'forbidden') return null;
  if (!isText(source.definitionDigest) || !DIGEST_RE.test(source.definitionDigest as string)) return null;
  const registered = request.criterion.kind === 'registered';
  if (registered && !isRegisteredResolution(source.registeredResolution, request, nowMs)) return null;
  if (!registered && source.registeredResolution !== undefined) return null;
  // Required profile evidence (§3.4): a native binary/graded verdict carries a
  // native score, so a native context without score semantics for those kinds
  // cannot validate anything and fails here rather than at the response.
  const effectiveKind = registered
    ? (source.registeredResolution as DecisionRegisteredResolution).resolvedKind
    : request.criterion.kind;
  if (profile.profile === 'native-distribution-v1' && effectiveKind !== 'choice' && semantics.score === null) return null;
  const ref = source.evaluator as EvaluatorRef;
  const scoreSource = (semantics as { score: DecisionValidationSemantics['score'] }).score;
  const confidenceSource = (semantics as { confidence: DecisionValidationSemantics['confidence'] }).confidence;
  const context: DecisionValidationContext = {
    evaluator: { providerId: ref.providerId, evaluatorId: ref.evaluatorId, revision: ref.revision },
    validationProfile: { profile: (profile as { profile: DecisionValidationProfile['profile'] }).profile,
      version: (profile as { version: string }).version },
    acceptedServedModelIds: [...(models as string[])],
    semantics: { nativeDecision: (semantics as { nativeDecision: boolean }).nativeDecision,
      score: scoreSource === null ? null : { ...(scoreSource as DecisionValidationScoreSemantics) },
      confidence: confidenceSource === null ? null : { ...(confidenceSource as DecisionValidationConfidenceSemantics) },
      rationale: (semantics as { rationale: 'forbidden' | 'optional' }).rationale },
    definitionDigest: source.definitionDigest as string,
  };
  if (registered) {
    const resolution = source.registeredResolution as DecisionRegisteredResolution;
    context.registeredResolution = {
      criteriaId: resolution.criteriaId,
      revision: resolution.revision,
      resolvedKind: resolution.resolvedKind,
      criterion: structuredClone(resolution.criterion) as DirectDecisionCriterion,
      resolvedAt: resolution.resolvedAt,
      maxAgeMs: resolution.maxAgeMs,
    };
  }
  return freezeDecisionData(context);
}
