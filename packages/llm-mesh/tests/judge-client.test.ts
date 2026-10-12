import { describe, expect, it, vi } from 'vitest';
import { createRemoteJudgeClient } from '../src/judge/client.js';
import { judgeRequest, qualifiedDescriptor } from './judge-fixtures.js';
import type { JudgeReceipt, JudgeResult } from '../src/judge/receipt.js';

const mockReceipt = (correlationId = 'test-corr-1'): JudgeReceipt => ({
  schemaVersion: 1, callId: 'test-call-1', correlationId,
  evaluator: qualifiedDescriptor().evaluator, servedEvaluator: qualifiedDescriptor().evaluator,
  servedModelId: 'synthetic-served-model', startedAt: '2026-10-12T00:00:00.000Z',
  finishedAt: '2026-10-12T00:00:01.000Z', latencyMs: 1000, dispatch: 'completed', attempts: 1,
  usage: { tokens: { input: { value: 100, source: 'provider' }, output: { value: 10, source: 'provider' },
    total: { value: 110, source: 'derived-sum' } }, evaluatorCalls: 1, explanations: 0 },
  cost: { status: 'actual', amountMicroUsd: '42', source: 'provider', rounding: 'ceil-micro-usd' },
  retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
  budget: { state: 'settled', overrun: false }, outcome: 'verdict',
});

const mockVerdictResult = (correlationId = 'test-corr-1'): JudgeResult => ({
  kind: 'verdict', ok: true,
  verdict: {
    criterionKind: 'binary', resolvedCriterionKind: 'binary', score: null,
    decision: { pass: true, origin: 'provider' }, label: null, rationale: null,
    confidence: null, distribution: null,
  },
  receipt: mockReceipt(correlationId),
});

describe('remote judge client', () => {
  it('authenticates to mesh without JEV key and returns valid verdict result', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      const corr = JSON.parse(String(init?.body)).correlationId;
      return new Response(JSON.stringify(mockVerdictResult(corr)), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal/llm-mesh',
      authToken: 'mesh-bearer-token',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await client.judge(judgeRequest({ correlationId: 'custom-corr-1' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('verdict');
      expect(result.receipt.callId).toBe('test-call-1');
    }
    expect(capturedUrl).toBe('https://mesh.internal/llm-mesh/judge');
    expect((capturedInit?.headers as Record<string, string>)?.authorization).toBe('Bearer mesh-bearer-token');
    const sentBody = JSON.parse(String(capturedInit?.body));
    expect(sentBody.correlationId).toBe('custom-corr-1');
  });

  it('generates correlation ID when omitted and echoes it in request', async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(mockVerdictResult(sentBody?.correlationId as string)), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal/llm-mesh/judge',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await client.judge(judgeRequest());
    expect(result.ok).toBe(true);
    expect(typeof sentBody?.correlationId).toBe('string');
    expect((sentBody?.correlationId as string).length).toBeGreaterThan(0);
  });

  it('returns typed error result when server returns error with receipt', async () => {
    let sentCorr = '';
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentCorr = JSON.parse(String(init?.body)).correlationId;
      const errorResult: JudgeResult = {
        kind: 'error', ok: false,
        error: { code: 'REQUEST_INVALID', message: 'Invalid judge request.', phase: 'preflight', retryable: false },
        receipt: { ...mockReceipt(sentCorr), outcome: 'error', errorCode: 'REQUEST_INVALID' },
      };
      return new Response(JSON.stringify(errorResult), { status: 400, headers: { 'content-type': 'application/json' } });
    });
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest());
    expect(result).toEqual({
      kind: 'error', ok: false,
      error: { code: 'REQUEST_INVALID', message: 'Invalid judge request.', phase: 'preflight', retryable: false },
      receipt: { ...mockReceipt(sentCorr), outcome: 'error', errorCode: 'REQUEST_INVALID' },
    });
  });

  it('returns connection failure on network error without retrying', async () => {
    const fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'fail-corr' }));
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'TRANSPORT_FAILED', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
      usage: { evaluatorCalls: null }, correlationId: 'fail-corr',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refuses pre-aborted call as not-sent with zero evaluator calls and no egress', async () => {
    const fetch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest(), { signal: controller.signal });
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'CANCELLED', phase: 'preflight' },
      receipt: null, callStatus: 'not-sent',
      usage: { evaluatorCalls: 0 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns connection failure when cancelled mid-flight keeping cost uncertainty', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest(), { signal: controller.signal });
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'CANCELLED', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
      usage: { evaluatorCalls: null },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns connection failure when response exceeds byte bound', async () => {
    const big = JSON.stringify({ kind: 'verdict', ok: true, padding: 'x'.repeat(1000) });
    const fetch = vi.fn(async () => new Response(big, { status: 200, headers: { 'content-length': '1500' } }));
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      maxResponseBytes: 500,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await client.judge(judgeRequest());
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });
  });

  it('keeps execution and cost uncertainty on unknown wire error code', async () => {
    const weird = {
      kind: 'error', ok: false,
      error: { code: 'NONEXISTENT_ERROR_CODE', phase: 'dispatch' },
      receipt: { ...mockReceipt('weird-corr'), outcome: 'error' as const, errorCode: 'NONEXISTENT_ERROR_CODE' as any },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(weird), { status: 500, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'weird-corr' }));
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
      usage: { evaluatorCalls: null },
      correlationId: 'weird-corr',
    });
    expect(result.receipt).toBeNull();
  });

  it('keeps execution and cost uncertainty on unknown wire error phase', async () => {
    const weirdPhase = {
      kind: 'error', ok: false,
      error: { code: 'TIMEOUT', phase: 'unknown-phase' },
      receipt: { ...mockReceipt('phase-corr'), outcome: 'error' as const, errorCode: 'TIMEOUT' },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(weirdPhase), { status: 500, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'phase-corr' }));
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
      usage: { evaluatorCalls: null },
      correlationId: 'phase-corr',
    });
  });

  it('refuses responses with discordant kind/outcome, mismatched error codes, or invalid shapes', async () => {
    const corr = 'disc-corr';
    const client = (body: unknown) => createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch,
    }).judge(judgeRequest({ correlationId: corr }));

    const r1 = await client({ ...mockVerdictResult(corr), receipt: { ...mockReceipt(corr), outcome: 'error', errorCode: 'TIMEOUT' } });
    expect(r1).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' } });

    const r2 = await client({ kind: 'error', ok: false, error: { code: 'TIMEOUT', phase: 'dispatch' }, receipt: mockReceipt(corr) });
    expect(r2).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' } });

    const r3 = await client({ kind: 'error', ok: false, error: { code: 'TIMEOUT', phase: 'dispatch' }, receipt: { ...mockReceipt(corr), outcome: 'error', errorCode: 'REQUEST_INVALID' } });
    expect(r3).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' } });

    const r4 = await client({ ...mockVerdictResult(corr), verdict: { decision: { pass: true } } });
    expect(r4).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' } });

    const r5 = await client({ ...mockVerdictResult(corr), receipt: { ...mockReceipt(corr), cost: { status: 'actual', amountMicroUsd: '-1' } } });
    expect(r5).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' } });
  });

  it('never retries the call automatically on 502/503/429 status', async () => {
    for (const status of [429, 502, 503, 504]) {
      const fetch = vi.fn(async () => new Response('HTML Gateway Error', { status }));
      const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
      const result = await client.judge(judgeRequest());
      expect(result.ok).toBe(false);
      expect(result.kind).toBe('connection-failure');
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it('bounds slow body stream reading by caller deadline and returns TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream<Uint8Array>({
        start() {},
      });
      const fetch = vi.fn(async () => new Response(stream, { status: 200 }));
      const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', timeoutMs: 1000, fetch: fetch as unknown as typeof globalThis.fetch });
      const resultPromise = client.judge(judgeRequest());
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;
      expect(result).toMatchObject({
        kind: 'connection-failure', ok: false, error: { code: 'TIMEOUT', phase: 'dispatch' },
        receipt: null, callStatus: 'unknown',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels reader and returns CANCELLED when aborted during stream read', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start() {},
      cancel() { cancelled = true; },
    });
    const fetch = vi.fn(async () => {
      setTimeout(() => controller.abort(), 10);
      return new Response(stream, { status: 200 });
    });
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest(), { signal: controller.signal });
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'CANCELLED', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });
    expect(cancelled).toBe(true);
  });

  it('refuses 3xx redirects without forwarding headers or following', async () => {
    let capturedInit: RequestInit | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 307, headers: { location: 'https://evil.internal/judge' } });
    });
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      headers: { 'x-custom-secret': 'secret-value' },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await client.judge(judgeRequest());
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });
    expect(capturedInit?.redirect).toBe('manual');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns typed not-sent connection failure on token resolution exception or abort', async () => {
    const fetch = vi.fn();
    const failingAuthClient = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      authToken: () => { throw new Error('vault unreachable'); },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result1 = await failingAuthClient.judge(judgeRequest());
    expect(result1).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' },
      receipt: null, callStatus: 'not-sent',
    });
    expect(fetch).not.toHaveBeenCalled();

    const controller = new AbortController();
    const abortingAuthClient = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      authToken: async () => {
        controller.abort();
        return 'token';
      },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result2 = await abortingAuthClient.judge(judgeRequest(), { signal: controller.signal });
    expect(result2).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'CANCELLED', phase: 'preflight' },
      receipt: null, callStatus: 'not-sent',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds client timeout with min when options.timeoutMs is strictly below server deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const client = createRemoteJudgeClient({
        baseUrl: 'https://mesh.internal',
        timeoutMs: 500,
        fetch: fetch as unknown as typeof globalThis.fetch,
      });
      const req = { ...judgeRequest(), policy: { timeoutMs: 10_000 } };
      const promise = client.judge(req);
      await vi.advanceTimersByTimeAsync(500);
      const result = await promise;
      expect(result).toMatchObject({
        kind: 'connection-failure', ok: false, error: { code: 'TIMEOUT', phase: 'dispatch' },
        receipt: null, callStatus: 'unknown',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies 1000ms grace margin to server default deadline (11000ms) and at 60000ms cap (61000ms)', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
      const p1 = client.judge(judgeRequest());
      let p1Settled = false;
      p1.finally(() => { p1Settled = true; });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetch).toHaveBeenCalledOnce();
      expect(p1Settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(p1Settled).toBe(true);
      expect(await p1).toMatchObject({ kind: 'connection-failure', error: { code: 'TIMEOUT', phase: 'dispatch' } });

      const p2 = client.judge({ ...judgeRequest(), policy: { timeoutMs: 60_000 } });
      let p2Settled = false;
      p2.finally(() => { p2Settled = true; });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p2Settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(p2Settled).toBe(true);
      expect(await p2).toMatchObject({ kind: 'connection-failure', error: { code: 'TIMEOUT', phase: 'dispatch' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no abort event listeners on caller signal after preflight completion', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(mockVerdictResult('corr-1')), { status: 200 }));
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      authToken: async () => 'test-token',
      headers: async () => ({ 'x-custom': 'val' }),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    await client.judge(judgeRequest({ correlationId: 'corr-1' }), { signal: controller.signal });
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation and deadline when token resolution is stalled in preflight', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn();
      const client = createRemoteJudgeClient({
        baseUrl: 'https://mesh.internal',
        authToken: () => new Promise<string>(() => {}),
        fetch: fetch as unknown as typeof globalThis.fetch,
      });
      const p1 = client.judge(judgeRequest());
      await vi.advanceTimersByTimeAsync(11_000);
      expect(await p1).toMatchObject({ kind: 'connection-failure', error: { code: 'TIMEOUT', phase: 'preflight' }, callStatus: 'not-sent' });
      expect(fetch).not.toHaveBeenCalled();

      const controller = new AbortController();
      const p2 = client.judge(judgeRequest(), { signal: controller.signal });
      controller.abort();
      expect(await p2).toMatchObject({ kind: 'connection-failure', error: { code: 'CANCELLED', phase: 'preflight' }, callStatus: 'not-sent' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses body stream exceeding maxResponseBytes during chunk reading', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array(400));
        ctrl.enqueue(new Uint8Array(200));
      },
      cancel() { cancelled = true; },
    });
    const fetch = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      maxResponseBytes: 500,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await client.judge(judgeRequest());
    expect(result).toMatchObject({
      kind: 'connection-failure', ok: false,
      error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });
    expect(cancelled).toBe(true);
  });

  it('never leaks JEV_API_KEY from environment to headers or body', async () => {
    const originalKey = process.env.JEV_API_KEY;
    process.env.JEV_API_KEY = 'super-secret-jev-key-env';
    try {
      let capturedInit: RequestInit | undefined;
      const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        const corr = JSON.parse(String(init?.body)).correlationId;
        return new Response(JSON.stringify(mockVerdictResult(corr)), { status: 200 });
      });
      const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
      const result = await client.judge(judgeRequest());
      expect(result.ok).toBe(true);
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('super-secret-jev-key-env');
      expect(String(capturedInit?.body)).not.toContain('super-secret-jev-key-env');
    } finally {
      if (originalKey === undefined) delete process.env.JEV_API_KEY;
      else process.env.JEV_API_KEY = originalKey;
    }
  });

  it('refuses invalid mesh response shapes with MESH_UNAVAILABLE', async () => {
    const fetchWithBody = (body: unknown) => {
      const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
      return createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fn as unknown as typeof globalThis.fetch });
    };

    const badCorr = mockVerdictResult('different-corr');
    const res1 = await fetchWithBody(badCorr).judge(judgeRequest({ correlationId: 'sent-corr' }));
    expect(res1).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });

    const badSchema = { ...mockVerdictResult('my-corr'), receipt: { ...mockReceipt('my-corr'), schemaVersion: 2 } };
    const res2 = await fetchWithBody(badSchema).judge(judgeRequest({ correlationId: 'my-corr' }));
    expect(res2).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });

    const badUsage = { ...mockVerdictResult('my-corr'), receipt: { ...mockReceipt('my-corr'), usage: { tokens: null } } };
    const res3 = await fetchWithBody(badUsage).judge(judgeRequest({ correlationId: 'my-corr' }));
    expect(res3).toMatchObject({
      kind: 'connection-failure', ok: false, error: { code: 'MESH_UNAVAILABLE', phase: 'dispatch' },
      receipt: null, callStatus: 'unknown',
    });
  });
});
