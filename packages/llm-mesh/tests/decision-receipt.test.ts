import { describe, expect, it } from 'vitest';
import { createDecisionError, isDecisionErrorCode, type DecisionErrorCode } from '../src/decision/errors.js';
import { normalizeDecisionUsage, parseDecisionUsage, resolveDecisionCorrelationId, unreportedDecisionUsage } from '../src/decision/receipt.js';

const phases = ['preflight', 'admission', 'dispatch', 'parse', 'settlement'] as const;
const retryability: readonly [DecisionErrorCode, readonly boolean[]][] = [
  ['REQUEST_INVALID', [false, false, false, false, false]],
  ['PROVIDER_UNKNOWN', [false, false, false, false, false]],
  ['EVALUATOR_UNKNOWN', [false, false, false, false, false]],
  ['CAPABILITY_UNSUPPORTED', [false, false, false, false, false]],
  ['PROVIDER_UNAVAILABLE', [true, true, true, true, false]],
  ['REVISION_MISMATCH', [false, false, false, false, false]],
  ['CREDENTIAL_MISSING', [false, false, false, false, false]],
  ['AUTHENTICATION_FAILED', [false, false, false, false, false]],
  ['AUTHORIZATION_DENIED', [false, false, false, false, false]],
  ['PRICING_UNAVAILABLE', [false, false, false, false, false]],
  ['BUDGET_BOUND_UNAVAILABLE', [false, false, false, false, false]],
  ['BUDGET_EXHAUSTED', [false, false, false, false, false]],
  ['BUDGET_UNAVAILABLE', [true, true, false, false, false]],
  ['SETTLEMENT_UNAVAILABLE', [true, true, false, false, false]],
  ['RATE_LIMITED', [true, true, true, true, false]],
  ['PROVIDER_OVERLOADED', [true, true, true, true, false]],
  ['PROVIDER_REJECTED', [false, false, false, false, false]],
  ['TIMEOUT', [true, true, true, true, false]],
  ['CANCELLED', [false, false, false, false, false]],
  ['TRANSPORT_FAILED', [true, true, true, true, false]],
  ['VERDICT_INVALID', [false, false, false, false, false]],
  ['SERVED_IDENTITY_MISMATCH', [false, false, false, false, false]],
  ['USAGE_INVALID', [false, false, false, false, false]],
  ['RESPONSE_TOO_LARGE', [false, false, false, false, false]],
  ['RECEIPT_UNAVAILABLE', [true, true, false, false, false]],
  ['MESH_UNAVAILABLE', [true, true, true, true, false]],
];

describe('sanitized decision errors', () => {
  it.each(retryability.flatMap(([code, expected]) => phases.map((phase, index) =>
    ({ code, phase, retryable: expected[index] }))))('should report retryable=$retryable for $code in $phase',
  ({ code, phase, retryable }) => {
    const error = createDecisionError(code, phase, { retryAfterMs: 60_000 });
    expect(error).toMatchObject({ code, phase, retryable });
    expect(error.retryAfterMs).toBe(retryable ? 60_000 : undefined);
  });
  it('should expose a bounded static code/message rather than arbitrary exception content', () => {
    const error = createDecisionError('CREDENTIAL_MISSING', 'preflight');
    expect(error).toEqual({ code: 'CREDENTIAL_MISSING', message: 'Decision credential is missing.', phase: 'preflight', retryable: false });
    expect(createDecisionError('dummy-secret-canary' as DecisionErrorCode, 'parse').message).toBe('Invalid decision request.');
    expect(isDecisionErrorCode('constructor')).toBe(false);
    expect(isDecisionErrorCode('SERVED_IDENTITY_MISMATCH')).toBe(true);
    const invalidPhase = createDecisionError('SETTLEMENT_UNAVAILABLE', 'invalid' as 'preflight', { retryAfterMs: 42 });
    expect(invalidPhase).toMatchObject({ phase: 'preflight', retryable: false });
    expect(invalidPhase.retryAfterMs).toBeUndefined();
  });
  it('should retain only valid advisory retry hints', () => {
    expect(createDecisionError('RATE_LIMITED', 'dispatch', { retryAfterMs: 42 }).retryAfterMs).toBe(42);
    expect(createDecisionError('RATE_LIMITED', 'dispatch', { retryAfterMs: 60_000 }).retryAfterMs).toBe(60_000);
    for (const retryAfterMs of [-1, NaN, Infinity, 1.5, 60_001]) {
      expect(createDecisionError('RATE_LIMITED', 'dispatch', { retryAfterMs }).retryAfterMs).toBeUndefined();
    }
    expect(createDecisionError('VERDICT_INVALID', 'parse', { retryAfterMs: 42 }).retryAfterMs).toBeUndefined();
  });
});

describe('per-counter decision usage provenance', () => {
  it('should settle from the validated usage snapshot despite later live counter drift', () => {
    const usage = normalizeDecisionUsage({ inputTokens: 2, outputTokens: 3, evaluatorCalls: 1, explanations: 0 })!;
    let reads = 0;
    const candidate = new Proxy(usage, {
      get(target, key, receiver) {
        if (key === 'evaluatorCalls' && ++reads > 1) return -1;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(parseDecisionUsage(candidate)).toEqual(usage);
  });
  it('should distinguish reported zero from absent input and preserve independent total provenance', () => {
    const usage = normalizeDecisionUsage({ outputTokens: 0, totalTokens: 7, evaluatorCalls: 1, explanations: 0 });
    expect(usage?.tokens).toEqual({ input: { value: null, source: 'not-reported' },
      output: { value: 0, source: 'provider' }, total: { value: 7, source: 'provider' } });
    expect(normalizeDecisionUsage({ inputTokens: 2, evaluatorCalls: null, explanations: null })?.tokens.total)
      .toEqual({ value: null, source: 'not-reported' });
  });
  it('should derive total only when both native counters and their sum are safe integers', () => {
    expect(normalizeDecisionUsage({ inputTokens: 2, outputTokens: 3, evaluatorCalls: 1, explanations: 0 })?.tokens.total)
      .toEqual({ value: 5, source: 'derived-sum' });
    expect(normalizeDecisionUsage({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, evaluatorCalls: 1, explanations: 0 })).toBeNull();
    for (const inputTokens of [-1, 0.5, NaN, Infinity]) {
      expect(normalizeDecisionUsage({ inputTokens, evaluatorCalls: 1, explanations: 0 })).toBeNull();
    }
  });
  it('should refuse forged provenance, malformed counts and contradictory derived sums', () => {
    const usage = normalizeDecisionUsage({ inputTokens: 2, outputTokens: 3, evaluatorCalls: 1, explanations: 0 })!;
    expect(parseDecisionUsage({ ...usage, tokens: { ...usage.tokens, input: { value: 2, source: 'derived-sum' } } })).toBeNull();
    expect(parseDecisionUsage({ ...usage, tokens: { ...usage.tokens, total: { value: 6, source: 'derived-sum' } } })).toBeNull();
    expect(parseDecisionUsage({ ...usage, tokens: { ...usage.tokens, input: { value: null, source: 'provider' } } })).toBeNull();
    expect(parseDecisionUsage({ ...usage, evaluatorCalls: -1 })).toBeNull();
    const { evaluatorCalls: _calls, ...missingCalls } = usage;
    expect(parseDecisionUsage(missingCalls)).toBeNull();
  });
});

describe('receipt usage and correlation boundaries', () => {
  it('should distinguish unknown execution from proven zero calls without inventing tokens', () => {
    const unknown = unreportedDecisionUsage('unknown');
    expect(unknown.tokens).toEqual({ input: { value: null, source: 'not-reported' },
      output: { value: null, source: 'not-reported' }, total: { value: null, source: 'not-reported' } });
    expect(unknown.evaluatorCalls).toBeNull();
    const refusal = unreportedDecisionUsage('not-dispatched');
    expect(refusal.evaluatorCalls).toBe(0);
    expect(refusal.explanations).toBe(0);
    expect(refusal.tokens.input.value).toBeNull();
  });
  it('should echo valid correlations and generate IDs only when omitted', () => {
    const generate = () => { throw new Error('must not run for a supplied ID'); };
    expect(resolveDecisionCorrelationId('consumer:one', generate)).toBe('consumer:one');
    expect(resolveDecisionCorrelationId('invalid\nidentifier', generate)).toBeNull();
    expect(resolveDecisionCorrelationId(undefined, () => 'synthetic:id')).toBe('synthetic:id');
    expect(resolveDecisionCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
