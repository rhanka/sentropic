import { describe, expect, it } from 'vitest';
import { isBoundedJson, isCorrelationId, isMicroUsd } from '../src/judge/validation.js';
import { isJudgeCriterion, isJudgeDecisionRule } from '../src/judge/criterion.js';

describe('judge request JSON boundary', () => {
  it('should preserve valid JSON and reject values JSON would silently coerce', () => {
    expect(isBoundedJson({ output: null, state: [0, false, 'text'] })).toBe(true);
    for (const value of [NaN, Infinity, undefined, 1n, new Date(), [undefined], Array(1)]) {
      expect(isBoundedJson(value)).toBe(false);
    }
  });
  it('should reject unsafe keys and accessors without invoking user code', () => {
    expect(isBoundedJson(JSON.parse('{"state":{"__proto__":{}}}'))).toBe(false);
    expect(isBoundedJson({ get output() { throw new Error('must not run'); } })).toBe(false);
    expect(isBoundedJson({ [Symbol('hidden')]: 'value' })).toBe(false);
  });
  it('should bound UTF-8 bytes, canonical money and correlation identifiers', () => {
    expect(isBoundedJson('é', 4)).toBe(true);
    expect(isBoundedJson('é', 3)).toBe(false);
    expect(['0', '42', '9007199254740993'].every(isMicroUsd)).toBe(true);
    expect(['01', '-1', '1.0', ' 1', '1e3'].some(isMicroUsd)).toBe(false);
    expect(isCorrelationId('call:one-1.2_3')).toBe(true);
    expect(isCorrelationId('a'.repeat(129))).toBe(false);
    expect(isCorrelationId('line\nbreak')).toBe(false);
  });
});

describe('judge criteria and explicit decision rules', () => {
  it('should preserve ordered labels and allow capabilities beyond JEV cardinalities', () => {
    const levels = Array.from({ length: 11 }, (_, i) => ({ label: String(i), description: `Level ${i}` }));
    expect(isJudgeCriterion({ kind: 'graded', instructions: 'Grade', direction: 'unordered', levels })).toBe(true);
    expect(isJudgeCriterion({ kind: 'graded', instructions: 'Grade', direction: 'unordered', levels: [...levels, levels[0]] })).toBe(false);
    expect(isJudgeCriterion({ kind: 'registered', criteriaId: 'support', revision: 'v1' })).toBe(true);
  });
  it('should reject empty rubrics, duplicate choices and unrecognized criterion fields', () => {
    const option = { id: 'safe', description: 'Safe answer' };
    for (const criterion of [
      { kind: 'binary', instructions: ' ' },
      { kind: 'binary', instructions: 'Check', criteria: { true: 'yes' } },
      { kind: 'choice', instructions: 'Choose', options: [] },
      { kind: 'choice', instructions: 'Choose', options: [option, option] },
      { kind: 'choice', instructions: 'Choose', options: [{ ...option, weight: 1 }] },
      { kind: 'registered', criteriaId: 'support', revision: '' },
    ]) expect(isJudgeCriterion(criterion)).toBe(false);
  });
  it('should require finite thresholds, declared rule fields and unique passing labels', () => {
    const threshold = { kind: 'threshold', field: 'score', op: 'gte', value: 0.7 };
    expect(isJudgeDecisionRule(threshold)).toBe(true);
    expect(isJudgeDecisionRule({ ...threshold, value: Infinity })).toBe(false);
    expect(isJudgeDecisionRule({ kind: 'provider', threshold: 0.5 })).toBe(false);
    expect(isJudgeDecisionRule({ kind: 'labels', passing: ['a', 'a'] })).toBe(false);
  });
});
