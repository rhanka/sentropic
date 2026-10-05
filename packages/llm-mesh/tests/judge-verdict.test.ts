import { describe, expect, it } from 'vitest';
import { mapJudgeDistribution, parseJudgeConfidence, parseJudgeScore } from '../src/judge/verdict.js';

const grade = (value = 1.25) => ({ value, meaning: 'rubric-grade',
  scale: { kind: 'bounded', min: 0, max: 2, direction: 'higher-is-better' } });

describe('native judge score semantics', () => {
  it('should retain fractional grades and avoid reversing lower-is-better scores', () => {
    expect(parseJudgeScore(grade())?.value).toBe(1.25);
    expect(parseJudgeScore(grade())?.normalized?.value).toBe(0.625);
    expect(parseJudgeScore({ ...grade(), scale: { ...grade().scale, direction: 'lower-is-better' } })?.normalized?.value).toBe(0.625);
  });
  it('should retain unknown-scale values without inventing normalization', () => {
    expect(parseJudgeScore({ value: -42, meaning: 'provider-defined', scale: { kind: 'unknown', reason: 'unknown (source-gap)' } }))
      .toEqual({ value: -42, meaning: 'provider-defined', scale: { kind: 'unknown', reason: 'unknown (source-gap)' } });
  });
  it('should refuse non-finite, out-of-range or contradictory scores without repair', () => {
    for (const value of [grade(NaN), grade(2.1), { ...grade(), value: true },
      { ...grade(), normalized: { value: 1, transform: 'linear-min-max' } },
      { ...grade(), scale: { ...grade().scale, min: 3 } }]) expect(parseJudgeScore(value)).toBeNull();
  });
  it('should preserve valid native values when a scale cannot be normalized', () => {
    expect(parseJudgeScore({ ...grade(0), scale: { ...grade().scale, max: 0 } })?.normalized).toBeUndefined();
    expect(parseJudgeScore({ ...grade(1), scale: { ...grade().scale, min: -Number.MAX_VALUE, max: Number.MAX_VALUE } })?.value).toBe(1);
  });
});

describe('judge confidence and distribution semantics', () => {
  it('should require documented native confidence rather than treating a score as confidence', () => {
    const confidence = { value: 0.8, min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'descriptor:v1', origin: 'provider' };
    expect(parseJudgeConfidence(confidence)).toEqual(confidence);
    expect(parseJudgeConfidence(grade())).toBeNull();
    expect(parseJudgeConfidence({ ...confidence, meaning: 'probability-correct' })).toBeNull();
    expect(parseJudgeConfidence({ ...confidence, value: 1.1 })).toBeNull();
    expect(parseJudgeConfidence({ ...confidence, meaningRef: '' })).toBeNull();
  });
  const outcomes = [{ outcome: 'Unsupported', nativeOutcome: '0' }, { outcome: 'Supported', nativeOutcome: '1' }];
  it('should map native keys to ordered labels without leaking descriptions or renormalizing', () => {
    expect(mapJudgeDistribution({ '1': 0.40005, '0': 0.6 }, outcomes)).toEqual([
      { outcome: 'Unsupported', nativeOutcome: '0', probability: 0.6 },
      { outcome: 'Supported', nativeOutcome: '1', probability: 0.40005 },
    ]);
  });
  it('should refuse missing, extra, non-finite or inconsistent probability sets', () => {
    for (const probabilities of [{ '0': 1 }, { '0': 1, '1': 0, extra: 0 },
      { '0': 0.2, '1': 0.2 }, { '0': NaN, '1': 1 }, { '0': -0.1, '1': 1.1 }]) {
      expect(mapJudgeDistribution(probabilities, outcomes)).toBeNull();
    }
    expect(mapJudgeDistribution({ '0': 1, '1': 0 }, [outcomes[0], { ...outcomes[1], outcome: 'Unsupported' }])).toBeNull();
  });
});
