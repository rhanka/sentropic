import { describe, expect, it, vi } from 'vitest';
import * as mesh from '../src/index.js';
import type { ProviderAdapter } from '../src/index.js';
// Keep judge imports type-only: throwing mocks below guard root runtime isolation.
import type { JudgeAdapterResult } from '../src/judge/adapter.js';
import type { EvaluatorRef, JudgeRequest } from '../src/judge/request.js';

// A root runtime import must never evaluate the judge contracts behind its type ports.
vi.mock('../src/judge/adapter.js', () => { throw new Error('Root loaded judge adapter contracts'); });
vi.mock('../src/judge/request.js', () => { throw new Error('Root loaded judge request implementation'); });
vi.mock('../src/judge/receipt.js', () => { throw new Error('Root loaded judge receipt implementation'); });
vi.mock('../src/judge/verdict.js', () => { throw new Error('Root loaded judge verdict implementation'); });

const evaluator: EvaluatorRef = { providerId: 'typesafe', evaluatorId: 'synthetic', revision: 'fixture-v1' };
const request: JudgeRequest = { schemaVersion: 1, evaluator, inputs: { output: null },
  criterion: { kind: 'binary', instructions: 'Synthetic criterion' } };
const evidence = {
  usage: { tokens: { input: { value: 13, source: 'provider' as const },
    output: { value: null, source: 'not-reported' as const },
    total: { value: null, source: 'not-reported' as const } }, evaluatorCalls: 1, explanations: null },
  servedEvaluator: evaluator, servedModelId: 'synthetic-model-v1', providerRequestId: 'synthetic-request-id',
};
const adapter = (result: JudgeAdapterResult): ProviderAdapter => ({
  provider: mesh.getProviderProfile('typesafe'), listModels: () => [], listEvaluators: () => [evaluator],
  judge: vi.fn(async () => result),
  generate: vi.fn(async () => { throw new Error('Synthetic judge-only adapter'); }),
  stream: vi.fn(async () => { throw new Error('Synthetic judge-only adapter'); }),
  validateAuth: () => ({ ok: true }),
  normalizeError: () => ({ providerId: 'typesafe', message: 'Synthetic error', retryable: false }),
});

describe('optional judge registry ports', () => {
  it('loads root without judge implementations and preserves eight unchanged default chat adapters', () => {
    const adapters = mesh.createDefaultProviderAdapters();
    const registry = mesh.createProviderRegistry(adapters);
    expect(adapters).toHaveLength(8);
    for (const candidate of adapters) {
      expect(candidate.judge).toBeUndefined();
      expect(candidate.listEvaluators).toBeUndefined();
    }
    expect(registry.getProvider('typesafe')).toBeNull();
    expect(() => registry.requireProvider('typesafe')).toThrow('Provider not found');
  });

  it('registers a judge only through explicit composition and retains negative verdict and independent usage', async () => {
    const result: JudgeAdapterResult = { ...evidence, ok: true, verdict: {
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
    expect(await selected.judge?.(request, context)).toStrictEqual(result);
    expect(candidate.judge).toHaveBeenCalledWith(request, context);
    expect(candidate.generate).not.toHaveBeenCalled();
    expect(candidate.stream).not.toHaveBeenCalled();
  });

  it('preserves usage and observed identity independently of a refused verdict', async () => {
    const result: JudgeAdapterResult = { ...evidence, servedEvaluator: null, ok: false,
      error: { code: 'VERDICT_INVALID', phase: 'parse', message: 'Synthetic refusal', retryable: false } };
    const registry = mesh.createProviderRegistry([adapter(result)]);
    expect(await registry.requireProvider('typesafe').judge?.(request)).toStrictEqual(result);
  });
});
