import { describe, expect, it, vi } from 'vitest';
import { createRemoteDecisionClient } from '../src/decision/client.js';
import type { DecisionValidationSemantics } from '../src/decision/validation-context.js';
import { decisionRequest } from './decision-fixtures.js';
import type { DecisionRequest } from '../src/decision/request.js';

const DIGEST = 'c'.repeat(64);
const scalarSemantics = (overrides: Partial<DecisionValidationSemantics> = {}): DecisionValidationSemantics => ({
  nativeDecision: false, score: { meaning: 'support', min: 0, max: 1 },
  confidence: null, rationale: 'forbidden', ...overrides,
});
const scalarContext = (request: DecisionRequest, semantics: DecisionValidationSemantics) => ({
  evaluator: { ...request.evaluator }, validationProfile: { profile: 'scalar-label-v1', version: 'v1' },
  acceptedServedModelIds: ['synthetic-served-model'], semantics, definitionDigest: DIGEST,
});

const receiptFor = (corr: string, request: DecisionRequest) => ({
  schemaVersion: 1, callId: 'test-call-1', correlationId: corr,
  evaluator: request.evaluator, servedEvaluator: request.evaluator, servedModelId: 'synthetic-served-model',
  startedAt: '2026-10-12T00:00:00.000Z', finishedAt: '2026-10-12T00:00:01.000Z', latencyMs: 1000,
  dispatch: 'completed', attempts: 1,
  usage: { tokens: { input: { value: 100, source: 'provider' }, output: { value: 10, source: 'provider' },
    total: { value: 110, source: 'derived-sum' } }, evaluatorCalls: 1, explanations: 0 },
  cost: { status: 'estimated', amountMicroUsd: '42', source: 'reported-usage-times-rate',
    priceRevision: 'fixture-price-v1', rounding: 'ceil-micro-usd' },
  retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
  budget: { state: 'settled', overrun: false }, outcome: 'verdict',
});

const decideWith = async (request: DecisionRequest, verdict: unknown, semantics: DecisionValidationSemantics) => {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const corr = JSON.parse(String(init?.body)).correlationId;
    return new Response(JSON.stringify({ kind: 'verdict', ok: true, verdict, receipt: receiptFor(corr, request) }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const client = createRemoteDecisionClient({ baseUrl: 'https://mesh.internal',
    fetch: fetch as unknown as typeof globalThis.fetch,
    validationContext: ((snapshot: DecisionRequest) => scalarContext(snapshot, semantics)) as never });
  const result = await client.decide(request);
  return { result, fetch };
};

const scalarBinary = (score: unknown, decision: unknown = null) => ({
  criterionKind: 'binary', resolvedCriterionKind: 'binary', score, decision,
  label: null, rationale: null, confidence: null, distribution: null,
});
const scalarScore = (value: number, min: number, max: number) => ({ value, meaning: 'support',
  scale: { kind: 'bounded', min, max, direction: 'unordered' } });

describe('scalar-label-v1 profile probes (P18/P19/P20)', () => {
  it('rejects a substituted [0,100] scale with self-consistent decision (P19)', async () => {
    const { result, fetch } = await decideWith(decisionRequest({ correlationId: 'p19-scale' }),
      scalarBinary(scalarScore(50, 0, 100)), scalarSemantics());
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' }, receipt: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('accepts a declared-scale scalar without distribution (P19)', async () => {
    const { result } = await decideWith(decisionRequest({ correlationId: 'p19-ok' }),
      scalarBinary(scalarScore(0.7, 0, 1)), scalarSemantics());
    expect(result).toMatchObject({ kind: 'verdict', ok: true });
  });
  it('rejects a forged provider boolean under nativeDecision false (P18)', async () => {
    const { result } = await decideWith(decisionRequest({ correlationId: 'p18-forged' }),
      scalarBinary(scalarScore(0.7, 0, 1), { pass: true, origin: 'provider' }), scalarSemantics());
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' } });
  });
  it.each([[true], [false]])('accepts a declared native boolean %j without a rule key (P18)', async (pass) => {
    const { result } = await decideWith(decisionRequest({ correlationId: `p18-native-${pass}` }),
      scalarBinary(null, { pass, origin: 'provider' }), scalarSemantics({ nativeDecision: true, score: null }));
    expect(result).toMatchObject({ kind: 'verdict', ok: true });
  });
  it('rejects undeclared confidence and passes declared confidence (P20)', async () => {
    const withConfidence = { ...scalarBinary(scalarScore(0.7, 0, 1)),
      confidence: { value: 0.5, min: 0, max: 1, meaning: 'provider-confidence', meaningRef: 'r', origin: 'provider' } };
    const bad = await decideWith(decisionRequest({ correlationId: 'p20-bad' }), withConfidence, scalarSemantics());
    expect(bad.result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' } });
    const good = await decideWith(decisionRequest({ correlationId: 'p20-ok' }), withConfidence,
      scalarSemantics({ confidence: { meaning: 'provider-confidence', min: 0, max: 1 } }));
    expect(good.result).toMatchObject({ kind: 'verdict', ok: true });
  });
  it('accepts a label-only choice in declared options and rejects distribution (P23/P20)', async () => {
    const request = decisionRequest({ correlationId: 'p23-choice',
      criterion: { kind: 'choice', instructions: 'Pick.', options: [{ id: 'a', description: 'A' }] } });
    const verdict = { criterionKind: 'choice', resolvedCriterionKind: 'choice', score: null, decision: null,
      label: { value: 'a', origin: 'provider' }, rationale: null, confidence: null, distribution: null };
    const good = await decideWith(request, verdict, scalarSemantics({ score: null }));
    expect(good.result).toMatchObject({ kind: 'verdict', ok: true });
    const withDistribution = { ...verdict, distribution: [{ outcome: 'a', nativeOutcome: 'a', probability: 1 }] };
    const bad = await decideWith(request, withDistribution, scalarSemantics({ score: null }));
    expect(bad.result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' } });
  });
});
