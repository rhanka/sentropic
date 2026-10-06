import { describe, expect, it, vi } from 'vitest';
import { createJudgeService } from '../src/judge/service.js';
import { judgeRequest, judgeServiceFixture } from './judge-fixtures.js';

describe('judge admission and exactly one dispatch', () => {
  it('constructs without I/O and awaits the durable marker before sending', async () => {
    const f = judgeServiceFixture();
    let acknowledge!: () => void;
    f.budget.markDispatched.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = () => resolve({ ok: true }); }));
    const service = createJudgeService(f.options);
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    const pending = service.judge(judgeRequest({ decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }));
    await vi.waitFor(() => expect(f.budget.markDispatched).toHaveBeenCalledOnce());
    expect(f.transport.send).not.toHaveBeenCalled();
    acknowledge();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, verdict: { decision: { pass: false } }, receipt: { attempts: 1, budget: { state: 'settled' } } });
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.budget.settle).toHaveBeenCalledOnce();
    expect(f.options.receipts.persist).toHaveBeenCalledOnce();
  });
  it.each(['BUDGET_EXHAUSTED', 'BUDGET_UNAVAILABLE'] as const)('distinguishes admission %s without dispatch', async (code) => {
    const f = judgeServiceFixture();
    f.budget.admit.mockResolvedValueOnce({ ok: false, code });
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ ok: false, error: { code, phase: 'admission' },
      receipt: { attempts: 0, cost: { status: 'not-incurred' }, budget: { state: 'not-admitted' } } });
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains liability after an ambiguous marker exception and never refunds or sends', async () => {
    const f = judgeServiceFixture();
    f.budget.markDispatched.mockRejectedValueOnce(new Error('synthetic-secret-canary'));
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result).toMatchObject({ ok: false, error: { code: 'BUDGET_UNAVAILABLE', phase: 'dispatch', retryable: false },
      receipt: { attempts: 0, dispatch: 'unknown', cost: { amountMicroUsd: '2753' }, budget: { state: 'pending-reconciliation' } } });
    expect(f.budget.release).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('synthetic-secret-canary');
  });
  it('denies unverified authority before acquiring a key or hold', async () => {
    const f = judgeServiceFixture();
    f.options.authorize = vi.fn(async () => false);
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.budget.admit).not.toHaveBeenCalled();
  });
  it('releases only proven-unsent cancellation after admission', async () => {
    const f = judgeServiceFixture();
    const controller = new AbortController();
    f.budget.admit.mockImplementationOnce(async (input) => { controller.abort(); return { ok: true, holdId: input.callId }; });
    expect(await createJudgeService(f.options).judge(judgeRequest(), { signal: controller.signal }))
      .toMatchObject({ error: { code: 'CANCELLED', phase: 'dispatch' }, receipt: { attempts: 0, budget: { state: 'released' } } });
    expect(f.budget.release).toHaveBeenCalledOnce();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([() => 'invalid id', () => { throw new Error('private exception'); }])('returns mandatory safe metadata for invalid generated IDs', async (generateId) => {
    const f = judgeServiceFixture();
    const result = await createJudgeService({ ...f.options, generateId }).judge(judgeRequest());
    expect(result).toMatchObject({ error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' }, receipt: { attempts: 0 } });
    expect(result.receipt.callId).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(result.receipt.correlationId).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('has independent financial IDs even with the same caller correlation', async () => {
    const f = judgeServiceFixture();
    const service = createJudgeService(f.options);
    const a = await service.judge(judgeRequest({ correlationId: 'fixture-correlation' }));
    const b = await service.judge(judgeRequest({ correlationId: 'fixture-correlation' }));
    expect(a.receipt.callId).not.toBe(b.receipt.callId);
    expect(a.receipt.correlationId).toBe(b.receipt.correlationId);
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
});
