import { describe, expect, it } from 'vitest';
import { parseEvaluatorDescriptor } from '../src/judge/descriptor-validation.js';
import { qualifiedDescriptor } from './judge-fixtures.js';

describe('descriptor-owned immutable JEV semantics', () => {
  it('detaches and freezes qualified configuration without mutating the caller', () => {
    const input = qualifiedDescriptor();
    const descriptor = parseEvaluatorDescriptor(input);
    expect(descriptor).not.toBeNull();
    input.acceptedServedModelIds[0] = 'changed';
    expect(descriptor?.acceptedServedModelIds).toEqual(['synthetic-served-model']);
    expect(Object.isFrozen(descriptor?.qualification)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });
  it.each([{ wireModel: 'jev-latest' }, { acceptedServedModelIds: [] }, { probabilityTolerance: 0.1 },
    { qualification: { servedIdentity: ['unqualified'], billingBound: 'unqualified', evidenceRefs: [] }, acceptedServedModelIds: [] },
    { qualification: { servedIdentity: 'qualified', billingBound: 'qualified', evidenceRefs: [] } },
    { nativeDecision: true }, { confidence: { meaning: 'decision-confidence', meaningRef: 'fixture:native', min: 0, max: 1 } }])(
    'refuses unpinned or undocumented semantics: %j', (override) => {
      expect(parseEvaluatorDescriptor({ ...qualifiedDescriptor(), ...override })).toBeNull();
    });
});
