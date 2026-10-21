import { describe, expect, it } from 'vitest';
import { parseDecisionValidationContext } from '../src/decision/validation-context.js';
import { decisionRequest } from './decision-fixtures.js';

const NOW = 1_700_000_000_000;
const DIGEST = 'a'.repeat(64);

const context = (overrides: Record<string, unknown> = {}) => ({
  evaluator: { ...decisionRequest().evaluator },
  validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
  acceptedServedModelIds: ['synthetic-served-model'],
  semantics: { nativeDecision: false,
    score: { meaning: 'probability-true', min: 0, max: 1 },
    confidence: { meaning: 'provider-confidence', min: 0, max: 1 },
    rationale: 'forbidden' },
  definitionDigest: DIGEST,
  ...overrides,
});

describe('decision validation context parsing', () => {
  it('accepts a valid native context detached and frozen', () => {
    const parsed = parseDecisionValidationContext(context(), decisionRequest(), NOW);
    expect(parsed?.validationProfile.profile).toBe('native-distribution-v1');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.acceptedServedModelIds)).toBe(true);
  });
  it.each([
    [{ evaluator: { providerId: 'other', evaluatorId: 'jev-1.13.0', revision: 'synthetic-v1' } }],
    [{ validationProfile: { profile: 'unknown-v9', version: 'v1' } }],
    [{ acceptedServedModelIds: [] }],
    [{ acceptedServedModelIds: ['a', 'a'] }],
    [{ definitionDigest: 'short' }],
    [{ semantics: { nativeDecision: false, score: null, confidence: null, rationale: 'sometimes' } }],
  ])('rejects malformed binding %j', (overrides) => {
    expect(parseDecisionValidationContext(context(overrides as Record<string, unknown>), decisionRequest(), NOW)).toBeNull();
  });
  it('rejects a registered request without trusted resolution', () => {
    const request = decisionRequest({ criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
    expect(parseDecisionValidationContext(context(), request, NOW)).toBeNull();
  });
  it('rejects a direct request carrying a resolution', () => {
    const request = decisionRequest();
    const resolution = { criteriaId: 'c1', revision: 'r1', resolvedKind: 'binary',
      criterion: { kind: 'binary', instructions: 'Check.' },
      resolvedAt: new Date(NOW - 1_000).toISOString(), maxAgeMs: 60_000 };
    expect(parseDecisionValidationContext(context({ registeredResolution: resolution }), request, NOW)).toBeNull();
  });
  const registeredRequest = () => decisionRequest({ criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
  const resolution = (overrides: Record<string, unknown> = {}) => ({
    criteriaId: 'c1', revision: 'r1', resolvedKind: 'binary',
    criterion: { kind: 'binary', instructions: 'Check.' },
    resolvedAt: new Date(NOW - 1_000).toISOString(), maxAgeMs: 60_000,
    ...overrides,
  });
  it('accepts a fresh trusted registered resolution', () => {
    const parsed = parseDecisionValidationContext(context({ registeredResolution: resolution() }), registeredRequest(), NOW);
    expect(parsed?.registeredResolution?.resolvedKind).toBe('binary');
  });
  it.each([
    [resolution({ criteriaId: 'other' })],
    [resolution({ revision: 'r2' })],
    [resolution({ resolvedKind: 'choice', criterion: { kind: 'binary', instructions: 'Check.' } })],
    [resolution({ resolvedAt: new Date(NOW + 60_000).toISOString() })],
    [resolution({ resolvedAt: new Date(NOW - 120_000).toISOString() })],
    [resolution({ maxAgeMs: 0 })],
    [resolution({ maxAgeMs: 86_400_001 })],
  ])('rejects wrong identity, kind mismatch, future, stale or unbounded resolution', (bad) => {
    expect(parseDecisionValidationContext(context({ registeredResolution: bad }), registeredRequest(), NOW)).toBeNull();
  });
});
