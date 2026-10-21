import { describe, expect, it, vi } from 'vitest';
import { createJudgeService } from '../src/judge/service.js';
import { parseJevProviderRaw } from '../src/judge/raw.js';
import { judgeRequest, judgeServiceFixture, jevResponse } from './judge-fixtures.js';

describe('judge raw and metadata privacy', () => {
  it('defaults raw off and keeps evaluated content, rubric and credentials outside accounting', async () => {
    const f = judgeServiceFixture();
    const result = await createJudgeService(f.options).judge(judgeRequest({ inputs: { output: 'evaluated-content-canary' },
      criterion: { kind: 'binary', instructions: 'rubric-content-canary' } }));
    expect(result.ok && result.verdict).not.toHaveProperty('providerRaw');
    const metadata = JSON.stringify([f.budget.admit.mock.calls, f.budget.markDispatched.mock.calls,
      f.budget.settle.mock.calls, f.state.receipts, result.receipt]);
    for (const canary of ['evaluated-content-canary', 'rubric-content-canary', 'synthetic-secret-canary']) expect(metadata).not.toContain(canary);
  });
  it('requires both host and caller permission and returns only native allowlisted data', async () => {
    const f = judgeServiceFixture();
    const request = judgeRequest({ raw: { mode: 'allowlisted' } });
    expect(await createJudgeService(f.options).judge(request)).toMatchObject({ error: { code: 'CAPABILITY_UNSUPPORTED' }, receipt: { attempts: 0 } });
    const service = createJudgeService({ ...f.options, policy: { allowRaw: true } });
    expect((await service.judge(judgeRequest())).ok).toBe(true);
    const result = await service.judge(request);
    expect(result).toMatchObject({ ok: true, verdict: { providerRaw: { data: { noul: 0.25 }, bytes: 13, truncated: false } } });
    expect(JSON.stringify(f.state.receipts)).not.toContain('providerRaw');
  });
  it('drops whole raw fields to fit without changing typed probabilities or confidence', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: jevResponse({ choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.8 }) });
    const result = await createJudgeService({ ...f.options, policy: { allowRaw: true } }).judge(judgeRequest({
      criterion: { kind: 'choice', instructions: 'Check.', options: [{ id: 'a', description: 'description-canary' }, { id: 'b', description: 'Other.' }] },
      raw: { mode: 'allowlisted', maxBytes: 20 } }));
    expect(result).toMatchObject({ ok: true, verdict: { confidence: { value: 0.8 }, distribution: [{ probability: 0.6 }, { probability: 0.4 }],
      providerRaw: { data: { choice: 'a' }, bytes: 14, truncated: true } } });
    expect(JSON.stringify(result)).not.toContain('description-canary');
  });
  it.each([{ data: { noul: 0.25 }, bytes: 13, truncated: 'yes' }, { data: { noul: 0.25 }, bytes: 1, truncated: false },
    { data: { secret: 'canary' }, bytes: 19, truncated: false },
    { data: { choice: 'x'.repeat(16384) }, bytes: 16397, truncated: false }])('refuses malformed or excessive providerRaw', (candidate) => {
    expect(parseJevProviderRaw(candidate, { noul: 0.25, choice: 'x'.repeat(16384) }, judgeRequest({ raw: { mode: 'allowlisted' } }))).toBeNull();
  });
  it('scrubs known secrets from upstream identity/request IDs and hides exception causes', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), model: 'synthetic-secret-canary' },
      providerRequestId: 'synthetic-secret-canary' });
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(JSON.stringify([result, f.state.receipts, f.state.ledger])).not.toContain('synthetic-secret-canary');
    f.transport.send.mockRejectedValueOnce(new Error('exception-content-canary synthetic-secret-canary'));
    const failed = await createJudgeService(f.options).judge(judgeRequest());
    expect(JSON.stringify(failed)).not.toContain('canary');
    expect(failed).toMatchObject({ error: { code: 'TRANSPORT_FAILED' }, receipt: { attempts: 1 } });
  });
});
