import { describe, expect, it } from 'vitest';
import { decodeJevVerdict } from '../src/decision/jev-verdict.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

const choice = decisionRequest({ criterion: { kind: 'choice', instructions: 'Choose.',
  options: [{ id: 'B', description: 'Second' }, { id: 'A', description: 'First' }] } });
describe('native JEV Noul and Choice', () => {
  it('retains a zero probability and an explicit negative decision without confidence', () => {
    const result = decodeJevVerdict({ noul: 0 }, decisionRequest({ decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }), qualifiedDescriptor());
    expect(result.ok && result.verdict).toMatchObject({ criterionKind: 'binary', resolvedCriterionKind: 'binary',
      score: { value: 0, scale: { direction: 'unordered' } }, decision: { pass: false, origin: 'threshold' },
      rationale: null, confidence: null, distribution: null });
  });
  it.each([{ noul: true }, { noul: -0.1 }, { noul: 1.1 }, {}, { noul: 0.5, confidence: 0.8 }])(
    'refuses malformed binary values and unexpected primitive fields: %j', (answer) => {
      expect(decodeJevVerdict(answer, decisionRequest(), qualifiedDescriptor())).toEqual({ ok: false, code: 'VERDICT_INVALID' });
    });
  it('preserves declared option order and accepts an argmax tie only for a tied choice', () => {
    const result = decodeJevVerdict({ choice: 'A', probabilities: { A: 0.5, B: 0.5 }, confidence: 0.8 }, choice, qualifiedDescriptor());
    expect(result.ok && result.verdict.distribution?.map((entry) => entry.outcome)).toEqual(['B', 'A']);
    expect(result.ok && result.verdict.confidence).toMatchObject({ value: 0.8, meaning: 'provider-confidence' });
    expect(decodeJevVerdict({ choice: 'B', probabilities: { A: 0.7, B: 0.3 }, confidence: 0.8 }, choice, qualifiedDescriptor()).ok).toBe(false);
  });
  it.each([{ choice: 'C', probabilities: { A: 0.5, B: 0.5 }, confidence: 0.8 },
    { choice: 'A', probabilities: { A: 0.5 }, confidence: 0.8 },
    { choice: 'A', probabilities: { A: 0.5, B: 0.5 }, confidence: 2 }])('refuses undeclared keys or invalid native confidence', (answer) => {
    expect(decodeJevVerdict(answer, choice, qualifiedDescriptor()).ok).toBe(false);
  });
  it('resolves registered kinds from the pinned descriptor and refuses wrong primitive data', () => {
    const descriptor = qualifiedDescriptor();
    descriptor.registeredCriteria = [{ criteriaId: 'check', revision: 'r1', criterion: { kind: 'binary', instructions: 'Check.' } }];
    const request = decisionRequest({ criterion: { kind: 'registered', criteriaId: 'check', revision: 'r1' } });
    const result = decodeJevVerdict({ noul: 0.2 }, request, descriptor);
    expect(result.ok && result.verdict).toMatchObject({ criterionKind: 'registered', resolvedCriterionKind: 'binary' });
    expect(decodeJevVerdict({ noul: 0.2 }, choice, descriptor).ok).toBe(false);
  });
});
