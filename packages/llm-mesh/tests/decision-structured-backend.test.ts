import { describe, expect, it, vi } from 'vitest';
import { createStructuredDecisionAdapter } from '../src/decision/structured.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

const structuredDescriptor = () => {
  const base = qualifiedDescriptor();
  return { ...base, protocol: 'structured-llm' as const,
    evaluator: { ...base.evaluator, evaluatorId: 'structured-judge-v1' },
    wireModel: 'structured-judge-v1', scoreNativeKeys: 'scalar' as const, nativeDecision: true,
    acceptedServedModelIds: ['synthetic-structured-model'],
    confidence: { meaning: 'support', meaningRef: 'fixture:structured-support', min: 0, max: 1 } };
};
const adapterWith = (text: string, servedModelId = 'synthetic-structured-model') => {
  const send = vi.fn(async () => text);
  const adapter = createStructuredDecisionAdapter({ descriptor: structuredDescriptor() as never,
    transport: { send }, servedModelId });
  return { adapter, send };
};

describe('structured backend discrimination (P23)', () => {
  it.each([
    ['malformed body', 'not-a-record'],
    ['refusal body', JSON.stringify({ refusal: 'cannot decide' })],
    ['extra key', JSON.stringify({ score: 0.7, extra: 1 })],
    ['missing score', JSON.stringify({})],
    ['prose number', JSON.stringify({ score: '0.7 probably' })],
    ['clamped score', JSON.stringify({ score: 1.5 })],
    ['default-injected score', JSON.stringify({ score: 0, defaulted: true })],
  ])('produces no verdict for %s with a single transport call', async (_label, text) => {
    const { adapter, send } = adapterWith(text);
    const result = await adapter.decision(decisionRequest());
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps valid scalar and label-only controls passing with one call each', async () => {
    const scalar = adapterWith(JSON.stringify({ score: 0.7 }));
    const scalarResult = await scalar.adapter.decision(decisionRequest());
    expect(scalarResult.ok).toBe(true);
    expect(scalar.send).toHaveBeenCalledTimes(1);
    const choiceRequest = decisionRequest({ criterion: { kind: 'choice', instructions: 'Pick.',
      options: [{ id: 'a', description: 'A' }] } });
    const label = adapterWith(JSON.stringify({ label: 'a' }));
    const labelResult = await label.adapter.decision(choiceRequest);
    expect(labelResult.ok).toBe(true);
    expect(label.send).toHaveBeenCalledTimes(1);
  });
  it('serves scalar and label-only controls through the host with one transport call (F3)', async () => {
    const { createDecisionService } = await import('../src/decision/service.js');
    const { createProviderRegistry } = await import('../src/registry.js');
    const { decisionServiceFixture } = await import('./decision-fixtures.js');
    const base = decisionServiceFixture();
    const descriptor = structuredDescriptor() as never;
    const scalarSend = vi.fn(async () => JSON.stringify({ score: 0.7 }));
    const { createStructuredDecisionAdapter: createStructured } = await import('../src/decision/structured.js');
    const scalarAdapter = createStructured({ descriptor, transport: { send: scalarSend } });
    const evaluator = { ...(descriptor as { evaluator: { providerId: string; evaluatorId: string; revision: string } }).evaluator };
    const wireModel = (descriptor as { wireModel: string }).wireModel;
    const structuredPrice = () => ({ providerId: 'typesafe' as const, modelId: wireModel,
      priceRevision: 'fixture-price-v1', inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '50000',
      minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const });
    const scalarService = createDecisionService({ ...base.options,
      registry: createProviderRegistry([scalarAdapter as never]),
      resolveEvaluator: (() => descriptor) as never, resolvePrice: (async () => structuredPrice()) as never,
      evaluatorAllowlist: [evaluator] as never });
    const scalarResult = await scalarService.decide(decisionRequest({ evaluator }));
    expect(scalarResult.ok).toBe(true);
    expect(scalarSend).toHaveBeenCalledTimes(1);
    const labelSend = vi.fn(async () => JSON.stringify({ label: 'a' }));
    const labelAdapter = createStructured({ descriptor, transport: { send: labelSend } });
    const labelService = createDecisionService({ ...base.options,
      registry: createProviderRegistry([labelAdapter as never]),
      resolveEvaluator: (() => descriptor) as never, resolvePrice: (async () => structuredPrice()) as never,
      evaluatorAllowlist: [evaluator] as never });
    const labelResult = await labelService.decide(decisionRequest({ evaluator, criterion: { kind: 'choice',
      instructions: 'Pick.', options: [{ id: 'a', description: 'A' }] } }));
    expect(labelResult.ok).toBe(true);
    expect(labelSend).toHaveBeenCalledTimes(1);
    const badSend = vi.fn(async () => JSON.stringify({ refusal: 'cannot' }));
    const badAdapter = createStructured({ descriptor, transport: { send: badSend } });
    const badService = createDecisionService({ ...base.options,
      registry: createProviderRegistry([badAdapter as never]),
      resolveEvaluator: (() => descriptor) as never, resolvePrice: (async () => structuredPrice()) as never,
      evaluatorAllowlist: [evaluator] as never });
    const badResult = await badService.decide(decisionRequest({ evaluator }));
    expect(badResult.ok).toBe(false);
    expect(badSend).toHaveBeenCalledTimes(1);
  });
});
