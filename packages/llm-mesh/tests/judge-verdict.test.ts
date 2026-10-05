import { describe, expect, it } from 'vitest';
import { parseJudgeScore } from '../src/judge/verdict.js';

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
