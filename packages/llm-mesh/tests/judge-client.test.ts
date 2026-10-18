import { describe, expect, it, vi } from 'vitest';
import { createRemoteJudgeClient } from '../src/judge/client.js';
import { createJudgeService } from '../src/judge/service.js';
import { judgeRequest, judgeServiceFixture, qualifiedDescriptor } from './judge-fixtures.js';
import type { JudgeReceipt, JudgeResult } from '../src/judge/receipt.js';
import type { JudgeRequest } from '../src/judge/request.js';

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
    criterionKind: 'binary', resolvedCriterionKind: 'binary',
    score: { value: 0.25, meaning: 'probability-true',
      scale: { kind: 'bounded', min: 0, max: 1, direction: 'unordered' } },
    decision: null, label: null, rationale: null,
    confidence: null, distribution: null,
  },
  receipt: mockReceipt(correlationId),
});

/** Serve a real service result through the remote client over a JSON wire. */
const roundTrip = async (request: JudgeRequest) => {
  const service = createJudgeService(judgeServiceFixture().options);
  const served = await service.judge(request);
  const fetch = vi.fn(async () => new Response(JSON.stringify(served),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
    fetch: fetch as unknown as typeof globalThis.fetch });
  return client.judge(request);
};

/** Fail fast when an uncooperative fetch would otherwise hang judge() past the test timeout. */
const failAfterHang = <T>(judged: Promise<T>): Promise<T> => Promise.race([judged,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('judge() hung on an uncooperative fetch')), 500))]);

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

  it('rejects a verdict whose receipt evaluator does not bind the request', async () => {
    const corr = 'bind-corr';
    const receipt = { ...mockReceipt(corr), evaluator: { ...mockReceipt(corr).evaluator, evaluatorId: 'foreign-evaluator' } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), receipt }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: corr }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a not-incurred cost carrying a nonzero amount', async () => {
    const corr = 'cost-corr';
    const receipt = { ...mockReceipt(corr), cost: { status: 'not-incurred', amountMicroUsd: '42', source: 'no-dispatch' } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), receipt }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: corr }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rebuilds static error wording and drops forged retry metadata', async () => {
    const corr = 'retry-corr';
    const forged = {
      kind: 'error', ok: false,
      error: { code: 'TIMEOUT', message: { text: 'late' }, phase: 'settlement', retryable: true, retryAfterMs: 1000000000 },
      receipt: { ...mockReceipt(corr), outcome: 'error' as const, errorCode: 'TIMEOUT' },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(forged),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: corr }));
    expect(result).toEqual({
      kind: 'error', ok: false,
      error: { code: 'TIMEOUT', message: 'Judge deadline exceeded.', phase: 'settlement', retryable: false },
      receipt: forged.receipt,
    });
  });

  it('rejects unsolicited providerRaw when raw evidence was not allowlisted', async () => {
    const corr = 'raw-corr';
    const verdict = { ...mockVerdictResult(corr).verdict, providerRaw: { data: { noul: 0.05 }, bytes: 13, truncated: false } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), verdict }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: corr }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects providerRaw whose byte claim disagrees with the bounded payload', async () => {
    const corr = 'rawbytes-corr';
    const verdict = { ...mockVerdictResult(corr).verdict, providerRaw: { data: { noul: 0.05 }, bytes: 999999, truncated: false } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), verdict }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const request = judgeRequest({ correlationId: corr, raw: { mode: 'allowlisted' } });
    const result = await client.judge(request);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects verdicts with invalid confidence or an unbalanced distribution', async () => {
    const corr = 'dist-corr';
    const client = (verdict: unknown) => createRemoteJudgeClient({
      baseUrl: 'https://mesh.internal',
      fetch: vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), verdict }),
        { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch,
    }).judge(judgeRequest({ correlationId: corr }));

    const badConfidence = { ...mockVerdictResult(corr).verdict,
      confidence: { value: 'high', min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'x', origin: 'provider' } };
    expect(await client(badConfidence)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });

    const badSum = { ...mockVerdictResult(corr).verdict,
      distribution: [{ outcome: 'a', nativeOutcome: 'a', probability: 0.25 }] };
    expect(await client(badSum)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('rejects a verdict whose criterionKind disagrees with the request', async () => {
    const corr = 'kind-corr';
    const verdict = { ...mockVerdictResult(corr).verdict, criterionKind: 'choice' };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult(corr), verdict }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: corr }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('accepts a service no-rule verdict with absent decision through a round trip', async () => {
    const request = judgeRequest({ correlationId: 'rt-null-corr' });
    const result = await roundTrip(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('verdict');
      expect(result.verdict.decision).toBeNull();
      expect(result.verdict.score?.value).toBe(0.25);
      expect(result.receipt.correlationId).toBe('rt-null-corr');
      expect(result.receipt.evaluator).toEqual(request.evaluator);
    }
  });

  it('accepts a service negative threshold verdict through a round trip', async () => {
    const request = judgeRequest({ correlationId: 'rt-neg-corr',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const result = await roundTrip(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe('verdict');
      expect(result.verdict.decision).toMatchObject({ pass: false, origin: 'threshold' });
      expect(result.receipt.correlationId).toBe('rt-neg-corr');
    }
  });

  it('binds response validation to the transmitted evaluator snapshot', async () => {
    const serve = (receipt: unknown) => vi.fn(async () => new Response(
      JSON.stringify({ ...mockVerdictResult('mutrev-corr'), receipt }),
      { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
    const mutatingAuth = (request: JudgeRequest) => async () => {
      request.evaluator.revision = 'different-revision';
      return 'token';
    };
    // Receipt bound to the transmitted revision is accepted despite the mutation.
    const original = mockVerdictResult('mutrev-corr').receipt;
    const requestA = judgeRequest({ correlationId: 'mutrev-corr' });
    const clientA = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: serve(original),
      authToken: mutatingAuth(requestA) });
    expect(await clientA.judge(requestA)).toMatchObject({ kind: 'verdict', ok: true });
    // Receipt matching only the mutation is refused.
    const mutated = { ...mockReceipt('mutrev-corr'),
      evaluator: { ...mockReceipt('mutrev-corr').evaluator, revision: 'different-revision' } };
    const requestB = judgeRequest({ correlationId: 'mutrev-corr' });
    const clientB = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: serve(mutated),
      authToken: mutatingAuth(requestB) });
    expect(await clientB.judge(requestB)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    // Mutation during transport is equally ignored.
    const requestC = judgeRequest({ correlationId: 'mutrev-corr' });
    const transportMutant = vi.fn(async () => {
      requestC.evaluator.revision = 'transport-revision';
      return new Response(JSON.stringify(mockVerdictResult('mutrev-corr')),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const clientC = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: transportMutant });
    expect(await clientC.judge(requestC)).toMatchObject({ kind: 'verdict', ok: true });
  });

  it('binds criterion concordance to the transmitted snapshot', async () => {
    const choiceCriterion = { kind: 'choice' as const, instructions: 'Pick.',
      options: [{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }] };
    const choiceVerdict = {
      criterionKind: 'choice', resolvedCriterionKind: 'choice', score: null, decision: null,
      label: { value: 'a', origin: 'provider' }, rationale: null,
      confidence: { value: 0.7, min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'r', origin: 'provider' },
      distribution: [
        { outcome: 'a', nativeOutcome: 'a', probability: 0.7 },
        { outcome: 'b', nativeOutcome: 'b', probability: 0.3 },
      ],
    };
    const serve = (verdict: unknown) => vi.fn(async () => new Response(
      JSON.stringify({ ...mockVerdictResult('mutkind-corr'), verdict }),
      { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
    const mutatingAuth = (request: JudgeRequest) => async () => {
      request.criterion = choiceCriterion;
      return 'token';
    };
    const requestA = judgeRequest({ correlationId: 'mutkind-corr' });
    const clientA = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: serve(mockVerdictResult('mutkind-corr').verdict), authToken: mutatingAuth(requestA) });
    expect(await clientA.judge(requestA)).toMatchObject({ kind: 'verdict', ok: true });
    const requestB = judgeRequest({ correlationId: 'mutkind-corr' });
    const clientB = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: serve(choiceVerdict), authToken: mutatingAuth(requestB) });
    expect(await clientB.judge(requestB)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('binds raw permission to the transmitted snapshot', async () => {
    const rawVerdict = { ...mockVerdictResult('mutraw-corr').verdict,
      providerRaw: { data: { noul: 0.25 }, bytes: 13, truncated: false } };
    const serve = vi.fn(async () => new Response(JSON.stringify({ ...mockVerdictResult('mutraw-corr'), verdict: rawVerdict }),
      { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
    // Mutation enabling raw after the snapshot does not authorize returned raw data.
    const requestA = judgeRequest({ correlationId: 'mutraw-corr' });
    const clientA = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: serve,
      authToken: async () => { requestA.raw = { mode: 'allowlisted' }; return 'token'; } });
    expect(await clientA.judge(requestA)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    // Mutation disabling raw after the snapshot does not revoke the transmitted permission.
    const requestB = judgeRequest({ correlationId: 'mutraw-corr', raw: { mode: 'allowlisted' } });
    const clientB = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: serve,
      authToken: async () => { requestB.raw = { mode: 'none' }; return 'token'; } });
    expect(await clientB.judge(requestB)).toMatchObject({ kind: 'verdict', ok: true });
  });

  it('refuses NaN inputs before any egress without inventing a receipt', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(mockVerdictResult('nan-corr')),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'nan-corr', inputs: { output: NaN } }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'not-sent',
      error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' }, correlationId: 'nan-corr' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses present undefined properties before any egress', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(mockVerdictResult('undef-corr')),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'undef-corr', inputs: { output: null, state: undefined } }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'not-sent',
      error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' }, correlationId: 'undef-corr' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses over-256-KiB requests before any egress', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(mockVerdictResult('big-corr')),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.judge(judgeRequest({ correlationId: 'big-corr', inputs: { output: 'x'.repeat(300_000) } }));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'not-sent',
      error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' }, correlationId: 'big-corr' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses excessively deep requests before any egress', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(mockVerdictResult('depth-corr')),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal', fetch: fetch as unknown as typeof globalThis.fetch });
    const request = judgeRequest({ correlationId: 'depth-corr' }) as unknown as { inputs: { output: unknown } };
    let deep: unknown = 'leaf';
    for (let i = 0; i < 24; i++) deep = [deep];
    request.inputs.output = deep;
    const result = await client.judge(request as unknown as Parameters<typeof client.judge>[0]);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'not-sent',
      error: { code: 'MESH_UNAVAILABLE', phase: 'preflight' }, correlationId: 'depth-corr' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serializes the pre-auth snapshot when the live request mutates during auth resolution', async () => {
    let sentBody = '';
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify(mockVerdictResult('mut-corr')),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const request = judgeRequest({ correlationId: 'mut-corr', inputs: { output: 'original' } });
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: fetch as unknown as typeof globalThis.fetch,
      authToken: async () => { request.inputs.output = 'mutated-during-auth'; return 'token'; } });
    const result = await client.judge(request);
    expect(result.ok).toBe(true);
    expect(JSON.parse(sentBody).inputs).toEqual({ output: 'original' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('times out a fetch that ignores abort without retrying', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 5 });
    const result = await failAfterHang(client.judge(judgeRequest({ correlationId: 'hang-corr' })));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'unknown',
      error: { code: 'TIMEOUT' }, correlationId: 'hang-corr' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cancels a hanging fetch on caller abort without retrying', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 10_000 });
    const caller = new AbortController();
    const pending = client.judge(judgeRequest({ correlationId: 'abort-corr' }), { signal: caller.signal });
    caller.abort();
    const result = await failAfterHang(pending);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'unknown',
      error: { code: 'CANCELLED' }, correlationId: 'abort-corr' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ignores a late fetch settlement after timeout without retrying', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
      fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 5 });
    const pending = client.judge(judgeRequest({ correlationId: 'late-corr' }));
    const result = await failAfterHang(pending);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null, callStatus: 'unknown',
      error: { code: 'TIMEOUT' }, correlationId: 'late-corr' });
    release?.(new Response(JSON.stringify(mockVerdictResult('late-corr')),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledOnce();
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
