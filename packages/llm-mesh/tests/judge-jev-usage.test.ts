import { describe, expect, it } from 'vitest';
import { decodeJevResponse } from '../src/judge/jev-response.js';
import { encodeJevRequest } from '../src/judge/jev-codec.js';
import { judgeRequest, qualifiedDescriptor, jevResponse } from './judge-fixtures.js';

describe('JEV served identity and independent usage', () => {
  it('accepts only the exact qualified served ID and derives a safe total', () => {
    const result = decodeJevResponse(jevResponse(), judgeRequest(), qualifiedDescriptor(), 'fixture-request:1');
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ servedEvaluator: qualifiedDescriptor().evaluator, providerRequestId: 'fixture-request:1',
      usage: { tokens: { input: { value: 1000, source: 'provider' }, output: { value: 0, source: 'provider' },
        total: { value: 1000, source: 'derived-sum' } }, evaluatorCalls: 1, explanations: 0 } });
  });
  it.each(['synthetic-served-model-extra', 'jev-latest', 'other-version'])('preserves counters on identity mismatch (%s)', (model) => {
    const result = decodeJevResponse({ ...jevResponse(), model }, judgeRequest(), qualifiedDescriptor());
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVED_IDENTITY_MISMATCH', phase: 'parse' },
      servedEvaluator: null, servedModelId: model, usage: { tokens: { input: { value: 1000 } } } });
  });
  it.each([{ input_tokens: -1, output_tokens: 3 }, { output_tokens: 3 },
    { input_tokens: true, output_tokens: 3 }, { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 3 }])(
    'refuses usage while retaining independently valid output: %j', (usage) => {
      const result = decodeJevResponse({ ...jevResponse(), usage }, judgeRequest(), qualifiedDescriptor());
      expect(result).toMatchObject({ ok: false, error: { code: 'USAGE_INVALID' }, usage: { tokens: { output: { value: 3 } } } });
    });
  it.each([{ extra: { noul: 1 } }, {}, { verdict: { noul: 0.5 }, extra: {} }])('refuses missing/extra answer keys with valid usage', (answers) => {
    expect(decodeJevResponse({ ...jevResponse(), answers }, judgeRequest(), qualifiedDescriptor()))
      .toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' }, usage: { tokens: { input: { value: 1000 } } } });
  });
  it('separates unknown request revision from observed identity and strips unsafe IDs', () => {
    const request = judgeRequest({ evaluator: { ...qualifiedDescriptor().evaluator, revision: 'other' } });
    expect(encodeJevRequest(request, qualifiedDescriptor())).toEqual({ ok: false, code: 'REVISION_MISMATCH' });
    const result = decodeJevResponse({ ...jevResponse(), model: 'unsafe\nidentity' }, judgeRequest(), qualifiedDescriptor(), 'x'.repeat(129));
    expect(result.servedModelId).toBeNull();
    expect(result.providerRequestId).toBeUndefined();
  });
});
