import { describe, expect, it } from 'vitest';
import { isRetryableProviderError, normalizeProviderError, readRequestSizeDetail,
  RequestTooLargeError, requestTooLargeDetail } from '../src/errors.js';
import { NativeMessagesUpstreamError } from '../src/native-messages.js';

describe('numeric request-too-large evidence', () => {
  const requestSize = { requestBytes: 32_000_001, limitBytes: 32_000_000, source: 'gateway' as const };
  it.each([
    new RequestTooLargeError(requestSize),
    new NativeMessagesUpstreamError({ status: 413, requestSize }),
    { status: 413, code: 'overloaded_auth_rate', requestSize, retryAfterMs: 1000, message: 'PRIVATE' },
    { code: 'request_too_large', metadata: { requestSize } },
    { status: 429, code: 'rate', cause: new RequestTooLargeError(requestSize) },
    { response: { status: 413, requestSize } },
  ])('preserves numeric evidence and terminal status across normalization: %j', error => {
    const normalized = normalizeProviderError('anthropic', error, { retryableStatusCodes: [413] });
    expect(normalized).toMatchObject({ statusCode: 413, code: 'request_too_large',
      message: 'Request body is too large', requestSize, retryable: false });
    expect(normalized.retryAfterMs).toBeUndefined(); expect(normalized.retryReason).toBeUndefined();
    expect(normalizeProviderError('anthropic', { cause: normalized })).toMatchObject({
      statusCode: 413, code: 'request_too_large', requestSize, retryable: false });
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe measurement %s', requestBytes => {
    expect(readRequestSizeDetail({ ...requestSize, requestBytes })).toBeUndefined();
    expect(() => new RequestTooLargeError({ ...requestSize, requestBytes })).toThrow('Invalid request size measurement');
  });
  it('freezes closed evidence, detects status/type-only 413s and bounds cyclic causes', () => {
    const error = new RequestTooLargeError({ ...requestSize, sizeIsLowerBound: true });
    expect(Object.isFrozen(error.requestSize)).toBe(true);
    expect(requestTooLargeDetail({ type: 'request_too_large', message: 'size 99 limit 1' })).toEqual({});
    const cycle: { cause?: unknown; status: number } = { status: 413 }; cycle.cause = cycle;
    expect(requestTooLargeDetail(cycle)).toEqual({});
    expect(isRetryableProviderError(413, 'rate_auth_overloaded', { retryableStatusCodes: [413] })).toBe(false);
  });
});
