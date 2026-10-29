import { describe, expect, it } from 'vitest';
import { jevDescriptor } from '../src/decision/descriptor.js';
import { qualifiedDescriptor, decisionRequest } from './decision-fixtures.js';
import { encodeJevRequest } from '../src/decision/jev-codec.js';

describe('JEV descriptor qualification boundary', () => {
  it('keeps production identity and the candidate billing bound unqualified', () => {
    expect(jevDescriptor.acceptedServedModelIds).toEqual(['jev-1.13.0']);
    expect(jevDescriptor.qualification).toEqual({ servedIdentity: 'unqualified', billingBound: 'unqualified',
      evidenceRefs: ['spec/decision/q1-live-smoke.md#jev'] });
    expect(jevDescriptor.maxBillableInputTokens).toBe(65_536);
    expect(jevDescriptor.nativeDecision).toBe(false);
    expect(jevDescriptor.retention).toMatchObject({ status: 'unknown', retentionDays: null });
  });
  it('keeps synthetic qualification detached from production configuration', () => {
    const fixture = qualifiedDescriptor();
    fixture.acceptedServedModelIds.push('another-fixture');
    expect(jevDescriptor.acceptedServedModelIds).toEqual(['jev-1.13.0']);
  });
});

describe('single-question JEV encoding', () => {
  it.each([{ output: null }, { state: null }, { output: null, state: null },
    { input: { nested: [true, 3] }, output: 'candidate', context: ['evidence'], reference: null, state: [] }])(
    'preserves explicit values and absent field boundaries: %j', (inputs) => {
      const result = encodeJevRequest(decisionRequest({ inputs }), qualifiedDescriptor());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.body.state).toStrictEqual(inputs);
      expect(Object.keys(result.body.questions)).toEqual(['verdict']);
      expect(result.body.questions.verdict.instructions).toBe('Check evidence.');
    });
  it('encodes ordered levels and choice IDs without exposing labels as descriptions', () => {
    const graded = encodeJevRequest(decisionRequest({ criterion: { kind: 'graded', instructions: 'Grade.',
      direction: 'lower-is-better', levels: [{ label: 'low', description: 'Low description' },
        { label: 'high', description: 'High description' }] } }), qualifiedDescriptor());
    expect(graded.ok && graded.body.questions.verdict).toEqual({ type: 'score', instructions: 'Grade.',
      criteria: ['Low description', 'High description'] });
    const choice = encodeJevRequest(decisionRequest({ criterion: { kind: 'choice', instructions: 'Choose.',
      options: [{ id: 'B', description: 'Second' }, { id: 'A', description: 'First' }] } }), qualifiedDescriptor());
    expect(choice.ok && Object.keys(choice.body.questions.verdict.criteria!)).toEqual(['B', 'A']);
  });
  it('refuses excessive cardinality, local byte limits and revision substitution', () => {
    const descriptor = qualifiedDescriptor();
    expect(encodeJevRequest(decisionRequest({ evaluator: { ...descriptor.evaluator, revision: 'other' } }), descriptor))
      .toEqual({ ok: false, code: 'REVISION_MISMATCH' });
    expect(encodeJevRequest(decisionRequest(), { ...descriptor, maxStateQuestionBytes: 1 }))
      .toEqual({ ok: false, code: 'REQUEST_INVALID' });
    const levels = Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, description: `Level ${i}` }));
    expect(encodeJevRequest(decisionRequest({ criterion: { kind: 'graded', instructions: 'Grade.',
      direction: 'unordered', levels } }), descriptor)).toEqual({ ok: false, code: 'CAPABILITY_UNSUPPORTED' });
  });
  it('retains integer-like option order in the actual wire JSON', () => {
    const result = encodeJevRequest(decisionRequest({ criterion: { kind: 'choice', instructions: 'Choose.',
      options: [{ id: '2', description: 'Second' }, { id: '1', description: 'First' }] } }), qualifiedDescriptor());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bodyJson.indexOf('"2":')).toBeLessThan(result.bodyJson.indexOf('"1":'));
  });
});
