import { describe, expect, it, vi } from 'vitest';
import { createGeminiDecisionsAdapter, createGeminiDecisionsTransport,
  geminiDecisionsDescriptor, geminiDecisionsPrice } from '../src/decision/host.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import { decisionRequest, decisionServiceFixture } from './decision-fixtures.js';
import { quoteDecision } from '../src/decision/pricing.js';

const setup = () => {
  const base = decisionServiceFixture();
  const descriptor = { ...structuredClone(geminiDecisionsDescriptor), executionProfile: 'qualification' as const,
    qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const, evidenceRefs: ['fixture:qualified'] } };
  // Synthetic identity evidence only: the documented response omits model and must fail closed.
  const body: Record<string, unknown> = { model: 'gemini-decision-1', answers: {
    verdict: { type: 'noul', noul: 0.25, confidence: 0.75 } }, usage: {
    total_input_tokens: 1000, total_output_tokens: 0, total_tokens: 1000,
    input_tokens_by_modality: [{ modality: 'text', tokens: 1000 }] } };
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const adapter = createGeminiDecisionsAdapter({ descriptor, transport: createGeminiDecisionsTransport({ fetch }) });
  const options = { ...base.options, registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor,
    evaluatorAllowlist: [descriptor.evaluator], resolvePrice: () => geminiDecisionsPrice,
    resolveAuth: vi.fn(async () => ({ material: { type: 'environment-token' as const, envVar: 'GEMINI_API_KEY',
      token: 'synthetic-gemini-canary' }, descriptor: { sourceType: 'environment-token' as const } })) };
  return { ...base, descriptor, adapter, options, fetch, body,
    request: decisionRequest({ evaluator: descriptor.evaluator,
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }) };
};

describe('Gemini Decisions host integration', () => {
  it('should route once with API-key auth and the input-only tariff', async () => {
    const f = setup();
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: true, verdict: { decision: { pass: false }, confidence: null },
      receipt: { attempts: 1, cost: { amountMicroUsd: '100' }, budget: { state: 'settled' } } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/decisions');
    expect(f.fetch.mock.calls[0][1]).toMatchObject({ headers: { 'x-goog-api-key': 'synthetic-gemini-canary' }, redirect: 'manual' });
    const wire = JSON.parse(f.fetch.mock.calls[0][1].body);
    expect(wire).toEqual({ model: 'gemini-decision-1', input: JSON.stringify(f.request.inputs),
      questions: { verdict: { type: 'noul', instructions: f.request.criterion.instructions } } });
    expect(JSON.stringify(result)).not.toContain('synthetic-gemini-canary');
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
  });
  it('should preserve binary criteria using the documented description keys', async () => {
    const f = setup();
    await createDecisionService(f.options).decide({ ...f.request, criterion: { kind: 'binary', instructions: 'Check.',
      criteria: { true: 'Valid', false: 'Invalid' } } });
    expect(JSON.parse(f.fetch.mock.calls[0][1].body).questions.verdict.criteria)
      .toEqual({ true_description: 'Valid', false_description: 'Invalid' });
  });
  it.each(['choice', 'graded'] as const)('should map %s distributions through host reconstruction', async (kind) => {
    const f = setup();
    const criterion = kind === 'choice' ? { kind, instructions: 'Route.', options: [
      { id: 'A', description: 'First' }, { id: 'B', description: 'Second' }] } : {
      kind, instructions: 'Grade.', direction: 'higher-is-better' as const,
      levels: [{ label: 'low', description: 'Low' }, { label: 'high', description: 'High' }] };
    f.body.answers = { verdict: kind === 'choice' ? { type: 'choice', choice: 'B', confidence: 0.75,
      probabilities: { A: 0.25, B: 0.75 } } : { type: 'score', score: 0.75, confidence: 0.75,
      probabilities: { 0: 0.25, 1: 0.75 }, legend: { 0: 'Low', 1: 'High' } } };
    const { decision: _rule, ...request } = f.request;
    expect(await createDecisionService(f.options).decide({ ...request, criterion })).toMatchObject({ ok: true,
      verdict: { resolvedCriterionKind: kind, confidence: { value: 0.75 }, distribution: expect.any(Array) } });
  });
  it('should never register a default route or dispatch an unqualified evaluator', async () => {
    const f = setup();
    expect(await createDecisionService({ ...f.options, evaluatorAllowlist: [] }).decide(f.request))
      .toMatchObject({ ok: false, error: { code: 'EVALUATOR_UNKNOWN' }, receipt: { attempts: 0 } });
    const adapter = createGeminiDecisionsAdapter({ transport: createGeminiDecisionsTransport({ fetch: f.fetch }) });
    expect(await adapter.decision({ ...f.request, evaluator: geminiDecisionsDescriptor.evaluator }))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(adapter.listModels()).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('should retain liability when the documented response has no served identity', async () => {
    const f = setup(); delete f.body.model;
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' }, receipt: { servedEvaluator: null, servedModelId: null,
        budget: { state: 'pending-reconciliation' } } });
  });
  it('should reject contradictory usage without releasing the reserve', async () => {
    const f = setup(); (f.body.usage as Record<string, unknown>).total_output_tokens = 1;
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'USAGE_INVALID' }, receipt: { budget: { state: 'pending-reconciliation' } } });
    expect(f.budget.settle).not.toHaveBeenCalled(); expect(f.budget.release).not.toHaveBeenCalled();
  });
  it('should refuse foreign credentials and a nonzero output price before egress', async () => {
    const f = setup();
    expect(quoteDecision(f.request, f.descriptor, { ...geminiDecisionsPrice, outputMicroUsdPerMtok: '1' }))
      .toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
    expect(await createDecisionService({ ...f.options, resolveAuth: async () => ({ material: {
      type: 'environment-token', envVar: 'OPENAI_API_KEY', token: 'synthetic-secret' },
      descriptor: { sourceType: 'environment-token' } }) }).decide(f.request))
      .toMatchObject({ ok: false, error: { code: 'CREDENTIAL_MISSING' }, receipt: { attempts: 0 } });
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
