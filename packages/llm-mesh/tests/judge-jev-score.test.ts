import { describe, expect, it } from 'vitest';
import { decodeJevVerdict } from '../src/judge/jev-verdict.js';
import { judgeRequest, qualifiedDescriptor } from './judge-fixtures.js';

const request = judgeRequest({ criterion: { kind: 'graded', instructions: 'Grade.', direction: 'lower-is-better',
  levels: [{ label: 'low', description: 'Low evidence' }, { label: 'middle', description: 'Middle evidence' },
    { label: 'high', description: 'High evidence' }] } });
const native = () => ({ score: 1.25, probabilities: { '2': 0.35, '0': 0.1, '1': 0.55 },
  legend: { '0': 'Low evidence', '1': 'Middle evidence', '2': 'High evidence' }, confidence: 0.7 });

describe('JEV fractional score and distribution', () => {
  it('retains fractional native units, rubric direction and index-to-label order', () => {
    const result = decodeJevVerdict(native(), request, qualifiedDescriptor());
    expect(result.ok && result.verdict.score).toMatchObject({ value: 1.25,
      scale: { min: 0, max: 2, direction: 'lower-is-better' }, normalized: { value: 0.625 } });
    expect(result.ok && result.verdict.distribution?.map((entry) => [entry.nativeOutcome, entry.outcome]))
      .toEqual([['0', 'low'], ['1', 'middle'], ['2', 'high']]);
    expect(result.ok && result.verdict.label).toBeNull();
  });
  it.each([{ ...native(), score: 3 }, { ...native(), score: 1.4 }, { ...native(), score: NaN },
    { ...native(), probabilities: { low: 0.1, middle: 0.55, high: 0.35 } },
    { ...native(), legend: { '0': 'Low evidence', '1': 'Changed', '2': 'High evidence' } },
    { ...native(), confidence: null }])('refuses inconsistent score, legend or confidence without repair: %j', (answer) => {
    expect(decodeJevVerdict(answer, request, qualifiedDescriptor())).toEqual({ ok: false, code: 'VERDICT_INVALID' });
  });
  it('derives explicit decisions in native units without rounding', () => {
    const result = decodeJevVerdict(native(), { ...request,
      decision: { kind: 'threshold', field: 'score', op: 'lte', value: 1.2 } }, qualifiedDescriptor());
    expect(result.ok && result.verdict.decision).toMatchObject({ pass: false, origin: 'threshold' });
  });
  it('uses a tighter pinned tolerance and never renormalizes probabilities', () => {
    const answer = { ...native(), probabilities: { '0': 0.10001, '1': 0.55, '2': 0.35 } };
    expect(decodeJevVerdict(answer, request, qualifiedDescriptor()).ok).toBe(true);
    expect(decodeJevVerdict(answer, request, { ...qualifiedDescriptor(), probabilityTolerance: 1e-6 }).ok).toBe(false);
  });
});
