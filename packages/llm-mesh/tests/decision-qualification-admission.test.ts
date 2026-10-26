import { describe, expect, it, vi } from 'vitest';
import * as assessment from '../src/decision/assessment.js';
import { createJevAdapter } from '../src/decision/adapter.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import { discoverDecisionEvaluator } from '../src/decision/qualification.js';
import { decisionPrice, decisionServiceFixture } from './decision-fixtures.js';
import { productionFixture } from './decision-production-fixtures.js';
import { validateDecisionResult } from '../src/decision/validate-result.js';
import { trustedNativeContext } from './decision-fixtures.js';

describe('production prerequisites and isolated qualification', () => {
  it('should refuse a qualification descriptor in the default production service', async () => {
    const f = decisionServiceFixture();
    delete f.options.executionProfile;
    expect(await createDecisionService(f.options).decide((await import('./decision-fixtures.js')).decisionRequest()))
      .toMatchObject({ kind: 'error', error: { code: 'PROVIDER_UNAVAILABLE' }, receipt: { attempts: 0 } });
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
  });
  it('should mark even preflight refusals and unresolved descriptor deadlines experimental', async () => {
    const f = decisionServiceFixture();
    expect(await createDecisionService({ ...f.options, evaluatorAllowlist: [] })
      .decide((await import('./decision-fixtures.js')).decisionRequest()))
      .toMatchObject({ experimental: true, receipt: { experimental: true, attempts: 0 } });
    f.options.resolveEvaluator = () => new Promise(() => {});
    expect(await createDecisionService({ ...f.options, policy: { timeoutMs: 5 } })
      .decide((await import('./decision-fixtures.js')).decisionRequest()))
      .toMatchObject({ experimental: true, error: { code: 'TIMEOUT' }, receipt: { experimental: true, attempts: 0 } });
  });
  it('should admit the exact fully qualified recorded scope', async () => {
    const f = productionFixture();
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: true, receipt: { schemaVersion: 1, attempts: 1, budget: { state: 'settled' } } });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it.each(['identity', 'contract', 'billing', 'transport', 'calibration', 'price'] as const)
    ('should deny production independently when %s is missing', async (gate) => {
      const f = productionFixture();
      if (gate === 'contract') f.options.readiness!.contractConformance = false;
      if (gate === 'transport') f.options.readiness!.transportAccessible = false;
      if (gate === 'calibration') f.options.readiness!.assessments = [];
      if (gate === 'identity') {
        f.descriptor.qualification.servedIdentity = 'unqualified';
        f.descriptor.acceptedServedModelIds = [];
        f.options.registry = createProviderRegistry([createJevAdapter({ descriptor: f.descriptor, transport: f.transport })]);
        expect(discoverDecisionEvaluator(f.descriptor, { ...f.options.readiness!, price: decisionPrice() }, f.request))
          .toMatchObject({ identityQualified: false, productionReady: false, reasons: expect.arrayContaining(['identity-unqualified']) });
      }
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
    const request = (await import('./decision-fixtures.js')).decisionRequest({ correlationId: 'qualification-1' });
    const result = await createDecisionService(f.options).decide(request);
    expect(result).toMatchObject({ kind: 'experimental-verdict', ok: true, experimental: true,
      receipt: { attempts: 1, schemaVersion: 1, experimental: true, servedEvaluator: { provisional: true } } });
    expect(validateDecisionResult(request, trustedNativeContext(request), result)).toBeNull();
    // Removing the outer warning still cannot turn the experimental receipt into production evidence.
    const { experimental, ...unmarked } = result;
    expect(experimental).toBe(true);
    expect(validateDecisionResult(request, trustedNativeContext(request), { ...unmarked, kind: 'verdict' })).toBeNull();
    expect(discoverDecisionEvaluator(f.descriptor, undefined, request)).toMatchObject({ experimental: true, productionReady: false });
    expect(f.options.resolveAuth).toHaveBeenCalledTimes(1);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
    expect(f.state.receipts[0]).toMatchObject({ experimental: true, servedEvaluator: { provisional: true } });
  });
  it('should mark qualification failures and deadline outputs experimental', async () => {
    const f = decisionServiceFixture();
    f.options.resolveAuth = async () => { throw new Error('no credentials'); };
    expect(await createDecisionService(f.options).decide((await import('./decision-fixtures.js')).decisionRequest()))
      .toMatchObject({ kind: 'error', experimental: true, receipt: { experimental: true, attempts: 0 } });
    f.options.resolveAuth = () => new Promise(() => {});
    expect(await createDecisionService({ ...f.options, policy: { timeoutMs: 5 } })
      .decide((await import('./decision-fixtures.js')).decisionRequest()))
      .toMatchObject({ experimental: true, error: { code: 'TIMEOUT' }, receipt: { experimental: true, attempts: 0 } });
  });
  it('should snapshot calibration evidence before asynchronous price resolution', async () => {
    const f = productionFixture();
    const service = createDecisionService(f.options);
    f.options.readiness!.assessments = [];
    expect(await service.decide(f.request)).toMatchObject({ ok: true });
  });
  it('should reuse exact-scope assessments while rechecking price and refusing changed criteria', async () => {
    const f = productionFixture();
    const assess = vi.spyOn(assessment, 'assessDecisionCalibration');
    try {
      const service = createDecisionService(f.options);
      const price = vi.mocked(f.options.resolvePrice);
      expect(await service.decide(f.request)).toMatchObject({ ok: true });
      expect(await service.decide(f.request)).toMatchObject({ ok: true });
      expect(assess).toHaveBeenCalledTimes(1);
      price.mockReturnValueOnce(null);
      expect(await service.decide(f.request)).toMatchObject({ ok: false, receipt: { attempts: 0 } });
      expect(assess).toHaveBeenCalledTimes(1);
      const other = { ...f.request, criterion: { kind: 'binary' as const, instructions: 'Different rubric.' } };
      expect(await service.decide(other)).toMatchObject({ ok: false, receipt: { attempts: 0 } });
      expect(assess).toHaveBeenCalledTimes(2);
    } finally { assess.mockRestore(); }
  });
  it('should retain production custody, one-attempt settlement and deadline refusal', async () => {
    const f = productionFixture();
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ kind: 'verdict', ok: true });
    expect(f.options.resolveAuth).toHaveBeenCalledTimes(1);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
    expect(f.state.receipts[0].experimental).toBeUndefined();
    f.options.resolvePrice = async () => { f.state.now = 60001; return decisionPrice(); };
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'TIMEOUT' }, receipt: { attempts: 0, cost: { status: 'not-incurred' } } });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
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
