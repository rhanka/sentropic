import { describe, expect, it } from 'vitest';
import { createDecisionService } from '../src/decision/host.js';
import { kevFixture } from './decision-kev-fixtures.js';

describe('Kev host admission and native receipts', () => {
  it('should verify the served model in a settled experimental receipt', async () => {
    const f = kevFixture();
    const result = await createDecisionService(f.options).decide(f.request);
    expect(result).toMatchObject({ ok: true, verdict: { decision: { pass: true } }, receipt: {
      servedModelId: f.descriptor.wireModel, servedEvaluator: { ...f.descriptor.evaluator, provisional: true },
      experimental: true, attempts: 1, cost: { amountMicroUsd: '100' }, budget: { state: 'settled' } } });
    expect(f.verifyInventory).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8797/v1/models', 'http://127.0.0.1:8797/v1/systemone', 'http://127.0.0.1:8797/v1/models']);
    expect(f.budget.settle).toHaveBeenCalledTimes(1);
    expect(f.state.receipts).toEqual([result.receipt]);
  });
  it('should refuse a catalogue candidate without explicit allowlist before credentials or egress (P28)', async () => {
    const f = kevFixture();
    expect(await createDecisionService({ ...f.options, evaluatorAllowlist: [] }).decide(f.request))
      .toMatchObject({ ok: false, error: { code: 'EVALUATOR_UNKNOWN' }, receipt: { attempts: 0 } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.adapter.listModels()).toEqual([]);
    expect(f.adapter.provider.decisionOnly).toBe(true);
    await expect(f.adapter.generate({} as never)).rejects.toThrow();
    await expect(f.adapter.stream({} as never)).rejects.toThrow();
  });
  it('should refuse a changed revision before local inventory lookup', async () => {
    const f = kevFixture();
    expect(await f.adapter.decision({ ...f.request, evaluator: { ...f.request.evaluator, revision: 'foreign' } }, { auth: f.auth }))
      .toMatchObject({ ok: false, error: { code: 'REVISION_MISMATCH' } });
    expect(f.verifyInventory).not.toHaveBeenCalled();
  });
  it('should require an explicit bounded local call tariff before egress', async () => {
    const f = kevFixture();
    for (const change of [{ billingMode: 'token-rate' }, { minimumMicroUsd: '0' }, { inputMicroUsdPerMtok: '1' }]) {
      expect(await createDecisionService({ ...f.options, resolvePrice: () => ({ ...f.price, ...change }) }).decide(f.request))
        .toMatchObject({ ok: false, error: { code: 'BUDGET_BOUND_UNAVAILABLE' }, receipt: { attempts: 0 } });
    }
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['choice', 'graded'] as const)('should preserve native %s distributions through host reconstruction', async (kind) => {
    const f = kevFixture();
    const criterion = kind === 'choice' ? { kind, instructions: 'Route.', options: [
      { id: 'A', description: 'First' }, { id: 'B', description: 'Second' }] } : {
      kind, instructions: 'Grade.', direction: 'lower-is-better' as const, levels: [
        { label: 'low', description: 'Low' }, { label: 'high', description: 'High' }] };
    f.body.answers.verdict = kind === 'choice' ? { type: 'choice', choice: 'B', confidence: 0.5,
      probabilities: { A: 0.25, B: 0.75 } } : { type: 'score', score: 0.75, confidence: 0.5,
      probabilities: { '0': 0.25, '1': 0.75 }, legend: { '0': 'Low', '1': 'High' } };
    const { decision, ...request } = f.request;
    expect(await createDecisionService(f.options).decide({ ...request, criterion }))
      .toMatchObject({ ok: true, verdict: { criterionKind: kind, decision: null, distribution: expect.any(Array) },
        receipt: { servedModelId: f.descriptor.wireModel } });
  });
  it('should reject a spoofed served model while retaining reported usage and reserve', async () => {
    const f = kevFixture();
    f.body.model = 'foreign-model';
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' }, receipt: { servedEvaluator: null,
        usage: { tokens: { input: { value: 100 } } }, budget: { state: 'pending-reconciliation' } } });
  });
  it('should retain independent counters when host inventory changes after dispatch', async () => {
    const f = kevFixture();
    f.verifyInventory.mockResolvedValueOnce(f.inventory).mockResolvedValueOnce(null as never);
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' }, receipt: { servedEvaluator: null, servedModelId: null,
        usage: { tokens: { input: { value: 100, source: 'provider' } } }, budget: { state: 'pending-reconciliation' } } });
  });
  it.each([
    { type: 'noul', noul: 2 }, { type: 'choice', noul: 0.75 }, { noul: 0.75 },
    { type: 'noul', noul: 0.75, rationale: 'canary' },
  ])('should refuse malformed native output without fallback %j', async (verdict) => {
    const f = kevFixture();
    f.body.answers.verdict = verdict;
    expect(await createDecisionService(f.options).decide(f.request)).toMatchObject({ ok: false,
      error: { code: 'VERDICT_INVALID' }, receipt: { attempts: 1 } });
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith('/systemone'))).toHaveLength(1);
  });
});
