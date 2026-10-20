import { describe, expect, it, vi } from 'vitest';
import { createRemoteJudgeClient } from '../src/judge/client.js';
import { createJudgeService } from '../src/judge/service.js';
import { judgeRequest, judgeServiceFixture, jevResponse } from './judge-fixtures.js';
import type { JudgeRequest } from '../src/judge/request.js';

const choiceCriterion = { kind: 'choice' as const, instructions: 'Pick.',
  options: [{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }] };
const gradedCriterion = { kind: 'graded' as const, instructions: 'Grade.', direction: 'lower-is-better' as const,
  levels: [{ label: 'low', description: 'Low evidence' }, { label: 'middle', description: 'Middle evidence' },
    { label: 'high', description: 'High evidence' }] };
const gradedNative = () => ({ score: 1.25, probabilities: { '0': 0.1, '1': 0.55, '2': 0.35 },
  legend: { '0': 'Low evidence', '1': 'Middle evidence', '2': 'High evidence' }, confidence: 0.7 });
const choiceNative = () => ({ choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 });

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

async function viaClient(request: JudgeRequest, payload: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = createRemoteJudgeClient({ baseUrl: 'https://mesh.internal',
    fetch: fetch as unknown as typeof globalThis.fetch });
  return client.judge(request);
}

describe('V4-L1 strict remote boundary', () => {
  it('P10 accepts valid no-rule and negative threshold service results', async () => {
    const noRule = judgeRequest({ correlationId: 'l1-p10-norule' });
    expect(await viaClient(noRule, await realServiceResult(noRule))).toMatchObject({ kind: 'verdict', ok: true });
    const threshold = judgeRequest({ correlationId: 'l1-p10-neg',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const neg = await viaClient(threshold, await realServiceResult(threshold));
    expect(neg).toMatchObject({ kind: 'verdict', ok: true });
    if (neg.ok) expect(neg.verdict.decision).toMatchObject({ pass: false, origin: 'threshold' });
  });

  it('P1 rejects a flipped threshold boolean from a real service result', async () => {
    const request = judgeRequest({ correlationId: 'l1-p1',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    const verdict = served.verdict as unknown as Record<string, unknown>;
    const decision = verdict.decision as unknown as Record<string, unknown>;
    decision.pass = true;
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P2 rejects a null decision despite a requested threshold', async () => {
    const request = judgeRequest({ correlationId: 'l1-p2',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    (served.verdict as unknown as Record<string, unknown>).decision = null;
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P3 rejects a substituted threshold rule with a matching boolean', async () => {
    const request = judgeRequest({ correlationId: 'l1-p3',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    const decision = (served.verdict as unknown as Record<string, unknown>).decision as unknown as Record<string, unknown>;
    decision.rule = { kind: 'threshold', field: 'score', op: 'gte', value: 0.1 };
    decision.pass = true;
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P4 rejects an altered resolved kind on a direct binary response', async () => {
    const request = judgeRequest({ correlationId: 'l1-p4' });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    (served.verdict as unknown as Record<string, unknown>).resolvedCriterionKind = 'choice';
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P5 rejects a below-argmax label and swapped native IDs', async () => {
    const request = judgeRequest({ correlationId: 'l1-p5', criterion: choiceCriterion });
    const served = structuredClone(await realServiceResult(request, choiceNative())) as unknown as Record<string, unknown>;
    const verdict = served.verdict as unknown as Record<string, unknown>;
    const below = structuredClone(served) as unknown as Record<string, unknown>;
    (below.verdict as unknown as Record<string, unknown>).label = { value: 'b', origin: 'provider' };
    expect(await viaClient(request, below)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    const swapped = structuredClone(served) as unknown as Record<string, unknown>;
    const distribution = (verdict.distribution as unknown[]).map((entry) => ({ ...(entry as object) }));
    const swappedDistribution = distribution.map((entry) => {
      const record = entry as unknown as Record<string, unknown>;
      return { ...record, nativeOutcome: record.nativeOutcome === 'a' ? 'b' : 'a' };
    });
    (swapped.verdict as unknown as Record<string, unknown>).distribution = swappedDistribution;
    expect(await viaClient(request, swapped)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P6 rejects graded out-of-domain evidence and inconsistent scores', async () => {
    const request = judgeRequest({ correlationId: 'l1-p6', criterion: gradedCriterion });
    const served = await realServiceResult(request, gradedNative());
    const badLabel = structuredClone(served) as unknown as Record<string, unknown>;
    const distribution = (badLabel.verdict as unknown as Record<string, unknown>).distribution as unknown as Record<string, unknown>[];
    distribution[0].outcome = 'unknown-level';
    expect(await viaClient(request, badLabel)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    const badScore = structuredClone(served) as unknown as Record<string, unknown>;
    ((badScore.verdict as unknown as Record<string, unknown>).score as unknown as Record<string, unknown>).value = 0.1;
    expect(await viaClient(request, badScore)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P7 rejects a foreign served evaluator on success', async () => {
    const request = judgeRequest({ correlationId: 'l1-p7' });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    (served.receipt as unknown as Record<string, unknown>).servedEvaluator = {
      providerId: 'gcp', evaluatorId: 'foreign-evaluator', revision: 'foreign-revision' };
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P8 rejects undeclared canaries and never returns them', async () => {
    const request = judgeRequest({ correlationId: 'l1-p8' });
    const served = await realServiceResult(request);
    for (const mutate of [
      (value: Record<string, unknown>) => { value.unexpected = 'canary'; },
      (value: Record<string, unknown>) => {
        (value.verdict as unknown as Record<string, unknown>).unexpected = { echoedInput: 'canary' };
      },
      (value: Record<string, unknown>) => {
        ((value.verdict as unknown as Record<string, unknown>).score as unknown as Record<string, unknown>).unexpected = 1;
      },
      (value: Record<string, unknown>) => {
        (value.receipt as unknown as Record<string, unknown>).unexpected = 'canary';
      },
      (value: Record<string, unknown>) => {
        ((value.receipt as unknown as Record<string, unknown>).cost as unknown as Record<string, unknown>).unexpected = 1;
      },
    ]) {
      const tampered = structuredClone(served) as unknown as Record<string, unknown>;
      mutate(tampered);
      const result = await viaClient(request, tampered);
      expect(result).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
      expect(JSON.stringify(result)).not.toContain('canary');
    }
  });

  it('P9 rejects malformed error identity but keeps valid foreign diagnostic errors', async () => {
    const request = judgeRequest({ correlationId: 'l1-p9' });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    const receipt = served.receipt as unknown as Record<string, unknown>;
    const errorPayload = { kind: 'error', ok: false,
      error: { code: 'TIMEOUT', message: 'Judge deadline exceeded.', phase: 'dispatch', retryable: true },
      receipt: { ...receipt, outcome: 'error', errorCode: 'TIMEOUT' } };
    const malformed = structuredClone(errorPayload) as unknown as Record<string, unknown>;
    ((malformed.receipt as unknown as Record<string, unknown>).servedModelId as unknown) = { invalid: true };
    expect(await viaClient(request, malformed)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    const foreign = structuredClone(errorPayload) as unknown as Record<string, unknown>;
    (foreign.receipt as unknown as Record<string, unknown>).servedEvaluator = {
      providerId: 'gcp', evaluatorId: 'foreign-evaluator', revision: 'foreign-revision' };
    expect(await viaClient(request, foreign)).toMatchObject({ kind: 'error', ok: false });
  });

  it('P11 rejects a duplicated graded outcome preserving total and expectation', async () => {
    const request = judgeRequest({ correlationId: 'l1-p11', criterion: gradedCriterion });
    const served = structuredClone(await realServiceResult(request, gradedNative())) as unknown as Record<string, unknown>;
    const verdict = served.verdict as unknown as Record<string, unknown>;
    verdict.distribution = [
      { outcome: 'low', nativeOutcome: '0', probability: 0.1 },
      { outcome: 'low', nativeOutcome: '1', probability: 0.55 },
      { outcome: 'high', nativeOutcome: '2', probability: 0.35 },
    ];
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });

  it('P12 rejects omitted/remapped graded indices but accepts reordered entries', async () => {
    const request = judgeRequest({ correlationId: 'l1-p12', criterion: gradedCriterion });
    const served = await realServiceResult(request, gradedNative());
    const omitted = structuredClone(served) as unknown as Record<string, unknown>;
    (omitted.verdict as unknown as Record<string, unknown>).distribution = [
      { outcome: 'low', nativeOutcome: '0', probability: 0.2 },
      { outcome: 'middle', nativeOutcome: '1', probability: 0.8 },
    ];
    expect(await viaClient(request, omitted)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    const remapped = structuredClone(served) as unknown as Record<string, unknown>;
    (remapped.verdict as unknown as Record<string, unknown>).distribution = [
      { outcome: 'low', nativeOutcome: '0', probability: 0.1 },
      { outcome: 'middle', nativeOutcome: '1', probability: 0.55 },
      { outcome: 'high', nativeOutcome: '5', probability: 0.35 },
    ];
    expect(await viaClient(request, remapped)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
    const reordered = structuredClone(served) as unknown as Record<string, unknown>;
    const entries = ((reordered.verdict as unknown as Record<string, unknown>).distribution as unknown[])!.slice().reverse();
    (reordered.verdict as unknown as Record<string, unknown>).distribution = entries;
    expect(await viaClient(request, reordered)).toMatchObject({ kind: 'verdict', ok: true });
  });

  it('P13 accepts a later tied choice with a matching labels decision', async () => {
    const tiedCriterion = { kind: 'choice' as const, instructions: 'Choose.',
      options: [{ id: 'B', description: 'Second' }, { id: 'A', description: 'First' }] };
    const request = judgeRequest({ correlationId: 'l1-p13', criterion: tiedCriterion,
      decision: { kind: 'labels', passing: ['A'] } });
    const served = await realServiceResult(request,
      { choice: 'A', probabilities: { A: 0.5, B: 0.5 }, confidence: 0.8 });
    const result = await viaClient(request, served);
    expect(result).toMatchObject({ kind: 'verdict', ok: true });
    if (result.ok && result.kind === 'verdict') {
      expect(result.verdict.label).toMatchObject({ value: 'A' });
      expect(result.verdict.decision).toMatchObject({ pass: true, origin: 'labels' });
    }
  });

  it('P14 rejects a provider-origin boolean against a threshold request', async () => {
    const request = judgeRequest({ correlationId: 'l1-p14',
      decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.9 } });
    const served = structuredClone(await realServiceResult(request)) as unknown as Record<string, unknown>;
    (served.verdict as unknown as Record<string, unknown>).decision = { pass: false, origin: 'provider' };
    expect(await viaClient(request, served)).toMatchObject({ kind: 'connection-failure', ok: false, receipt: null });
  });
});
