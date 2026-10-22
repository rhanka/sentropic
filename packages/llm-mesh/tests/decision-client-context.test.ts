import { describe, expect, it, vi } from 'vitest';
import { createRemoteDecisionClient } from '../src/decision/client.js';
import type { DecisionValidationContext } from '../src/decision/validation-context.js';
import { decisionRequest } from './decision-fixtures.js';
import type { DecisionRequest } from '../src/decision/request.js';

const DIGEST = 'b'.repeat(64);
const contextFor = (request: DecisionRequest, overrides: Record<string, unknown> = {}): DecisionValidationContext => ({
  evaluator: { ...request.evaluator },
  validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
  acceptedServedModelIds: ['synthetic-served-model'],
  semantics: { nativeDecision: false,
    score: { meaning: 'probability-true', min: 0, max: 1 },
    confidence: { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
    rationale: 'forbidden' },
  definitionDigest: DIGEST,
  ...overrides,
} as DecisionValidationContext);

const verdictBody = (corr: string, verdict: unknown, servedModelId = 'synthetic-served-model') => ({
  kind: 'verdict', ok: true, verdict,
  receipt: { schemaVersion: 1, callId: 'test-call-1', correlationId: corr,
    evaluator: decisionRequest().evaluator, servedEvaluator: decisionRequest().evaluator, servedModelId,
    startedAt: '2026-10-12T00:00:00.000Z', finishedAt: '2026-10-12T00:00:01.000Z', latencyMs: 1000,
    dispatch: 'completed', attempts: 1,
    usage: { tokens: { input: { value: 100, source: 'provider' }, output: { value: 10, source: 'provider' },
      total: { value: 110, source: 'derived-sum' } }, evaluatorCalls: 1, explanations: 0 },
    cost: { status: 'estimated', amountMicroUsd: '42', source: 'reported-usage-times-rate',
      priceRevision: 'fixture-price-v1', rounding: 'ceil-micro-usd' },
    retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
    budget: { state: 'settled', overrun: false }, outcome: 'verdict' },
});

const binaryVerdict = (criterionKind = 'binary') => ({
  criterionKind, resolvedCriterionKind: 'binary',
  score: { value: 0.25, meaning: 'probability-true', scale: { kind: 'bounded', min: 0, max: 1, direction: 'unordered' } },
  decision: null, label: null, rationale: null, confidence: null, distribution: null,
});

const clientWith = (fetch: ReturnType<typeof vi.fn>, resolver: (snapshot: DecisionRequest) => unknown,
  extra: Record<string, unknown> = {}) => createRemoteDecisionClient({ baseUrl: 'https://mesh.internal',
  fetch: fetch as unknown as typeof globalThis.fetch, validationContext: resolver as never, ...extra });

const failAfterHang = <T>(decided: Promise<T>): Promise<T> => Promise.race([decided,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('decide() hung')), 2000))]);

describe('canonical decision client trusted context (P15/P16/P21)', () => {
  it('refuses client-local on missing context with zero fetches', async () => {
    const fetch = vi.fn();
    const client = clientWith(fetch, () => null);
    const result = await failAfterHang(client.decide(decisionRequest({ correlationId: 'p15-missing' })));
    expect(result).toMatchObject({ kind: 'connection-failure', ok: false,
      error: { code: 'MESH_UNAVAILABLE' }, receipt: null, callStatus: 'not-sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses client-local on wrong-evaluator context with zero fetches', async () => {
    const fetch = vi.fn();
    const request = decisionRequest({ correlationId: 'p15-evaluator' });
    const client = clientWith(fetch, () => contextFor(request,
      { evaluator: { ...request.evaluator, revision: 'other-revision' } }));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' },
      receipt: null, callStatus: 'not-sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses client-local on registered request without resolution', async () => {
    const fetch = vi.fn();
    const request = decisionRequest({ correlationId: 'p15-unresolved',
      criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
    const client = clientWith(fetch, (snapshot) => contextFor(snapshot));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' }, receipt: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['stale', new Date(Date.now() - 120_000).toISOString(), 60_000],
    ['future', new Date(Date.now() + 60_000).toISOString(), 60_000],
  ])('refuses client-local on %s resolution', async (_label, resolvedAt, maxAgeMs) => {
    const fetch = vi.fn();
    const request = decisionRequest({ correlationId: 'p15-resolution',
      criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
    const client = clientWith(fetch, (snapshot) => contextFor(snapshot, { registeredResolution: { criteriaId: 'c1',
      revision: 'r1', resolvedKind: 'binary', criterion: { kind: 'binary', instructions: 'Check.' },
      resolvedAt, maxAgeMs } }));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' }, receipt: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts a fresh trusted registered resolution and validates the verdict', async () => {
    const request = decisionRequest({ correlationId: 'p15-registered-ok',
      criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corr = JSON.parse(String(init?.body)).correlationId;
      return new Response(JSON.stringify(verdictBody(corr, binaryVerdict('registered'))),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = clientWith(fetch, (snapshot) => contextFor(snapshot, { registeredResolution: { criteriaId: 'c1',
      revision: 'r1', resolvedKind: 'binary', criterion: { kind: 'binary', instructions: 'Check.' },
      resolvedAt: new Date(Date.now() - 1_000).toISOString(), maxAgeMs: 60_000 } }));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'verdict', ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('binds two concurrent registered criteria independently', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(verdictBody(body.correlationId, binaryVerdict('registered'))),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const resolve = (snapshot: DecisionRequest) => {
      const registered = snapshot.criterion.kind === 'registered' ? snapshot.criterion : null;
      if (!registered) return null;
      return contextFor(snapshot, { registeredResolution: { criteriaId: registered.criteriaId,
        revision: registered.revision, resolvedKind: 'binary',
        criterion: { kind: 'binary', instructions: `Check ${registered.criteriaId}.` },
        resolvedAt: new Date(Date.now() - 1_000).toISOString(), maxAgeMs: 60_000 } });
    };
    const client = clientWith(fetch, resolve);
    const first = decisionRequest({ correlationId: 'p15-conc-1',
      criterion: { kind: 'registered', criteriaId: 'c1', revision: 'r1' } });
    const second = decisionRequest({ correlationId: 'p15-conc-2',
      criterion: { kind: 'registered', criteriaId: 'c2', revision: 'r1' } });
    const [r1, r2] = await Promise.all([failAfterHang(client.decide(first)), failAfterHang(client.decide(second))]);
    expect(r1).toMatchObject({ kind: 'verdict', ok: true });
    expect(r2).toMatchObject({ kind: 'verdict', ok: true });
  });
  it('rejects a foreign served model after dispatch (P16)', async () => {
    const request = decisionRequest({ correlationId: 'p16-foreign' });
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corr = JSON.parse(String(init?.body)).correlationId;
      return new Response(JSON.stringify(verdictBody(corr, binaryVerdict(), 'foreign-model')),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = clientWith(fetch, (snapshot) => contextFor(snapshot));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' },
      receipt: null, callStatus: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a response-selected weaker profile after dispatch (P15)', async () => {
    const request = decisionRequest({ correlationId: 'p15-downgrade' });
    const scalar = { criterionKind: 'binary', resolvedCriterionKind: 'binary',
      score: { value: 50, meaning: 'provider-defined',
        scale: { kind: 'bounded', min: 0, max: 100, direction: 'unordered' } },
      decision: null, label: null, rationale: null, confidence: null, distribution: null };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corr = JSON.parse(String(init?.body)).correlationId;
      return new Response(JSON.stringify(verdictBody(corr, scalar)),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = clientWith(fetch, (snapshot) => contextFor(snapshot));
    const result = await failAfterHang(client.decide(request));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'MESH_UNAVAILABLE' },
      receipt: null, callStatus: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('hands the resolver a frozen transmitted snapshot (P21)', async () => {
    const seen: unknown[] = [];
    const request = decisionRequest({ correlationId: 'p21-frozen' });
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corr = JSON.parse(String(init?.body)).correlationId;
      return new Response(JSON.stringify(verdictBody(corr, binaryVerdict())),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = clientWith(fetch, (snapshot) => { seen.push(snapshot); return contextFor(snapshot); });
    await failAfterHang(client.decide(request));
    expect(seen).toHaveLength(1);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });
  it('bounds a never-resolving resolver by the call deadline (P21)', async () => {
    const fetch = vi.fn();
    const client = clientWith(fetch, () => new Promise<never>(() => {}), { timeoutMs: 50 });
    const result = await failAfterHang(client.decide(decisionRequest({ correlationId: 'p21-timeout' })));
    expect(result).toMatchObject({ kind: 'connection-failure', error: { code: 'TIMEOUT' }, receipt: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});
