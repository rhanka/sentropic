import { describe, expect, it } from 'vitest';
import { createJevAdapter } from '../src/decision/adapter.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import { discoverDecisionEvaluator } from '../src/decision/qualification.js';
import { decisionPrice, decisionServiceFixture } from './decision-fixtures.js';
import { assessmentFixture } from './decision-assessment-fixtures.js';

function productionFixture() {
  const f = decisionServiceFixture();
  const a = assessmentFixture();
  delete a.descriptor.executionProfile;
  f.options.registry = createProviderRegistry([createJevAdapter({ descriptor: a.descriptor, transport: f.transport })]);
  f.options.resolveEvaluator = () => a.descriptor;
  f.options.readiness = { contractConformance: true, transportAccessible: true, policy: a.policy, assessments: [a.assessment] };
  return { ...f, ...a };
}

describe('production prerequisites and isolated qualification', () => {
  it('should admit the exact fully qualified recorded scope', async () => {
    const f = productionFixture();
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: true, receipt: { schemaVersion: 1, attempts: 1, budget: { state: 'settled' } } });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it.each(['contract', 'billing', 'transport', 'calibration', 'price'] as const)
    ('should deny production independently when %s is missing', async (gate) => {
      const f = productionFixture();
      if (gate === 'contract') f.options.readiness!.contractConformance = false;
      if (gate === 'transport') f.options.readiness!.transportAccessible = false;
      if (gate === 'calibration') f.options.readiness!.assessments = [];
      if (gate === 'billing') {
        f.descriptor.qualification.billingBound = 'unqualified';
        f.options.registry = createProviderRegistry([createJevAdapter({ descriptor: f.descriptor, transport: f.transport })]);
      }
      if (gate === 'price') f.options.resolvePrice = () => ({ ...decisionPrice(), protocol: 'openai-decisions' });
      const result = await createDecisionService(f.options).decide(f.request);
      expect(result).toMatchObject({ ok: false, receipt: { attempts: 0, cost: { status: 'not-incurred' } } });
      expect(f.transport.send).not.toHaveBeenCalled();
      expect(f.options.resolveAuth).not.toHaveBeenCalled();
      expect(f.budget.admit).not.toHaveBeenCalled();
    });
  it('should execute provisional qualification with custody and one settled receipt', async () => {
    const f = decisionServiceFixture();
    f.descriptor.qualification.servedIdentity = 'unqualified';
    f.options.registry = createProviderRegistry([createJevAdapter({ descriptor: f.descriptor, transport: f.transport })]);
    const request = (await import('./decision-fixtures.js')).decisionRequest();
    expect(await createDecisionService(f.options).decide(request)).toMatchObject({ ok: true, receipt: { attempts: 1, schemaVersion: 1 } });
    expect(discoverDecisionEvaluator(f.descriptor, undefined, request)).toMatchObject({ experimental: true, productionReady: false });
    expect(f.options.resolveAuth).toHaveBeenCalledTimes(1);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
  });
  it('should snapshot calibration evidence before asynchronous price resolution', async () => {
    const f = productionFixture();
    const service = createDecisionService(f.options);
    f.options.readiness!.assessments = [];
    expect(await service.decide(f.request)).toMatchObject({ ok: true });
  });
  it.each(['revision', 'model', 'inventory', 'template', 'schema', 'readout', 'bound', 'price', 'score'] as const)
    ('should invalidate calibration after an execution %s change', (field) => {
      const f = productionFixture();
      if (field === 'revision') f.descriptor.evaluator.revision = 'synthetic-v2';
      if (field === 'model') f.descriptor.wireModel = 'jev-1.14.0';
      if (field === 'inventory') f.descriptor.acceptedServedModelIds = ['new-bytes-or-quantization'];
      if (field === 'template') f.descriptor.compilation.templateDigest = 'f'.repeat(64);
      if (field === 'schema') f.descriptor.compilation.schemaDigest = 'e'.repeat(64);
      if (field === 'readout') f.descriptor.compilation.readout = 'new-runtime-readout';
      if (field === 'bound') f.descriptor.maxBillableInputTokens++;
      if (field === 'price') f.descriptor.priceProtocol.revision = 'new-protocol-price';
      if (field === 'score') f.descriptor.scoreSemantics = { meaning: 'changed', meaningRef: 'fixture:changed' };
      expect(discoverDecisionEvaluator(f.descriptor, { ...f.options.readiness!, price: decisionPrice() }, f.request))
        .toMatchObject({ calibrationQualified: false, productionReady: false });
    });
});
