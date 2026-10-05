import { describe, expect, it } from 'vitest';
import { createJudgeError, isJudgeErrorCode, type JudgeErrorCode } from '../src/judge/errors.js';

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
