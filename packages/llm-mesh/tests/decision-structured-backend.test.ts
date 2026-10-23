import { describe, expect, it, vi } from 'vitest';
import { createStructuredDecisionAdapter } from '../src/decision/structured.js';
import { STRUCTURED_SCORE_MEANING } from '../src/decision/structured.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import { decisionRequest, decisionServiceFixture, structuredDecisionDescriptor, structuredDecisionPrice, structuredEvidenceBody } from './decision-fixtures.js';

const descriptorWith = (overrides: Record<string, unknown> = {}) => ({ ...structuredDecisionDescriptor(), ...overrides });
const adapterWith = (text: string, descriptor?: Record<string, unknown>) => {
  const send = vi.fn(async () => text);
  const adapter = createStructuredDecisionAdapter({ descriptor: (descriptor ?? descriptorWith()) as never, transport: { send } });
  return { adapter, send };
};
const serviceWith = (sendText: string, descriptor?: Record<string, unknown>) => {
  const base = decisionServiceFixture();
  const resolved = (descriptor ?? descriptorWith()) as never;
  const send = vi.fn(async () => sendText);
  const adapter = createStructuredDecisionAdapter({ descriptor: resolved, transport: { send } });
  const evaluator = (resolved as { evaluator: { providerId: string; evaluatorId: string; revision: string } }).evaluator;
  const service = createDecisionService({ ...base.options,
    registry: createProviderRegistry([adapter as never]),
    resolveEvaluator: (() => resolved) as never,
    resolvePrice: (async () => structuredDecisionPrice(
      (resolved as { wireModel: string }).wireModel)) as never,
    evaluatorAllowlist: [evaluator] as never });
  return { service, send, evaluator };
};

describe('structured backend discrimination (P23)', () => {
  it.each([
    ['malformed body', 'not-a-record'],
    ['refusal body', JSON.stringify({ refusal: 'cannot decide' })],
    ['extra key', JSON.stringify({ score: 0.7, served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: 100, outputTokens: 5 }, extra: 1 })],
    ['missing score', JSON.stringify({ served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: 100, outputTokens: 5 } })],
    ['prose number', JSON.stringify({ score: '0.7 probably', served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: 100, outputTokens: 5 } })],
    ['clamped score', JSON.stringify({ score: 1.5, served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: 100, outputTokens: 5 } })],
    ['default-injected score', JSON.stringify({ score: 0, served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: 100, outputTokens: 5 }, defaulted: true })],
  ])('produces no verdict for %s with a single transport call', async (_label, text) => {
    const { adapter, send } = adapterWith(text);
    const result = await adapter.decision(decisionRequest());
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('refuses missing served identity and usage with typed errors, never invented counters', async () => {
    const missing = adapterWith(JSON.stringify({ score: 0.7 }));
    const missingResult = await missing.adapter.decision(decisionRequest());
    expect(missingResult.ok).toBe(false);
    if (missingResult.ok) throw new Error('missing evidence unexpectedly accepted');
    expect(missingResult.error.code).toBe('SERVED_IDENTITY_MISMATCH');
    expect(missing.send).toHaveBeenCalledTimes(1);
    const foreign = adapterWith(structuredEvidenceBody({ score: 0.7 }, 'foreign-model'));
    const foreignResult = await foreign.adapter.decision(decisionRequest());
    expect(foreignResult.ok).toBe(false);
    if (foreignResult.ok) throw new Error('foreign identity unexpectedly accepted');
    expect(foreignResult.error.code).toBe('SERVED_IDENTITY_MISMATCH');
    const noUsage = adapterWith(JSON.stringify({ score: 0.7, served: { modelId: 'synthetic-structured-model' } }));
    const noUsageResult = await noUsage.adapter.decision(decisionRequest());
    expect(noUsageResult.ok).toBe(false);
    if (noUsageResult.ok) throw new Error('missing usage unexpectedly accepted');
    expect(noUsageResult.error.code).toBe('USAGE_INVALID');
    const badUsage = adapterWith(JSON.stringify({ score: 0.7, served: { modelId: 'synthetic-structured-model' },
      usage: { inputTokens: -1, outputTokens: 5 } }));
    const badUsageResult = await badUsage.adapter.decision(decisionRequest());
    expect(badUsageResult.ok).toBe(false);
    if (badUsageResult.ok) throw new Error('negative usage unexpectedly accepted');
    expect(badUsageResult.error.code).toBe('USAGE_INVALID');
  });
  it('keeps valid scalar and label-only controls passing with reported evidence', async () => {
    const scalar = adapterWith(structuredEvidenceBody({ score: 0.7 }));
    const scalarResult = await scalar.adapter.decision(decisionRequest());
    expect(scalarResult.ok).toBe(true);
    expect(scalar.send).toHaveBeenCalledTimes(1);
    if (!scalarResult.ok) throw new Error('valid scalar unexpectedly refused');
    expect(scalarResult.verdict.score).toMatchObject({ value: 0.7, meaning: STRUCTURED_SCORE_MEANING });
    expect(scalarResult.usage.tokens.input).toEqual({ value: 100, source: 'provider' });
    expect(scalarResult.usage.tokens.output).toEqual({ value: 5, source: 'provider' });
    expect(scalarResult.usage.tokens.total).toEqual({ value: 105, source: 'derived-sum' });
    expect(scalarResult.servedModelId).toBe('synthetic-structured-model');
    expect(scalarResult.servedEvaluator).toMatchObject({ evaluatorId: 'structured-judge-v1' });
    const choiceRequest = decisionRequest({ criterion: { kind: 'choice', instructions: 'Pick.',
      options: [{ id: 'a', description: 'A' }] } });
    const label = adapterWith(structuredEvidenceBody({ label: 'a' }));
    const labelResult = await label.adapter.decision(choiceRequest);
    expect(labelResult.ok).toBe(true);
    expect(label.send).toHaveBeenCalledTimes(1);
  });
  it('transmits evaluated content, the full criterion, the closed schema and the execution cap', async () => {
    const request = decisionRequest({
      inputs: { input: 'INPUT_CANARY', output: 'OUTPUT_CANARY', state: 'STATE_CANARY',
        reference: 'REFERENCE_CANARY', context: ['CONTEXT_CANARY'] },
      criterion: { kind: 'graded', instructions: 'Grade.', direction: 'lower-is-better',
        levels: [{ label: 'LOW', description: 'LOW_DESCRIPTION' }, { label: 'HIGH', description: 'HIGH_DESCRIPTION' }] } });
    const { adapter, send } = adapterWith(structuredEvidenceBody({ score: 1 }), descriptorWith({ maxBillableOutputTokens: 512 }));
    const result = await adapter.decision(request);
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0] as Record<string, unknown>;
    const sent = JSON.stringify(payload);
    for (const canary of ['INPUT_CANARY', 'OUTPUT_CANARY', 'STATE_CANARY', 'REFERENCE_CANARY',
      'CONTEXT_CANARY', 'LOW_DESCRIPTION', 'HIGH_DESCRIPTION']) {
      expect(sent).toContain(canary);
    }
    expect(payload.contractRevision).toBe('structured-llm-v1');
    expect(payload.execution).toEqual({ maxOutputTokens: 512 });
    const schema = payload.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['score', 'served', 'usage']));
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    for (const nested of [properties.served, properties.usage]) {
      expect(nested.additionalProperties).toBe(false);
    }
    expect(payload.compilation).toMatchObject({ templateDigest: expect.any(String), schemaDigest: expect.any(String) });
  });
  it('falls back to the conservative execution default when the descriptor states no output budget', async () => {
    const { adapter, send } = adapterWith(structuredEvidenceBody({ score: 0.5 }), descriptorWith({ maxBillableOutputTokens: 0 }));
    const result = await adapter.decision(decisionRequest());
    expect(result.ok).toBe(true);
    const payload = send.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.execution).toEqual({ maxOutputTokens: 4096 });
  });
  it('registers under the descriptor-selected provider instead of pinning TypeSafe', async () => {
    const openai = descriptorWith({ evaluator: { providerId: 'openai', evaluatorId: 'structured-judge-v1', revision: 'synthetic-v1' } });
    const { adapter } = adapterWith(structuredEvidenceBody({ score: 0.5 }), openai);
    expect(adapter.provider.providerId).toBe('openai');
    expect(() => adapterWith(structuredEvidenceBody({ score: 0.5 }),
      descriptorWith({ evaluator: { providerId: 'unknown-provider', evaluatorId: 'structured-judge-v1', revision: 'synthetic-v1' } })))
      .toThrow('Invalid structured descriptor.');
  });
  it('serves scalar and label-only controls through the host with one transport call (F3)', async () => {
    const { service, send, evaluator } = serviceWith(structuredEvidenceBody({ score: 0.7 }));
    const scalarResult = await service.decide(decisionRequest({ evaluator }));
    expect(scalarResult.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    if (!scalarResult.ok || scalarResult.kind !== 'verdict') throw new Error('valid service scalar unexpectedly refused');
    expect(scalarResult.receipt.budget).toMatchObject({ state: 'settled' });
    expect(scalarResult.receipt.cost).toMatchObject({ amountMicroUsd: '6', source: 'reported-usage-times-rate' });
    expect(scalarResult.receipt.servedModelId).toBe('synthetic-structured-model');
    const labelService = serviceWith(structuredEvidenceBody({ label: 'a' }));
    const labelResult = await labelService.service.decide(decisionRequest({ evaluator,
      criterion: { kind: 'choice', instructions: 'Pick.', options: [{ id: 'a', description: 'A' }] } }));
    expect(labelResult.ok).toBe(true);
    expect(labelService.send).toHaveBeenCalledTimes(1);
    const badService = serviceWith(JSON.stringify({ refusal: 'cannot' }));
    const badResult = await badService.service.decide(decisionRequest({ evaluator }));
    expect(badResult.ok).toBe(false);
    expect(badService.send).toHaveBeenCalledTimes(1);
  });
  it('refuses missing transport evidence through the service with conservative settlement (F2)', async () => {
    const { service, send, evaluator } = serviceWith(JSON.stringify({ score: 0.7 }));
    const result = await service.decide(decisionRequest({ evaluator }));
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    if (result.ok || result.kind !== 'error') throw new Error('missing evidence unexpectedly accepted');
    expect(result.error.code).toBe('SERVED_IDENTITY_MISMATCH');
    expect(result.receipt.usage.tokens.input).toEqual({ value: null, source: 'not-reported' });
    expect(result.receipt.budget.state).toBe('pending-reconciliation');
    expect(BigInt(result.receipt.cost.amountMicroUsd)).toBe(BigInt(result.receipt.budget.reservedMicroUsd));
  });
});
