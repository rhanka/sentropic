import { describe, expect, it, vi } from 'vitest';
import { createJudgeService } from '../src/judge/service.js';
import { createJudgeError } from '../src/judge/errors.js';
import { judgeRequest, judgeServiceFixture, jevResponse, judgePrice } from './judge-fixtures.js';

describe('durable judge settlement without re-evaluation', () => {
  it('refuses missing provider usage and retains the reserve with unknown counters', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), usage: null } });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'USAGE_INVALID' },
      receipt: { attempts: 1, usage: { tokens: { input: { value: null } } }, cost: { amountMicroUsd: '2753' }, budget: { state: 'pending-reconciliation' } } });
  });
  it.each([{ body: { ...jevResponse(), model: 'other-model' }, code: 'SERVED_IDENTITY_MISMATCH' },
    { body: jevResponse({ noul: 4 }), code: 'VERDICT_INVALID' }])('settles independent usage after $code', async ({ body, code }) => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body });
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result).toMatchObject({ ok: false, error: { code, phase: 'parse' }, receipt: { dispatch: 'completed', attempts: 1,
      usage: { tokens: { input: { value: 1000 } } }, cost: { amountMicroUsd: '42' }, budget: { state: 'settled' } } });
    if (code === 'SERVED_IDENTITY_MISMATCH') expect(result.receipt.servedEvaluator).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.budget.settle).toHaveBeenCalledOnce();
  });
  it('retains counters and reserves liability if the returned model makes the rate inapplicable', async () => {
    const f = judgeServiceFixture();
    f.options.resolvePrice = () => ({ ...judgePrice(), identityMismatchPricing: 'requires-reconciliation' });
    f.transport.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), model: 'other-model' } });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ receipt: { cost: { amountMicroUsd: '2753' },
      usage: { tokens: { input: { value: 1000 } } }, budget: { state: 'pending-reconciliation' } } });
  });
  it('does not erase a valid input count when output usage is invalid', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), usage: { input_tokens: 1000, output_tokens: -1 } } });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'USAGE_INVALID' }, receipt: {
      usage: { tokens: { input: { value: 1000 }, output: { value: null } } }, cost: { amountMicroUsd: '42' } } });
  });
  it('settles unknown execution at the reserve without inventing token counts', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockResolvedValueOnce({ ok: false, error: createJudgeError('TIMEOUT', 'dispatch') });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'TIMEOUT', phase: 'dispatch' },
      receipt: { attempts: 1, dispatch: 'unknown', usage: { tokens: { input: { value: null } } },
        cost: { amountMicroUsd: '2753', source: 'reserved-liability' }, budget: { state: 'pending-reconciliation' } } });
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('fully charges an overrun, returns the paid verdict and blocks a restarted service sharing durable state', async () => {
    const f = judgeServiceFixture();
    f.options.resolveEvaluator = () => ({ ...f.descriptor, maxBillableInputTokens: 1 });
    const first = await createJudgeService(f.options).judge(judgeRequest());
    expect(first).toMatchObject({ ok: true, receipt: { cost: { amountMicroUsd: '42' }, budget: { overrun: true, reservedMicroUsd: '1' } } });
    expect(f.budget.settle.mock.calls[0][0].boundViolated).toBe(true);
    const restarted = createJudgeService(f.options);
    expect(await restarted.judge(judgeRequest())).toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE', phase: 'admission' }, receipt: { attempts: 0 } });
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['settle', 'persist'] as const)('withholds a verdict on %s failure and does not redispatch', async (port) => {
    const f = judgeServiceFixture();
    if (port === 'settle') f.budget.settle.mockRejectedValueOnce(new Error('private accounting cause'));
    else vi.mocked(f.options.receipts.persist).mockRejectedValueOnce(new Error('private receipt cause'));
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result).toMatchObject({ ok: false, error: { code: port === 'settle' ? 'SETTLEMENT_UNAVAILABLE' : 'RECEIPT_UNAVAILABLE',
      phase: 'settlement', retryable: false }, receipt: { cost: { amountMicroUsd: '42' }, budget: { state: 'pending-reconciliation' } } });
    expect(result).not.toHaveProperty('verdict');
    expect(result.ok || result.error).not.toHaveProperty('retryAfterMs');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['result', 'settlement', 'receipt'] as const)('uses literal settlement phase when deadline expires after %s', async (stage) => {
    const f = judgeServiceFixture();
    if (stage === 'result') f.transport.send.mockImplementationOnce(async () => { f.state.now = 10001; return { ok: true, body: jevResponse() }; });
    else if (stage === 'settlement') f.budget.settle.mockImplementationOnce(async () => { f.state.now = 10001; });
    else vi.mocked(f.options.receipts.persist).mockImplementationOnce(async () => { f.state.now = 10001; });
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT', phase: 'settlement', retryable: false },
      receipt: { attempts: 1, cost: { amountMicroUsd: '42' } } });
    expect(result.ok || result.error).not.toHaveProperty('retryAfterMs');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('pins the price snapshot through asynchronous admission', async () => {
    const f = judgeServiceFixture();
    const row = judgePrice();
    f.options.resolvePrice = () => row;
    f.budget.admit.mockImplementationOnce(async (input) => { row.inputMicroUsdPerMtok = '1000000000'; return { ok: true, holdId: input.callId }; });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ receipt: { cost: { amountMicroUsd: '42', priceRevision: 'fixture-price-v1' } } });
  });
  it('awaits durable receipt acknowledgement before exposing any verdict', async () => {
    const f = judgeServiceFixture();
    let acknowledge!: () => void;
    vi.mocked(f.options.receipts.persist).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    let finished = false;
    const pending = createJudgeService(f.options).judge(judgeRequest()).then((result) => { finished = true; return result; });
    await vi.waitFor(() => expect(f.options.receipts.persist).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    acknowledge();
    expect((await pending).ok).toBe(true);
  });
});
