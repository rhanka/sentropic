import { describe, expect, it } from 'vitest';
import { discoverDecisionEvaluator, decisionExecutionDigest, decisionQualificationScope } from '../src/decision/qualification.js';
import { createDecisionService } from '../src/decision/service.js';
import { parseDecisionEvaluatorDescriptor } from '../src/decision/descriptor-validation.js';
import { decisionRequest, decisionServiceFixture, qualifiedDescriptor } from './decision-fixtures.js';

export const operatingPolicy = () => ({ revision: 'policy-1', language: 'en', domain: 'support',
  intendedUse: 'assistance', maxInputBytes: 4096, decision: null });

describe('criterion-scoped production admission', () => {
  it('should deny production before credentials or spend when calibration is missing', async () => {
    const f = decisionServiceFixture();
    delete f.descriptor.executionProfile;
    f.options.registry = (await import('../src/registry.js')).createProviderRegistry([
      (await import('../src/decision/adapter.js')).createJevAdapter({ descriptor: f.descriptor, transport: f.transport }),
    ]);
    const result = await createDecisionService(f.options).decide(decisionRequest());
    expect(result).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' },
      receipt: { attempts: 0, schemaVersion: 1, cost: { status: 'not-incurred' } } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.budget.admit).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('should expose independent facts without universal readiness', () => {
    const descriptor = qualifiedDescriptor();
    delete descriptor.executionProfile;
    const facts = discoverDecisionEvaluator(descriptor, { contractConformance: true, transportAccessible: true,
      policy: operatingPolicy(), assessments: [] }, decisionRequest());
    expect(facts).toMatchObject({ identityQualified: true, billingQualified: true, calibrationQualified: false,
      contractConformance: true, transportAccessible: true, productionReady: false, reasons: ['calibration-missing'] });
    expect(discoverDecisionEvaluator(descriptor).productionReady).toBeUndefined();
  });
  it('should admit provisional IDs only for explicit qualification candidates', () => {
    const descriptor = qualifiedDescriptor();
    descriptor.executionProfile = 'qualification';
    descriptor.qualification.servedIdentity = 'unqualified';
    expect(parseDecisionEvaluatorDescriptor(descriptor)).not.toBeNull();
    expect(discoverDecisionEvaluator(descriptor, undefined, decisionRequest()))
      .toMatchObject({ experimental: true, productionReady: false });
    descriptor.executionProfile = 'production';
    expect(parseDecisionEvaluatorDescriptor(descriptor)).toBeNull();
  });
  it('should preserve execution identity when only evidence changes', () => {
    const descriptor = qualifiedDescriptor();
    const digest = decisionExecutionDigest(descriptor);
    descriptor.qualification.evidenceRefs = ['evidence:next-bundle'];
    descriptor.qualification.servedIdentity = 'unqualified';
    expect(decisionExecutionDigest(descriptor)).toBe(digest);
    descriptor.compilation.readout = 'new-readout';
    expect(decisionExecutionDigest(descriptor)).not.toBe(digest);
  });
  it('should bind arbitrary instructions and operating thresholds separately', () => {
    const descriptor = qualifiedDescriptor();
    const request = decisionRequest();
    const scope = decisionQualificationScope(descriptor, request, operatingPolicy());
    expect(scope).not.toBeNull();
    expect(decisionQualificationScope(descriptor,
      decisionRequest({ criterion: { kind: 'binary', instructions: 'Another rubric.' } }), operatingPolicy())).not.toEqual(scope);
    expect(decisionQualificationScope(descriptor, request, { ...operatingPolicy(), revision: 'policy-2' })).not.toEqual(scope);
  });
});
