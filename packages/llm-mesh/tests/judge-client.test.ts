import { describe, expect, it, vi } from 'vitest';
import { createRemoteJudgeClient } from '../src/judge/client.js';
import { judgeRequest, qualifiedDescriptor } from './judge-fixtures.js';
import type { JudgeReceipt, JudgeResult } from '../src/judge/receipt.js';

const mockReceipt = (): JudgeReceipt => ({
  schemaVersion: 1, callId: 'test-call-1', correlationId: 'test-corr-1',
  evaluator: qualifiedDescriptor().evaluator, servedEvaluator: qualifiedDescriptor().evaluator,
  servedModelId: 'synthetic-served-model', startedAt: '2026-10-12T00:00:00.000Z',
  finishedAt: '2026-10-12T00:00:01.000Z', latencyMs: 1000, dispatch: 'completed', attempts: 1,
  usage: { tokens: { input: { value: 100, source: 'provider' }, output: { value: 10, source: 'provider' },
    total: { value: 110, source: 'derived-sum' } }, evaluatorCalls: 1, explanations: 0 },
  cost: { status: 'actual', amountMicroUsd: '42', source: 'provider', rounding: 'ceil-micro-usd' },
  retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
  budget: { state: 'settled', overrun: false }, outcome: 'verdict',
});

const mockVerdictResult = (): JudgeResult => ({
  kind: 'verdict', ok: true,
  verdict: { decision: { pass: true }, confidence: { value: 0.95 }, score: { value: 0.95 } },
  receipt: mockReceipt(),
});

describe('remote judge client', () => {
  it('authenticates to mesh without JEV key and returns valid verdict result', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify(mockVerdictResult()), { status: 200, headers: { 'content-type': 'application/json' } });
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
      return new Response(JSON.stringify(mockVerdictResult()), { status: 200, headers: { 'content-type': 'application/json' } });
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
    const errorResult: JudgeResult = {
      kind: 'error', ok: false,
      error: { code: 'REQUEST_INVALID', message: 'Invalid judge request.', phase: 'preflight', retryable: false },
      receipt: { ...mockReceipt(), outcome: 'error', errorCode: 'REQUEST_INVALID' },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(errorResult), { status: 400, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest());
    expect(result).toEqual(errorResult);
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
});
