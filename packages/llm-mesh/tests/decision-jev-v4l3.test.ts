import { describe, expect, it } from 'vitest';
import { decodeJevVerdict } from '../src/decision/jev-verdict.js';
import { decodeJevResponse } from '../src/decision/jev-response.js';
import { jevDescriptor } from '../src/decision/descriptor.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

// TypeSafe System One API reference, retrieved 2026-10-26. Synthetic values;
// pinned jev-1.13.0 wire contract, not a live provider recording.
const fixtures = [
  { criterion: { kind: 'binary', instructions: 'Check.' }, answer: { type: 'noul', noul: 0 } },
  { criterion: { kind: 'choice', instructions: 'Choose.', options: [
    { id: 'A', description: 'First' }, { id: 'B', description: 'Second' }] },
  answer: { type: 'choice', choice: 'B', probabilities: { A: 0.5, B: 0.5 }, confidence: 0.8 } },
  { criterion: { kind: 'graded', instructions: 'Grade.', direction: 'higher-is-better', levels: [
    { label: 'low', description: 'Low' }, { label: 'high', description: 'High' }] },
  answer: { type: 'score', score: 0.75, probabilities: { '0': 0.25, '1': 0.75 },
    legend: { '0': 'Low', '1': 'High' }, confidence: 0.8 } },
] as const;

describe('P25 JEV 1.13.0 documented answer discriminator', () => {
  it.each(fixtures)('should accept the exact $answer.type shape', ({ criterion, answer }) => {
    const result = decodeJevVerdict(answer, decisionRequest({ criterion }), qualifiedDescriptor());
    expect(result.ok).toBe(true);
    expect(result.ok && result.verdict.rationale).toBeNull();
  });
  it.each(fixtures)('should reject contradictory or extended $answer.type answers', ({ criterion, answer }) => {
    const request = decisionRequest({ criterion });
    for (const bad of [{ ...answer, type: 'refusal' }, { ...answer, type: null },
      { ...answer, type: answer.type === 'noul' ? 'score' : 'noul' }, { ...answer, canary: 'undeclared' }]) {
      expect(decodeJevVerdict(bad, request, qualifiedDescriptor())).toEqual({ ok: false, code: 'VERDICT_INVALID' });
    }
  });
  it('should keep the pinned baseline unqualified without upgrading its model', () => {
    expect(jevDescriptor.wireModel).toBe('jev-1.13.0');
    expect(jevDescriptor.acceptedServedModelIds).toEqual([]);
    expect(jevDescriptor.qualification).toMatchObject({ servedIdentity: 'unqualified', billingBound: 'unqualified' });
  });
  it.each(fixtures)('should require the versioned discriminator at the provider boundary for $answer.type', ({ criterion, answer }) => {
    const request = decisionRequest({ criterion });
    const body = { model: 'synthetic-served-model', answers: { verdict: answer }, usage: { input_tokens: 1000, output_tokens: 0 } };
    expect(decodeJevResponse(body, request, qualifiedDescriptor()).ok).toBe(true);
    const { type: _discriminator, ...primitive } = answer;
    expect(decodeJevResponse({ ...body, answers: { verdict: primitive } }, request, qualifiedDescriptor()))
      .toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' }, usage: { tokens: { input: { value: 1000 } } } });
  });
});
