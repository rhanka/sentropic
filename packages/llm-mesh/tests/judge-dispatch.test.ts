import { describe, expect, it, vi } from 'vitest';
import { createJudgeService } from '../src/judge/service.js';
import { judgeRequest, judgeServiceFixture, judgePrice, jevResponse } from './judge-fixtures.js';

describe('judge admission and exactly one dispatch', () => {
  it.each(['auth', 'admit', 'mark', 'provider', 'settle', 'receipt'] as const)('bounds a stalled %s port without losing late accounting', async (stage) => {
    vi.useFakeTimers();
    const f = judgeServiceFixture();
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => { acknowledge = resolve; });
    if (stage === 'auth') {
      const original = f.options.resolveAuth;
      f.options.resolveAuth = async (request) => { await gate; return original(request); };
    } else if (stage === 'admit') f.budget.admit.mockImplementationOnce(async (input) => { await gate; return { ok: true, holdId: input.callId }; });
    else if (stage === 'mark') f.budget.markDispatched.mockImplementationOnce(async () => { await gate; return { ok: true }; });
    else if (stage === 'provider') f.transport.send.mockImplementationOnce(async () => { await gate; return { ok: true, body: jevResponse() }; });
    else if (stage === 'settle') {
      const original = f.budget.settle;
      f.budget.settle.mockImplementationOnce(async (input) => { await gate; return original(input); });
    }
    else vi.mocked(f.options.receipts.persist).mockImplementationOnce(async () => { await gate; });
    const controller = new AbortController();
    let received: unknown;
    const pending = createJudgeService(f.options).judge(judgeRequest(), { signal: controller.signal }).then((result) => { received = result; return result; });
    try {
      await vi.advanceTimersByTimeAsync(10000);
      expect(received).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
      if (stage !== 'auth') expect(received).toMatchObject({ receipt: { budget: { state: 'pending-reconciliation' } } });
      if (stage === 'settle' || stage === 'receipt') expect(received).toMatchObject({ error: { phase: 'settlement', retryable: false }, receipt: { attempts: 1 } });
      else if (stage === 'provider') expect(received).toMatchObject({ error: { phase: 'dispatch', retryable: false }, receipt: { attempts: 1, dispatch: 'unknown' } });
      else expect(f.transport.send).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort(); acknowledge();
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
    expect(f.transport.send).toHaveBeenCalledTimes(['provider', 'settle', 'receipt'].includes(stage) ? 1 : 0);
    if (stage === 'admit' || stage === 'mark') expect(f.budget.release).toHaveBeenCalledOnce();
    if (stage === 'provider') expect(f.state.ledger).toMatchObject([{ cost: { amountMicroUsd: '42' }, outcome: 'error' }]);
    if (stage === 'settle') {
      expect(f.state.ledger).toMatchObject([{ budget: { state: 'settled' }, outcome: 'verdict' }]);
      expect(f.state.receipts).toMatchObject([{ budget: { state: 'settled' }, outcome: 'verdict' }]);
      expect(f.state.receipts[0]).not.toHaveProperty('errorCode');
      expect(f.state.ledger[0]).not.toHaveProperty('errorCode');
    }
  });
  it('agrees on settled verdict between ledger and persisted receipt on cancellation during settlement', async () => {
    const f = judgeServiceFixture();
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const original = f.budget.settle;
    f.budget.settle.mockImplementationOnce(async (input) => { await gate; return original(input); });
    const controller = new AbortController();
    const pending = createJudgeService(f.options).judge(judgeRequest(), { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const received = await pending;
    expect(received).toMatchObject({ ok: false, error: { code: 'CANCELLED', phase: 'settlement' } });
    acknowledge();
    await new Promise((r) => setTimeout(r, 10));
    expect(f.state.ledger).toMatchObject([{ budget: { state: 'settled' }, outcome: 'verdict' }]);
    expect(f.state.receipts).toMatchObject([{ budget: { state: 'settled' }, outcome: 'verdict' }]);
    expect(f.state.receipts[0]).not.toHaveProperty('errorCode');
    expect(f.state.ledger[0]).not.toHaveProperty('errorCode');
  });
  it('maps adapter CANCELLED to TIMEOUT on provider deadline expiry', async () => {
    const f = judgeServiceFixture();
    f.transport.send.mockImplementationOnce(async () => {
      f.state.now = 10001;
      return { ok: false, error: { code: 'CANCELLED', phase: 'dispatch', message: 'Cancelled.' } };
    });
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT', phase: 'dispatch' },
      receipt: { attempts: 1, dispatch: 'unknown' },
    });
  });
  it.each(['descriptor', 'price'] as const)('checks expiry after %s resolution before acquiring credentials', async (stage) => {
    const f = judgeServiceFixture();
    if (stage === 'descriptor') f.options.resolveEvaluator = async () => { f.state.now = 10001; return f.descriptor; };
    else f.options.resolvePrice = async () => { f.state.now = 10001; return judgePrice(); };
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'TIMEOUT', phase: 'admission' }, receipt: { attempts: 0 } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.budget.admit).not.toHaveBeenCalled();
  });
  it('checks the reduced host deadline again after durable marking', async () => {
    const f = judgeServiceFixture();
    f.budget.markDispatched.mockImplementationOnce(async () => { f.state.now = 51; return { ok: true }; });
    expect(await createJudgeService({ ...f.options, policy: { timeoutMs: 50 } }).judge(judgeRequest()))
      .toMatchObject({ error: { code: 'TIMEOUT', phase: 'dispatch' }, receipt: { attempts: 0, budget: { state: 'released' } } });
    expect(f.budget.release).toHaveBeenCalledOnce();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rechecks verified authority after marking before any send', async () => {
    const f = judgeServiceFixture();
    f.options.authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED', phase: 'dispatch' } });
    expect(f.budget.release).toHaveBeenCalledOnce();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([true, false])('releases a refused marker only with explicit unsent proof (%s)', async (provenUnsent) => {
    const f = judgeServiceFixture();
    f.budget.markDispatched.mockResolvedValueOnce({ ok: false, code: 'PROVIDER_UNAVAILABLE', provenUnsent });
    const result = await createJudgeService(f.options).judge(judgeRequest());
    expect(result.receipt.budget.state).toBe(provenUnsent ? 'released' : 'pending-reconciliation');
    expect(f.budget.release).toHaveBeenCalledTimes(provenUnsent ? 1 : 0);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains ambiguous admission liability and refuses pre-aborted work before configuration I/O', async () => {
    const f = judgeServiceFixture();
    f.budget.admit.mockRejectedValueOnce(new Error('ambiguous durable hold'));
    expect(await createJudgeService(f.options).judge(judgeRequest())).toMatchObject({ error: { code: 'BUDGET_UNAVAILABLE', retryable: false },
      receipt: { attempts: 0, budget: { state: 'pending-reconciliation' }, cost: { amountMicroUsd: '2753' } } });
    const controller = new AbortController();
    controller.abort();
    vi.mocked(f.options.resolveAuth).mockClear();
    expect(await createJudgeService(f.options).judge(judgeRequest(), { signal: controller.signal })).toMatchObject({ error: { code: 'CANCELLED', phase: 'preflight' } });
    expect(f.options.resolveAuth).not.toHaveBeenCalled();
    expect(f.budget.release).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
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
  it('holds cancellation during admission pending until late unsent proof releases the hold', async () => {
    const f = judgeServiceFixture();
    const controller = new AbortController();
    f.budget.admit.mockImplementationOnce(async (input) => { controller.abort(); return { ok: true, holdId: input.callId }; });
    const result = await createJudgeService(f.options).judge(judgeRequest(), { signal: controller.signal });
    expect(result).toMatchObject({ error: { code: 'CANCELLED', phase: 'admission', retryable: false },
      receipt: { attempts: 0, budget: { state: 'pending-reconciliation' } } });
    await vi.waitFor(() => expect(f.budget.release).toHaveBeenCalledOnce());
    expect(result.receipt.budget.state).toBe('pending-reconciliation');
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
