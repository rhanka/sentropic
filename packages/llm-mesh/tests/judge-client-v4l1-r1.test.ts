import { describe, expect, it, vi } from 'vitest';
import { createRemoteJudgeClient } from '../src/judge/client.js';
import { createJudgeService } from '../src/judge/service.js';
import { judgeRequest, judgeServiceFixture, jevResponse } from './judge-fixtures.js';
import type { JudgeRequest } from '../src/judge/request.js';
import type { JudgeResult } from '../src/judge/receipt.js';

async function realServiceResult(request: JudgeRequest, nativeAnswer?: unknown) {
  const fixture = judgeServiceFixture();
  if (nativeAnswer !== undefined) {
    fixture.transport.send.mockResolvedValue({ ok: true, body: jevResponse(nativeAnswer) });
  }
  const service = createJudgeService(fixture.options);
  const served = await service.judge(request);
  if (!served.ok) throw new Error(`fixture service failed: ${JSON.stringify(served)}`);
  return served;
}

async function realServiceResultRaw(request: JudgeRequest, nativeAnswer?: unknown) {
  const fixture = judgeServiceFixture();
  if (nativeAnswer !== undefined) {
    fixture.transport.send.mockResolvedValue({ ok: true, body: jevResponse(nativeAnswer) });
  }
  const service = createJudgeService({ ...fixture.options, policy: { allowRaw: true } });
  const served = await service.judge(request);
  if (!served.ok) throw new Error(`fixture service failed: ${JSON.stringify(served)}`);
  return served;
}

async function viaClientCounted(request: JudgeRequest, payload: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
    fetch: fetch as unknown as typeof globalThis.fetch });
  return { result: await client.judge(request), fetch };
}

const CANARY = 'REVIEW-CONTENT-CANARY';

function withEvaluatorCanary(payload: Record<string, unknown>) {
  const receipt = payload.receipt as unknown as Record<string, unknown>;
  receipt.evaluator = { ...(receipt.evaluator as Record<string, unknown>),
    unexpected: { echoedInput: CANARY } };
  return payload;
}

function errorEnvelopeFromVerdict(served: JudgeResult) {
  const receipt = { ...(structuredClone(served.receipt) as unknown as Record<string, unknown>),
    outcome: 'error', errorCode: 'TIMEOUT' };
  return { kind: 'error', ok: false,
    error: { code: 'TIMEOUT', message: 'Judge deadline exceeded.', phase: 'dispatch', retryable: true },
    receipt };
}

describe('V4-L1-R1 F1 undeclared receipt.evaluator fields', () => {
  it('F1a rejects an evaluator canary on the verdict branch, raw-off', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f1a' });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    const control = await viaClientCounted(request, served);
    expect(control.result).toMatchObject({ kind: 'verdict', ok: true });
    const tampered = withEvaluatorCanary(structuredClone(served) as unknown as Record<string, unknown>);
    const { result, fetch } = await viaClientCounted(request, tampered);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('F1b rejects an evaluator canary on the verdict branch, raw-on', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f1b', raw: { mode: 'allowlisted' } });
    const served = structuredClone(await realServiceResultRaw(request)) as unknown as Record<string, unknown>;
    const control = await viaClientCounted(request, served);
    expect(control.result).toMatchObject({ kind: 'verdict', ok: true });
    const tampered = withEvaluatorCanary(structuredClone(served) as unknown as Record<string, unknown>);
    const { result, fetch } = await viaClientCounted(request, tampered);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('F1c rejects an evaluator canary on the error branch, raw-off', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f1c' });
    const served = await realServiceResult(request);
    const control = await viaClientCounted(request, errorEnvelopeFromVerdict(served));
    expect(control.result).toMatchObject({ kind: 'error', ok: false });
    const tampered = withEvaluatorCanary(errorEnvelopeFromVerdict(served) as unknown as Record<string, unknown>);
    const { result, fetch } = await viaClientCounted(request, tampered);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('F1d rejects an evaluator canary on the error branch, raw-on', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f1d', raw: { mode: 'allowlisted' } });
    const served = await realServiceResultRaw(request);
    const control = await viaClientCounted(request, errorEnvelopeFromVerdict(served));
    expect(control.result).toMatchObject({ kind: 'error', ok: false });
    const tampered = withEvaluatorCanary(errorEnvelopeFromVerdict(served) as unknown as Record<string, unknown>);
    const { result, fetch } = await viaClientCounted(request, tampered);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(fetch.mock.calls).toHaveLength(1);
  });
});
