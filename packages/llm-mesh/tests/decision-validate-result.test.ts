import { describe, expect, it } from 'vitest';
import * as consumer from '../src/decision/index.js';
import { validateDecisionResult } from '../src/decision/validate-result.js';
import { parseDecisionValidationContext } from '../src/decision/validation-context.js';
import { decisionRequest, decisionServiceFixture } from './decision-fixtures.js';

describe('public pure result validator (F6)', () => {
  it('exposes the pure validator on the packed consumer surface', () => {
    expect(consumer).toHaveProperty('validateDecisionResult');
    expect(typeof consumer.validateDecisionResult).toBe('function');
  });
  it('accepts a real service envelope and rejects a raw canary with no I/O', async () => {
    const fixture = decisionServiceFixture();
    const request = decisionRequest({ correlationId: 'f6-pure' });
    const { createDecisionService } = await import('../src/decision/service.js');
    const served = await createDecisionService(fixture.options).decide(request);
    expect(served.ok).toBe(true);
    if (!served.ok || !('verdict' in served)) throw new Error('fixture failed');
    const context = parseDecisionValidationContext({ evaluator: { ...request.evaluator },
      validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
      acceptedServedModelIds: ['synthetic-served-model'],
      semantics: { nativeDecision: false,
        score: { meaning: 'probability-true', min: 0, max: 1 },
        confidence: { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
        rationale: 'forbidden' },
      definitionDigest: 'a'.repeat(64) }, request, Date.now());
    expect(context).not.toBeNull();
    const wire = { kind: 'verdict', ok: true, verdict: (served as { verdict: unknown }).verdict,
      receipt: (served as { receipt: unknown }).receipt };
    expect(validateDecisionResult(request, context, wire)).not.toBeNull();
    const canary = structuredClone(wire) as { verdict: { providerRaw: unknown } };
    canary.verdict.providerRaw = { data: { secretCanary: 'F6_CANARY' }, bytes: 0, truncated: false };
    expect(validateDecisionResult(request, context, canary)).toBeNull();
  });
});
