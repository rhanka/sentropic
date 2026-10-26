import { describe, expect, it } from 'vitest';
import { deriveDecision, hasDecisionVerdictValue, mapDecisionDistribution, parseDecisionConfidence, parseDecisionScore } from '../src/decision/verdict.js';
import type { DecisionScore } from '../src/decision/verdict.js';

const grade = (value = 1.25) => ({ value, meaning: 'rubric-grade',
  scale: { kind: 'bounded', min: 0, max: 2, direction: 'higher-is-better' } });

const drift = <T extends object>(target: T, field: string) => {
  let reads = 0;
  return new Proxy(target, {
    get(object, key, receiver) {
      if (key === field && ++reads > 1) return 999;
      return Reflect.get(object, key, receiver);
    },
  });
};

describe('native decision score semantics', () => {
  it('should return the validated score when live property reads change later', () => {
    expect(parseDecisionScore(drift(grade(), 'value'))?.value).toBe(1.25);
  });
  it('should retain fractional grades and avoid reversing lower-is-better scores', () => {
    expect(parseDecisionScore(grade())?.value).toBe(1.25);
    expect(parseDecisionScore(grade())?.normalized?.value).toBe(0.625);
    expect(parseDecisionScore({ ...grade(), scale: { ...grade().scale, direction: 'lower-is-better' } })?.normalized?.value).toBe(0.625);
  });
  it('should retain unknown-scale values without inventing normalization', () => {
    expect(parseDecisionScore({ value: -42, meaning: 'provider-defined', scale: { kind: 'unknown', reason: 'unknown (source-gap)' } }))
      .toEqual({ value: -42, meaning: 'provider-defined', scale: { kind: 'unknown', reason: 'unknown (source-gap)' } });
  });
  it('should refuse non-finite, out-of-range or contradictory scores without repair', () => {
    for (const value of [grade(NaN), grade(2.1), { ...grade(), value: true },
      { ...grade(), normalized: { value: 1, transform: 'linear-min-max' } },
      { ...grade(), scale: { ...grade().scale, min: 3 } }]) expect(parseDecisionScore(value)).toBeNull();
    expect(parseDecisionScore({ ...grade(2), normalized: { value: 1 + 1e-13, transform: 'linear-min-max' } })).toBeNull();
  });
  it('should preserve valid native values when a scale cannot be normalized', () => {
    expect(parseDecisionScore({ ...grade(0), scale: { ...grade().scale, max: 0 } })?.normalized).toBeUndefined();
    expect(parseDecisionScore({ ...grade(1), scale: { ...grade().scale, min: -Number.MAX_VALUE, max: Number.MAX_VALUE } })?.value).toBe(1);
  });
});

describe('explicit decision decision semantics', () => {
  const input = () => ({ score: parseDecisionScore(grade()), label: null, providerDecision: null });
  it('should leave probabilities undecided unless an explicit native-unit rule is supplied', () => {
    expect(deriveDecision(input())).toEqual({ ok: true, decision: null });
    expect(deriveDecision({ ...input(), rule: { kind: 'threshold', field: 'score', op: 'gte', value: 1.5 } }))
      .toMatchObject({ ok: true, decision: { pass: false, origin: 'threshold' } });
    expect(deriveDecision({ ...input(), rule: { kind: 'threshold', field: 'score', op: 'gte', value: 3 } }))
      .toEqual({ ok: false, code: 'REQUEST_INVALID' });
    const malformed = { value: 0.5, scale: null, meaning: 'provider-defined' } as unknown as DecisionScore;
    expect(deriveDecision({ ...input(), score: malformed, rule: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }))
      .toEqual({ ok: false, code: 'VERDICT_INVALID' });
  });
  it('should preserve native false and refuse replacing it or inventing a native boolean', () => {
    expect(deriveDecision({ ...input(), providerDecision: false })).toEqual({ ok: true, decision: { pass: false, origin: 'provider' } });
    expect(deriveDecision({ ...input(), providerDecision: false, rule: { kind: 'labels', passing: ['yes'] } }).ok).toBe(false);
    expect(deriveDecision({ ...input(), rule: { kind: 'provider' } })).toEqual({ ok: false, code: 'CAPABILITY_UNSUPPORTED' });
    expect(deriveDecision({ ...input(), providerDecision: 'false' as unknown as boolean, rule: { kind: 'provider' } }))
      .toEqual({ ok: false, code: 'VERDICT_INVALID' });
  });
  it('should derive label decisions only from declared options', () => {
    const choice = { ...input(), label: 'b', declaredLabels: ['a', 'b'], rule: { kind: 'labels' as const, passing: ['a'] } };
    expect(deriveDecision(choice)).toMatchObject({ ok: true, decision: { pass: false, origin: 'labels' } });
    expect(deriveDecision({ ...choice, label: 'unexpected' })).toEqual({ ok: false, code: 'VERDICT_INVALID' });
    expect(deriveDecision({ ...choice, rule: { kind: 'labels', passing: ['unknown'] } })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
  });
  it('should refuse empty evidence while retaining zero scores and negative verdicts', () => {
    const empty = { score: null, decision: null, label: null };
    expect(hasDecisionVerdictValue(empty)).toBe(false);
    expect(hasDecisionVerdictValue({ ...empty, score: parseDecisionScore(grade(0)) })).toBe(true);
    expect(hasDecisionVerdictValue({ ...empty, decision: { pass: false, origin: 'provider' } })).toBe(true);
  });
});

describe('decision confidence and distribution semantics', () => {
  it('should retain validated confidence despite later live property drift', () => {
    const confidence = { value: 0.8, min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'descriptor:v1', origin: 'provider' };
    expect(parseDecisionConfidence(drift(confidence, 'value'))).toEqual(confidence);
  });
  it('should retain validated probabilities despite later live property drift', () => {
    expect(mapDecisionDistribution(drift({ '0': 0.6, '1': 0.4 }, '0'), outcomes)).toEqual([
      { outcome: 'Unsupported', nativeOutcome: '0', probability: 0.6 },
      { outcome: 'Supported', nativeOutcome: '1', probability: 0.4 },
    ]);
  });
  it('should snapshot the declared outcome table and refuse accessors without invoking them', () => {
    const declared = [drift({ outcome: 'Unsupported', nativeOutcome: '0' }, 'outcome'), outcomes[1]];
    expect(mapDecisionDistribution({ '0': 0.6, '1': 0.4 }, declared)?.[0].outcome).toBe('Unsupported');
    let reads = 0;
    const getter = { get outcome() { reads++; return reads === 1 ? 'Unsupported' : 'drift'; }, nativeOutcome: '0' };
    expect(mapDecisionDistribution({ '0': 0.6, '1': 0.4 }, [getter, outcomes[1]])).toBeNull();
    expect(reads).toBe(0);
  });
  it('should require documented native confidence rather than treating a score as confidence', () => {
    const confidence = { value: 0.8, min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'descriptor:v1', origin: 'provider' };
    expect(parseDecisionConfidence(confidence)).toEqual(confidence);
    expect(parseDecisionConfidence(grade())).toBeNull();
    expect(parseDecisionConfidence({ ...confidence, meaning: 'probability-correct' })).toBeNull();
    expect(parseDecisionConfidence({ ...confidence, value: 1.1 })).toBeNull();
    expect(parseDecisionConfidence({ ...confidence, meaningRef: '' })).toBeNull();
  });
  const outcomes = [{ outcome: 'Unsupported', nativeOutcome: '0' }, { outcome: 'Supported', nativeOutcome: '1' }];
  it('should map native keys to ordered labels without leaking descriptions or renormalizing', () => {
    expect(mapDecisionDistribution({ '1': 0.40005, '0': 0.6 }, outcomes)).toEqual([
      { outcome: 'Unsupported', nativeOutcome: '0', probability: 0.6 },
      { outcome: 'Supported', nativeOutcome: '1', probability: 0.40005 },
    ]);
  });
  it('should refuse missing, extra, non-finite or inconsistent probability sets', () => {
    for (const probabilities of [{ '0': 1 }, { '0': 1, '1': 0, extra: 0 },
      { '0': 0.2, '1': 0.2 }, { '0': NaN, '1': 1 }, { '0': -0.1, '1': 1.1 }]) {
      expect(mapDecisionDistribution(probabilities, outcomes)).toBeNull();
    }
    expect(mapDecisionDistribution({ '0': 1, '1': 0 }, [outcomes[0], { ...outcomes[1], outcome: 'Unsupported' }])).toBeNull();
  });
});
