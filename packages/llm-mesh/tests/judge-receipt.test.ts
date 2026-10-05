import { describe, expect, it } from 'vitest';
import { createJudgeError, isJudgeErrorCode, type JudgeErrorCode } from '../src/judge/errors.js';
import { normalizeJudgeUsage, parseJudgeUsage, resolveJudgeCorrelationId, unreportedJudgeUsage } from '../src/judge/receipt.js';

describe('sanitized judge errors', () => {
  it('should expose a bounded static code/message rather than arbitrary exception content', () => {
    const error = createJudgeError('CREDENTIAL_MISSING', 'preflight');
    expect(error).toEqual({ code: 'CREDENTIAL_MISSING', message: 'Judge credential is missing.', phase: 'preflight', retryable: false });
    expect(createJudgeError('dummy-secret-canary' as JudgeErrorCode, 'parse').message).toBe('Invalid judge request.');
    expect(isJudgeErrorCode('constructor')).toBe(false);
    expect(isJudgeErrorCode('SERVED_IDENTITY_MISMATCH')).toBe(true);
  });
  it('should retain only valid advisory retry hints', () => {
    expect(createJudgeError('RATE_LIMITED', 'dispatch', { retryAfterMs: 42 }).retryAfterMs).toBe(42);
    for (const retryAfterMs of [-1, NaN, Infinity, 1.5]) {
      expect(createJudgeError('RATE_LIMITED', 'dispatch', { retryAfterMs }).retryAfterMs).toBeUndefined();
    }
    expect(createJudgeError('VERDICT_INVALID', 'parse', { retryAfterMs: 42 }).retryAfterMs).toBeUndefined();
  });
});

describe('per-counter judge usage provenance', () => {
  it('should distinguish reported zero from absent input and preserve independent total provenance', () => {
    const usage = normalizeJudgeUsage({ outputTokens: 0, totalTokens: 7, evaluatorCalls: 1, explanations: 0 });
    expect(usage?.tokens).toEqual({ input: { value: null, source: 'not-reported' },
      output: { value: 0, source: 'provider' }, total: { value: 7, source: 'provider' } });
    expect(normalizeJudgeUsage({ inputTokens: 2, evaluatorCalls: null, explanations: null })?.tokens.total)
      .toEqual({ value: null, source: 'not-reported' });
  });
  it('should derive total only when both native counters and their sum are safe integers', () => {
    expect(normalizeJudgeUsage({ inputTokens: 2, outputTokens: 3, evaluatorCalls: 1, explanations: 0 })?.tokens.total)
      .toEqual({ value: 5, source: 'derived-sum' });
    expect(normalizeJudgeUsage({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, evaluatorCalls: 1, explanations: 0 })).toBeNull();
    for (const inputTokens of [-1, 0.5, NaN, Infinity]) {
      expect(normalizeJudgeUsage({ inputTokens, evaluatorCalls: 1, explanations: 0 })).toBeNull();
    }
  });
  it('should refuse forged provenance, malformed counts and contradictory derived sums', () => {
    const usage = normalizeJudgeUsage({ inputTokens: 2, outputTokens: 3, evaluatorCalls: 1, explanations: 0 })!;
    expect(parseJudgeUsage({ ...usage, tokens: { ...usage.tokens, input: { value: 2, source: 'derived-sum' } } })).toBeNull();
    expect(parseJudgeUsage({ ...usage, tokens: { ...usage.tokens, total: { value: 6, source: 'derived-sum' } } })).toBeNull();
    expect(parseJudgeUsage({ ...usage, tokens: { ...usage.tokens, input: { value: null, source: 'provider' } } })).toBeNull();
    expect(parseJudgeUsage({ ...usage, evaluatorCalls: -1 })).toBeNull();
  });
});

describe('receipt usage and correlation boundaries', () => {
  it('should distinguish unknown execution from proven zero calls without inventing tokens', () => {
    const unknown = unreportedJudgeUsage('unknown');
    expect(unknown.tokens).toEqual({ input: { value: null, source: 'not-reported' },
      output: { value: null, source: 'not-reported' }, total: { value: null, source: 'not-reported' } });
    expect(unknown.evaluatorCalls).toBeNull();
    const refusal = unreportedJudgeUsage('not-dispatched');
    expect(refusal.evaluatorCalls).toBe(0);
    expect(refusal.explanations).toBe(0);
    expect(refusal.tokens.input.value).toBeNull();
  });
  it('should echo valid correlations and generate IDs only when omitted', () => {
    const generate = () => { throw new Error('must not run for a supplied ID'); };
    expect(resolveJudgeCorrelationId('consumer:one', generate)).toBe('consumer:one');
    expect(resolveJudgeCorrelationId('invalid\nidentifier', generate)).toBeNull();
    expect(resolveJudgeCorrelationId(undefined, () => 'synthetic:id')).toBe('synthetic:id');
    expect(resolveJudgeCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
