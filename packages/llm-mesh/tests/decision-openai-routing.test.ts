import { describe, expect, it, vi } from 'vitest';
import { createOpenAiDecisionsAdapter, openAiDecisionsDescriptor, openAiDecisionsPrice,
  createOpenAiDecisionsTransport } from '../src/decision/host.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import { quoteDecision } from '../src/decision/pricing.js';
import { decisionRequest, decisionServiceFixture } from './decision-fixtures.js';

const setup = () => {
  const base = decisionServiceFixture();
  const descriptor = { ...structuredClone(openAiDecisionsDescriptor), acceptedServedModelIds: ['gpt-6-luna'],
    qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const, evidenceRefs: ['fixture:qualified'] } };
  const body = { model: 'gpt-6-luna', answers: [{ name: 'verdict', type: 'predicate', probability: 0.25 }],
    usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000 } };
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-request' } }));
  const adapter = createOpenAiDecisionsAdapter({ descriptor, transport: createOpenAiDecisionsTransport({ fetch }) });
  const options = { ...base.options, registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor,
    evaluatorAllowlist: [descriptor.evaluator], resolvePrice: vi.fn(() => openAiDecisionsPrice),
    resolveAuth: vi.fn(async () => ({ material: { type: 'environment-token' as const,
      envVar: 'OPENAI_API_KEY', token: 'synthetic-secret-canary' }, descriptor: { sourceType: 'environment-token' as const } })) };
  return { ...base, descriptor, body, fetch, adapter, options,
    request: decisionRequest({ evaluator: descriptor.evaluator,
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }) };
};

describe('Decisions dedicated transport, tariff and route registration', () => {
  it('should reject declarations that do not describe the implemented native compiler', () => {
    const f = setup();
    for (const changed of [
      { compilation: { ...f.descriptor.compilation, templateDigest: '0'.repeat(64) } },
      { compilation: { ...f.descriptor.compilation, schemaDigest: '0'.repeat(64) } },
      { definition: { ...f.descriptor.definition, validationProfile: { profile: 'scalar-label-v1', version: 'v1' } } },
    ]) expect(() => createOpenAiDecisionsAdapter({ descriptor: { ...f.descriptor, ...changed },
      transport: createOpenAiDecisionsTransport({ fetch: f.fetch }) })).toThrow('Invalid OpenAI Decisions descriptor.');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('should serve through the mesh once with the Decisions tariff and awaited settlement', async () => {
    const f = setup();
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: true, verdict: { decision: { pass: false } },
      receipt: { attempts: 1, servedModelId: 'gpt-6-luna',
        cost: { amountMicroUsd: '100', source: 'reported-usage-times-rate' }, budget: { state: 'settled' } } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/decisions');
    expect(f.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual',
      headers: { authorization: 'Bearer synthetic-secret-canary' } });
    expect(f.options.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'openai-decisions',
      authority: 'control.model_pricing', priceRevision: openAiDecisionsPrice.priceRevision }));
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
    expect(f.state.receipts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret-canary');
  });
  it('should reject Responses pricing and unqualified liability before credential lookup or egress', async () => {
    const f = setup();
    expect(quoteDecision(f.request, f.descriptor, openAiDecisionsPrice).ok).toBe(true);
    expect(quoteDecision(f.request, f.descriptor, { ...openAiDecisionsPrice, protocol: 'structured-llm' }))
      .toEqual({ ok: false, code: 'PRICING_UNAVAILABLE' });
    expect(quoteDecision(f.request, f.descriptor, { ...openAiDecisionsPrice, outputMicroUsdPerMtok: '500000' }))
      .toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
    expect(quoteDecision(f.request, { ...f.descriptor, qualification: { ...f.descriptor.qualification, billingBound: 'unqualified' } },
      openAiDecisionsPrice)).toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
    const result = await createDecisionService({ ...f.options,
      resolvePrice: () => ({ ...openAiDecisionsPrice, protocol: 'structured-llm' }) }).decide(f.request);
    expect(result).toMatchObject({ ok: false, error: { code: 'PRICING_UNAVAILABLE' }, receipt: { attempts: 0 } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('should keep candidates unavailable and refuse unlisted catalogue entries before egress (P28)', async () => {
    const f = setup();
    expect(openAiDecisionsDescriptor.qualification.servedIdentity).toBe('unqualified');
    expect(openAiDecisionsDescriptor.acceptedServedModelIds).toEqual([]);
    const result = await createDecisionService({ ...f.options, evaluatorAllowlist: [] }).decide(f.request);
    expect(result).toMatchObject({ ok: false, error: { code: 'EVALUATOR_UNKNOWN' }, receipt: { attempts: 0 } });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.adapter.listModels()).toEqual([]);
    expect(f.adapter.provider.decisionOnly).toBe(true);
    await expect(f.adapter.generate({} as never)).rejects.toThrow();
    await expect(f.adapter.stream({} as never)).rejects.toThrow();
  });
  it('should retain billed refusal evidence without replay or fallback', async () => {
    const f = setup();
    f.body.answers = [{ name: 'verdict', type: 'refusal' } as never];
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: false, error: { code: 'PROVIDER_REJECTED' }, receipt: { attempts: 1,
      usage: { tokens: { input: { value: 1000 } } }, cost: { amountMicroUsd: '100' } } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('should retain the reserve for a foreign served identity without substituting a route', async () => {
    const f = setup();
    f.body.model = 'foreign-model';
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVED_IDENTITY_MISMATCH' }, receipt: { attempts: 1,
      servedEvaluator: null, usage: { tokens: { input: { value: 1000 } } },
      cost: { amountMicroUsd: '205', source: 'reserved-liability' }, budget: { state: 'pending-reconciliation' } } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
  });
  it('should reject a wrong credential source before admission', async () => {
    const f = setup();
    const result = await createDecisionService({ ...f.options, resolveAuth: async () => ({
      material: { type: 'environment-token', envVar: 'JEV_API_KEY', token: 'fixture-secret' },
      descriptor: { sourceType: 'environment-token' } }) }).decide(f.request);
    expect(result).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_MISSING' }, receipt: { attempts: 0 } });
    expect(f.budget.admit).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['choice', 'graded'] as const)('should preserve native %s evidence through host reconstruction', async (kind) => {
    const f = setup();
    const criterion = kind === 'choice' ? { kind, instructions: 'Route.', options: [
      { id: 'A', description: 'First' }, { id: 'B', description: 'Second' }] } : {
      kind, instructions: 'Grade.', direction: 'higher-is-better' as const, levels: [
        { label: 'low', description: 'Low' }, { label: 'high', description: 'High' }] };
    const answer = kind === 'choice' ? { name: 'verdict', type: 'choice', choice: 'B', confidence: 0.8,
      probabilities: [{ value: 'A', probability: 0.25 }, { value: 'B', probability: 0.75 }] } : {
      name: 'verdict', type: 'score', score: 0.75, confidence: 0.8,
      probabilities: [{ value: 0, label: 'low', probability: 0.25 }, { value: 1, label: 'high', probability: 0.75 }] };
    f.body.answers = [answer as never];
    const { decision: _threshold, ...withoutRule } = f.request;
    const result = await createDecisionService(f.options).decide({ ...withoutRule, criterion });
    expect(result).toMatchObject({ ok: true, verdict: { criterionKind: kind, decision: null,
      confidence: { value: 0.8, meaningRef: f.descriptor.confidence.meaningRef }, distribution: expect.any(Array) } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
