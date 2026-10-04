import { describe, expect, it } from 'vitest';
import { NativeMessagesUpstreamError, normalizeProviderError, RequestTooLargeError, type RequestSizeDetail } from '@sentropic/llm-mesh';
import { toProviderShapedError } from '../src/router/errors.js';
import { classifyRouteError } from '../src/route-flow-core.js';
import { WIRES } from './fixtures/budget.js';

describe.each(WIRES)('numeric 413 public contract on $wire', ({ wire }) => {
  it.each([
    [{ requestBytes: 32000001, limitBytes: 32000000, source: 'gateway' }, 'Request size 32000001 bytes exceeds limit 32000000 bytes.'],
    [{ requestBytes: 32000002, limitBytes: 32000000, source: 'gateway', sizeIsLowerBound: true }, 'Request size is at least 32000002 bytes and exceeds limit 32000000 bytes.'],
    [{ requestBytes: 127, source: 'upstream' }, 'Request size 127 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 127, limitBytes: 32000000, source: 'upstream' }, 'Request size 127 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 32000000, limitBytes: 32000000, source: 'upstream' }, 'Request size 32000000 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 0, source: 'upstream' }, 'Request size 0 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 127, source: 'upstream', sizeIsLowerBound: true }, 'Request size is at least 127 bytes and was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
  ] as const)('uses only measured numeric evidence: %j', (requestSize, message) => {
    const error = new NativeMessagesUpstreamError({ status: 413, type: 'request_too_large', requestSize });
    for (const wrapped of [error, normalizeProviderError('anthropic', error), { cause: error }]) {
      const mapped = toProviderShapedError(wire, wrapped);
      expect(mapped.status).toBe(413);
      expect(mapped.headers).toEqual({ 'x-should-retry': 'false' });
      expect(mapped.body).toEqual(wire === 'anthropic-messages'
        ? { type: 'error', error: { type: 'request_too_large', message } }
        : { error: { type: 'invalid_request_error', code: 'request_too_large', message } });
    }
  });
  const size: RequestSizeDetail = { requestBytes: 7, source: 'upstream' };
  it.each([
    { status: 413, code: 'auth_rate_overloaded', retryAfterMs: 10000, requestSize: size },
    { statusCode: 413, requestSize: size }, { code: 'request_too_large', requestSize: size },
    { type: 'request_too_large', requestSize: size },
    { status: 503, cause: new RequestTooLargeError(size) },
  ])('classifies before auth/rate/overload and preserves status: %j', error => {
    expect(classifyRouteError(error)).toEqual({ reason: 'invalid-request', retryable: false, healthScope: 'route' });
    expect(classifyRouteError(error, true)).toEqual({ reason: 'cancelled', retryable: false, healthScope: 'route' });
    expect(toProviderShapedError(wire, error).status).toBe(413);
  });
  it('does not invent numbers from provider prose or malformed metadata', () => {
    const mapped = toProviderShapedError(wire, { status: 413, message: 'SECRET size 999999 limit 1',
      requestSize: { requestBytes: 10.5, limitBytes: 1, source: 'upstream' } });
    expect(mapped.status).toBe(413);
    expect(JSON.stringify(mapped.body)).not.toMatch(/SECRET|999999|exceeds/);
    expect(JSON.stringify(mapped.body)).toContain('Request size is unavailable');
  });
});
