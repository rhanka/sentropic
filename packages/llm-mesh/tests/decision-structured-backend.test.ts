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
});
