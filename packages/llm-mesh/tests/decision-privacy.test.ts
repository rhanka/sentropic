import { describe, expect, it, vi } from 'vitest';
import { createDecisionService } from '../src/decision/service.js';
import { parseJevProviderRaw } from '../src/decision/raw.js';
import { decisionRequest, decisionServiceFixture, jevResponse } from './decision-fixtures.js';

describe('decision raw and metadata privacy', () => {
  it('defaults raw off and keeps evaluated content, rubric and credentials outside accounting', async () => {
    const f = decisionServiceFixture();
    const result = await createDecisionService(f.options).decide(decisionRequest({ inputs: { output: 'evaluated-content-canary' },
      criterion: { kind: 'binary', instructions: 'rubric-content-canary' } }));
    expect(result.ok && result.verdict).not.toHaveProperty('providerRaw');
    const metadata = JSON.stringify([f.budget.admit.mock.calls, f.budget.markDispatched.mock.calls,
      f.budget.settle.mock.calls, f.state.receipts, result.receipt]);
    for (const canary of ['evaluated-content-canary', 'rubric-content-canary', 'synthetic-secret-canary']) expect(metadata).not.toContain(canary);
  });
  it('requires both host and caller permission and returns only native allowlisted data', async () => {
    const f = decisionServiceFixture();
    const request = decisionRequest({ raw: { mode: 'allowlisted' } });
    expect(await createDecisionService(f.options).decide(request)).toMatchObject({ error: { code: 'CAPABILITY_UNSUPPORTED' }, receipt: { attempts: 0 } });
    const service = createDecisionService({ ...f.options, policy: { allowRaw: true } });
    expect((await service.decide(decisionRequest())).ok).toBe(true);
    const result = await service.decide(request);
    expect(result).toMatchObject({ ok: true, verdict: { providerRaw: { data: { noul: 0.25 }, bytes: 13, truncated: false } } });
    expect(JSON.stringify(f.state.receipts)).not.toContain('providerRaw');
  });
  it('drops whole raw fields to fit without changing typed probabilities or confidence', async () => {
    const f = decisionServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: jevResponse({ choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.8 }) });
    const result = await createDecisionService({ ...f.options, policy: { allowRaw: true } }).decide(decisionRequest({
      criterion: { kind: 'choice', instructions: 'Check.', options: [{ id: 'a', description: 'description-canary' }, { id: 'b', description: 'Other.' }] },
      raw: { mode: 'allowlisted', maxBytes: 20 } }));
    expect(result).toMatchObject({ ok: true, verdict: { confidence: { value: 0.8 }, distribution: [{ probability: 0.6 }, { probability: 0.4 }],
      providerRaw: { data: { choice: 'a' }, bytes: 14, truncated: true } } });
    expect(JSON.stringify(result)).not.toContain('description-canary');
  });
  it.each([{ data: { noul: 0.25 }, bytes: 13, truncated: 'yes' }, { data: { noul: 0.25 }, bytes: 1, truncated: false },
    { data: { secret: 'canary' }, bytes: 19, truncated: false },
    { data: { choice: 'x'.repeat(16384) }, bytes: 16397, truncated: false }])('refuses malformed or excessive providerRaw', (candidate) => {
    expect(parseJevProviderRaw(candidate, { noul: 0.25, choice: 'x'.repeat(16384) }, decisionRequest({ raw: { mode: 'allowlisted' } }))).toBeNull();
  });
  it('scrubs known secrets from upstream identity/request IDs and hides exception causes', async () => {
    const f = decisionServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), model: 'synthetic-secret-canary' },
      providerRequestId: 'synthetic-secret-canary' });
    const result = await createDecisionService(f.options).decide(decisionRequest());
    expect(JSON.stringify([result, f.state.receipts, f.state.ledger])).not.toContain('synthetic-secret-canary');
    f.transport.send.mockRejectedValueOnce(new Error('exception-content-canary synthetic-secret-canary'));
    const failed = await createDecisionService(f.options).decide(decisionRequest());
    expect(JSON.stringify(failed)).not.toContain('canary');
    expect(failed).toMatchObject({ error: { code: 'TRANSPORT_FAILED' }, receipt: { attempts: 1 } });
  });
});
