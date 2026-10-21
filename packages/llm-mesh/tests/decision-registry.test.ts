import { describe, expect, it, vi } from 'vitest';
import * as mesh from '../src/index.js';
import type { ProviderAdapter } from '../src/index.js';
// Keep decision imports type-only: throwing mocks below guard root runtime isolation.
import type { DecisionAdapterResult } from '../src/decision/adapter.js';
import type { EvaluatorRef, DecisionRequest } from '../src/decision/request.js';

// A root runtime import must never evaluate the decision contracts behind its type ports.
vi.mock('../src/decision/adapter.js', () => { throw new Error('Root loaded decision adapter contracts'); });
vi.mock('../src/decision/request.js', () => { throw new Error('Root loaded decision request implementation'); });
vi.mock('../src/decision/receipt.js', () => { throw new Error('Root loaded decision receipt implementation'); });
vi.mock('../src/decision/verdict.js', () => { throw new Error('Root loaded decision verdict implementation'); });

const evaluator: EvaluatorRef = { providerId: 'typesafe', evaluatorId: 'synthetic', revision: 'fixture-v1' };
const request: DecisionRequest = { schemaVersion: 1, evaluator, inputs: { output: null },
  criterion: { kind: 'binary', instructions: 'Synthetic criterion' } };
const evidence = {
  usage: { tokens: { input: { value: 13, source: 'provider' as const },
    output: { value: null, source: 'not-reported' as const },
    total: { value: null, source: 'not-reported' as const } }, evaluatorCalls: 1, explanations: null },
  servedEvaluator: evaluator, servedModelId: 'synthetic-model-v1', providerRequestId: 'synthetic-request-id',
};
const adapter = (result: DecisionAdapterResult): ProviderAdapter => ({
  provider: mesh.getProviderProfile('typesafe'), listModels: () => [], listEvaluators: () => [evaluator],
  decision: vi.fn(async () => result),
  generate: vi.fn(async () => { throw new Error('Synthetic decision-only adapter'); }),
  stream: vi.fn(async () => { throw new Error('Synthetic decision-only adapter'); }),
  validateAuth: () => ({ ok: true }),
  normalizeError: () => ({ providerId: 'typesafe', message: 'Synthetic error', retryable: false }),
});

describe('optional decision registry ports', () => {
  it('loads root without decision implementations and preserves eight unchanged default chat adapters', () => {
    const adapters = mesh.createDefaultProviderAdapters();
    const registry = mesh.createProviderRegistry(adapters);
    expect(adapters).toHaveLength(8);
    for (const candidate of adapters) {
      expect(candidate.decision).toBeUndefined();
      expect(candidate.listEvaluators).toBeUndefined();
    }
    expect(registry.getProvider('typesafe')).toBeNull();
    expect(() => registry.requireProvider('typesafe')).toThrow('Provider not found');
  });

  it('registers a decision only through explicit composition and retains negative verdict and independent usage', async () => {
    const result: DecisionAdapterResult = { ...evidence, ok: true, verdict: {
      criterionKind: 'binary', resolvedCriterionKind: 'binary', score: null,
      decision: { pass: false, origin: 'provider' }, label: null, rationale: null,
      confidence: null, distribution: null,
    } };
    const candidate = adapter(result);
    const registry = mesh.createProviderRegistry([candidate]);
    const selected = registry.requireProvider('typesafe');
    expect(selected.listEvaluators?.()).toEqual([evaluator]);
    expect(registry.listModels()).toEqual([]);
    const context = { signal: new AbortController().signal };
    expect(await selected.decision?.(request, context)).toStrictEqual(result);
    expect(candidate.decision).toHaveBeenCalledWith(request, context);
    expect(candidate.generate).not.toHaveBeenCalled();
    expect(candidate.stream).not.toHaveBeenCalled();
  });

  it('preserves usage and observed identity independently of a refused verdict', async () => {
    const result: DecisionAdapterResult = { ...evidence, servedEvaluator: null, ok: false,
      error: { code: 'VERDICT_INVALID', phase: 'parse', message: 'Synthetic refusal', retryable: false } };
    const registry = mesh.createProviderRegistry([adapter(result)]);
    expect(await registry.requireProvider('typesafe').decision?.(request)).toStrictEqual(result);
  });
});
