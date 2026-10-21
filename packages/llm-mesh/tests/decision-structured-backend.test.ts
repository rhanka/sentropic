import { describe, expect, it } from 'vitest';
import { decodeJevResponse } from '../src/decision/jev-response.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

const body = (answers: unknown) => ({ model: 'synthetic-served-model', answers,
  usage: { input_tokens: 100, output_tokens: 0 } });

describe('structured backend discrimination (P23)', () => {
  it.each([
    ['malformed body', 'not-a-record'],
    ['missing answers', { model: 'synthetic-served-model', usage: { input_tokens: 1, output_tokens: 0 } }],
    ['refusal body', body({ refusal: 'cannot decide' })],
    ['extra answer key', body({ verdict: { noul: 0.25 }, extra: 1 })],
    ['missing score', body({ verdict: {} })],
    ['prose number', body({ verdict: { noul: '0.7 probably' } })],
    ['clamped score', body({ verdict: { noul: 1.5 } })],
    ['default-injected score', body({ verdict: { noul: 0, defaulted: true } })],
  ])('produces no numeric verdict for %s', (_label, candidate) => {
    const result = decodeJevResponse(candidate, decisionRequest(), qualifiedDescriptor());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VERDICT_INVALID');
  });
  it('keeps a valid native binary control passing', () => {
    const result = decodeJevResponse(body({ verdict: { noul: 0.25 } }), decisionRequest(), qualifiedDescriptor());
    expect(result).toMatchObject({ ok: true });
  });
});
