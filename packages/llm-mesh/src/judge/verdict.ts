import type { DecisionRule, Json, JudgeCriterion } from './request.js';
import { scoreDirections } from './criterion.js';
import { has, hasOnlyKeys, isBoundedJson, isRecord, isText } from './validation.js';

export type ScoreScale =
  | { kind: 'bounded'; min: number; max: number;
      direction: 'higher-is-better' | 'lower-is-better' | 'unordered' }
  | { kind: 'unknown'; reason: 'unknown (source-gap)' };

export interface JudgeScore {
  value: number;
  scale: ScoreScale;
  meaning: 'rubric-grade' | 'probability-true' | 'support' | 'provider-defined';
  normalized?: { value: number; transform: 'linear-min-max' };
}

export interface JudgeVerdict {
  criterionKind: JudgeCriterion['kind'];
  resolvedCriterionKind: 'binary' | 'graded' | 'choice';
  score: JudgeScore | null;
  decision: { pass: boolean; origin: 'provider' | 'threshold' | 'labels'; rule?: DecisionRule } | null;
  label: { value: string; origin: 'provider' } | null;
  rationale: { text: string; origin: 'provider' } | null;
  confidence: { value: number; min: number; max: number;
    meaning: 'provider-confidence' | 'decision-confidence'; meaningRef: string; origin: 'provider' } | null;
  distribution: readonly { outcome: string; nativeOutcome: string; probability: number }[] | null;
  providerRaw?: { data: Json; bytes: number; truncated: boolean };
}

/** Preserve native values and direction; normalization is relative position, not accuracy. */
export function parseJudgeScore(value: unknown): JudgeScore | null {
  if (!isBoundedJson(value) || !isRecord(value) || !hasOnlyKeys(value, ['value', 'scale', 'meaning', 'normalized'])
    || typeof value.value !== 'number' || !Number.isFinite(value.value) || !isRecord(value.scale)
    || !['rubric-grade', 'probability-true', 'support', 'provider-defined'].some((v) => v === value.meaning)) return null;
  const scale = value.scale;
  let position: number | undefined;
  if (scale.kind === 'unknown') {
    if (!hasOnlyKeys(scale, ['kind', 'reason']) || scale.reason !== 'unknown (source-gap)' || has(value, 'normalized')) return null;
  } else if (scale.kind === 'bounded') {
    if (!hasOnlyKeys(scale, ['kind', 'min', 'max', 'direction'])
      || typeof scale.min !== 'number' || typeof scale.max !== 'number'
      || !Number.isFinite(scale.min) || !Number.isFinite(scale.max) || scale.max < scale.min
      || value.value < scale.min || value.value > scale.max
      || !scoreDirections.some((direction) => direction === scale.direction)) return null;
    const span = scale.max - scale.min;
    if (span > 0 && Number.isFinite(span)) position = (value.value - scale.min) / span;
  } else return null;
  if (has(value, 'normalized') && (!isRecord(value.normalized)
    || !hasOnlyKeys(value.normalized, ['value', 'transform']) || position === undefined
    || value.normalized.transform !== 'linear-min-max' || typeof value.normalized.value !== 'number'
    || !Number.isFinite(value.normalized.value) || Math.abs(value.normalized.value - position) > 1e-12)) return null;
  return { value: value.value, scale: { ...scale } as ScoreScale, meaning: value.meaning as JudgeScore['meaning'],
    ...(position === undefined ? {} : { normalized: { value: position, transform: 'linear-min-max' as const } }) };
}

/** A descriptor supplies the documented meaning; this never derives confidence from score. */
export function parseJudgeConfidence(value: unknown): JudgeVerdict['confidence'] {
  if (!isBoundedJson(value) || !isRecord(value)
    || !hasOnlyKeys(value, ['value', 'min', 'max', 'meaning', 'meaningRef', 'origin'])
    || typeof value.value !== 'number' || typeof value.min !== 'number' || typeof value.max !== 'number'
    || !Number.isFinite(value.value) || !Number.isFinite(value.min) || !Number.isFinite(value.max)
    || value.max < value.min || value.value < value.min || value.value > value.max
    || (value.meaning !== 'provider-confidence' && value.meaning !== 'decision-confidence')
    || !isText(value.meaningRef) || value.origin !== 'provider') return null;
  return { value: value.value, min: value.min, max: value.max, meaning: value.meaning,
    meaningRef: value.meaningRef, origin: 'provider' };
}

/** Map an exact, descriptor-owned native key set, preserving order and probabilities. */
export function mapJudgeDistribution(probabilities: unknown,
  declared: readonly { outcome: string; nativeOutcome: string }[]): JudgeVerdict['distribution'] {
  if (!isBoundedJson(probabilities) || !isRecord(probabilities) || !declared.length
    || new Set(declared.map((v) => v.outcome)).size !== declared.length
    || new Set(declared.map((v) => v.nativeOutcome)).size !== declared.length
    || Object.keys(probabilities).length !== declared.length) return null;
  let sum = 0;
  for (const { outcome, nativeOutcome } of declared) {
    const probability = probabilities[nativeOutcome];
    if (!isText(outcome) || !isText(nativeOutcome) || !has(probabilities, nativeOutcome)
      || typeof probability !== 'number' || !Number.isFinite(probability)
      || probability < 0 || probability > 1) return null;
    sum += probability;
  }
  if (Math.abs(sum - 1) > 1e-4) return null;
  return declared.map(({ outcome, nativeOutcome }) => ({ outcome, nativeOutcome,
    probability: probabilities[nativeOutcome] as number }));
}
