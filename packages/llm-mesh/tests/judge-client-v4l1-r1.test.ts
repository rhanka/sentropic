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

async function viaClient(request: JudgeRequest, payload: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
    fetch: fetch as unknown as typeof globalThis.fetch });
  return client.judge(request);
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

const choiceCriterion = { kind: 'choice' as const, instructions: 'Pick.',
  options: [{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }] };
const gradedCriterion = { kind: 'graded' as const, instructions: 'Grade.', direction: 'lower-is-better' as const,
  levels: [{ label: 'low', description: 'Low evidence' }, { label: 'middle', description: 'Middle evidence' },
    { label: 'high', description: 'High evidence' }] };
const gradedNative = () => ({ score: 1.25, probabilities: { '0': 0.1, '1': 0.55, '2': 0.35 },
  legend: { '0': 'Low evidence', '1': 'Middle evidence', '2': 'High evidence' }, confidence: 0.7 });
const choiceNative = () => ({ choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 });

describe('V4-L1-R1 F2 out-of-scale threshold', () => {
  it('F2a rejects a contradictory out-of-scale binary threshold; service is REQUEST_INVALID', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f2a',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 2 } });
    const direct = await createJudgeService(judgeServiceFixture().options).judge(request);
    expect(direct).toMatchObject({ kind: 'error', ok: false });
    if (!direct.ok && direct.kind === 'error') expect(direct.error.code).toBe('REQUEST_INVALID');
    const base = judgeRequest({ correlationId: 'l1r1-f2a',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const served = structuredClone(await realServiceResult(base)) as unknown as Record<string, unknown>;
    (served.verdict as unknown as Record<string, unknown>).decision = { pass: false,
      origin: 'threshold', rule: { kind: 'threshold', field: 'score', op: 'gte', value: 2 } };
    const { result, fetch } = await viaClientCounted(request, served);
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('F2b accepts binary endpoint thresholds and rejects just-outside values', async () => {
    for (const decision of [
      { kind: 'threshold', field: 'score', op: 'gte', value: 0 },
      { kind: 'threshold', field: 'score', op: 'gte', value: 1 },
      { kind: 'threshold', field: 'score', op: 'lte', value: 0 },
      { kind: 'threshold', field: 'score', op: 'lte', value: 1 },
    ] as const) {
      const request = judgeRequest({ correlationId: `l1r1-f2b-${decision.op}-${decision.value}`, decision });
      expect(await viaClient(request, await realServiceResult(request))).toMatchObject({ kind: 'verdict', ok: true });
    }
    for (const decision of [
      { kind: 'threshold', field: 'score', op: 'gte', value: 1.5 },
      { kind: 'threshold', field: 'score', op: 'lte', value: -0.5 },
    ] as const) {
      const request = judgeRequest({ correlationId: `l1r1-f2b-${decision.op}-${decision.value}`, decision });
      const base = judgeRequest({ correlationId: request.correlationId,
        decision: { kind: 'threshold', field: 'score', op: decision.op, value: 0.9 } });
      const served = structuredClone(await realServiceResult(base)) as unknown as Record<string, unknown>;
      (served.verdict as unknown as Record<string, unknown>).decision = { pass: false,
        origin: 'threshold',
        rule: { kind: 'threshold', field: 'score', op: decision.op, value: decision.value } };
      expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    }
  });

  it('F2c rejects an out-of-scale graded threshold and keeps endpoint thresholds', async () => {
    const request = judgeRequest({ correlationId: 'l1r1-f2c', criterion: gradedCriterion,
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 3 } });
    const direct = await createJudgeService(judgeServiceFixture().options).judge(request);
    expect(direct).toMatchObject({ kind: 'error', ok: false });
    if (!direct.ok && direct.kind === 'error') expect(direct.error.code).toBe('REQUEST_INVALID');
    const base = judgeRequest({ correlationId: 'l1r1-f2c', criterion: gradedCriterion,
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 2 } });
    const served = structuredClone(await realServiceResult(base, gradedNative())) as unknown as Record<string, unknown>;
    (served.verdict as unknown as Record<string, unknown>).decision = { pass: false,
      origin: 'threshold', rule: { kind: 'threshold', field: 'score', op: 'gte', value: 3 } };
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    for (const decision of [
      { kind: 'threshold', field: 'score', op: 'gte', value: 0 },
      { kind: 'threshold', field: 'score', op: 'gte', value: 2 },
      { kind: 'threshold', field: 'score', op: 'lte', value: 2 },
    ] as const) {
      const endpoint = judgeRequest({ correlationId: `l1r1-f2c-${decision.op}-${decision.value}`,
        criterion: gradedCriterion, decision });
      expect(await viaClient(endpoint, await realServiceResult(endpoint, gradedNative())))
        .toMatchObject({ kind: 'verdict', ok: true });
    }
  });
});
