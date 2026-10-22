import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import { createJevAdapter } from '../src/decision/adapter.js';
import { preflightDecisionRequest } from '../src/decision/service.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';
import type { DecisionEvaluatorDescriptor } from '../src/decision/descriptor.js';

const preflightWithAdapterDescriptor = async (mutate: (descriptor: DecisionEvaluatorDescriptor) => void) => {
  const serviceDescriptor = qualifiedDescriptor();
  const adapterDescriptor = qualifiedDescriptor();
  mutate(adapterDescriptor);
  const send = vi.fn();
  const adapter = createJevAdapter({ descriptor: adapterDescriptor, transport: { send } });
  const options = { registry: createProviderRegistry([adapter]), resolveEvaluator: vi.fn(() => serviceDescriptor),
    evaluatorAllowlist: [{ ...serviceDescriptor.evaluator }] };
  const result = await preflightDecisionRequest(decisionRequest(), options);
  return { result, send, resolveEvaluator: options.resolveEvaluator };
};

describe('canonical definition equality (P17/P27-L2)', () => {
  it('accepts an exactly matching service/adapter pair', async () => {
    const { result, send } = await preflightWithAdapterDescriptor(() => {});
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    ['template digest', (d) => { d.compilation = { ...d.compilation, templateDigest: '2'.repeat(64) }; }],
    ['schema digest', (d) => { d.compilation = { ...d.compilation, schemaDigest: '3'.repeat(64) }; }],
    ['readout identity', (d) => { d.compilation = { ...d.compilation, readout: 'other-readout-v9' }; }],
    ['price protocol revision', (d) => { d.priceProtocol = { ...d.priceProtocol, revision: 'other-price-v9' }; }],
    ['price authority', (d) => { d.priceProtocol = { ...d.priceProtocol, authority: 'other-authority' }; }],
    ['execution bound', (d) => { d.maxBillableInputTokens = 1; }],
    ['probability tolerance', (d) => { d.probabilityTolerance = 0; }],
    ['confidence evidence reference', (d) => { d.confidence = { ...d.confidence, meaningRef: 'other-ref' }; }],
    ['qualification billing bound', (d) => { d.qualification = { ...d.qualification, billingBound: 'unqualified' }; }],
    ['registered criteria set', (d) => { d.registeredCriteria = [{ criteriaId: 'extra', revision: 'r1',
      criterion: { kind: 'binary', instructions: 'Extra.' } }]; }],
  ])('refuses a pair differing only in %s before any send', async (_label, mutate) => {
    const { result, send } = await preflightWithAdapterDescriptor(
      mutate as (descriptor: DecisionEvaluatorDescriptor) => void);
    expect(result).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses a provider adapter with no complete descriptor (F4)', async () => {
    const descriptor = qualifiedDescriptor();
    const send = vi.fn();
    const adapter = { provider: createJevAdapter({ descriptor, transport: { send } }).provider,
      listEvaluators: () => [{ ...descriptor.evaluator }], decision: vi.fn() };
    const options = { registry: createProviderRegistry([adapter as never]),
      resolveEvaluator: vi.fn(() => descriptor), evaluatorAllowlist: [{ ...descriptor.evaluator }] };
    const result = await preflightDecisionRequest(decisionRequest(), options as never);
    expect(result).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
  });
});
