import { describe, expect, it } from 'vitest';
import { nativeHttpFixture } from './fixtures/anthropic-native-http.js';
import { nativeHarness, nativeFrame, nativeStart, sendNative } from './fixtures/native-flow.js';
import { nativeLateErrorBytes } from '../src/native-stream-errors.js';

describe('measured HTTP and native SSE 413', () => {
  it.each([false, true])('uses real outbound UTF-8 size for upstream HTTP refusal (stream=%s)', async stream => {
    for (const rejectingLimit of [undefined, 64, 32000000]) {
      const upstream = await nativeHttpFixture({ status: 413, rejectingLimit,
        json: { type: 'error', error: { type: 'request_too_large', message: 'SECRET auth rate size 999999 limit 1' } },
        headers: { 'retry-after': '10' } });
      try {
        const h = nativeHarness({ execute: upstream.execute, body: { future: '雪☃' } });
        const response = await sendNative(h, stream);
        const captured = upstream.requests[0]!;
        const size = captured.bytes.byteLength;
        expect(size).toBeGreaterThan(JSON.stringify(captured.body).length);
        expect(response.status).toBe(413);
        expect((await response.json()).error).toEqual({ type: 'request_too_large', message: rejectingLimit === 64
          ? `Request size ${size} bytes exceeds limit 64 bytes.`
          : `Request size ${size} bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.` });
        expect(response.headers.get('x-should-retry')).toBe('false');
        for (const name of ['retry-after', 'x-sentropic-relay', 'anthropic-organization-id']) expect(response.headers.has(name)).toBe(false);
        expect(upstream.requests).toHaveLength(1); expect(h.recorder.settlements).toHaveLength(1);
      } finally { await upstream.close(); }
    }
  });
  it.each([false, true])('retains numeric request_too_large in an SSE frame (committed=%s)', async committed => {
    const frames = [...(committed ? [nativeStart('claude-sonnet-5')] : []), nativeFrame('error', {
      error: { type: 'request_too_large', message: 'SECRET size 999999 limit 1' }, requestSize: { requestBytes: 999999 } })];
    const upstream = await nativeHttpFixture({ frames, rejectingLimit: 64 });
    try {
      const h = nativeHarness({ execute: upstream.execute });
      const response = await sendNative(h, true);
      const size = upstream.requests[0]!.bytes.byteLength;
      expect(response.status).toBe(committed ? 200 : 413);
      const wire = await response.text();
      expect(wire).toContain('"type":"request_too_large"');
      expect(wire).toContain(`Request size ${size} bytes exceeds limit 64 bytes.`);
      expect(wire).not.toMatch(/SECRET|999999|message_stop|overloaded_error/);
      expect(h.attempt.markCommitted).toHaveBeenCalledTimes(committed ? 1 : 0);
      expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
      expect(h.snapshots[0]).toMatchObject({ termination: 'upstream_error', estimated: true });
    } finally { await upstream.close(); }
  });
  it('keeps a status-only late 413 native without trusting provider prose', () => {
    const bytes = nativeLateErrorBytes({ status: 413, code: 'auth_rate_overloaded', message: 'SECRET',
      requestSize: { requestBytes: 17, source: 'upstream' } });
    expect(new TextDecoder().decode(bytes)).toContain('"type":"request_too_large"');
    expect(new TextDecoder().decode(bytes)).toContain('Request size 17 bytes was rejected as too large upstream');
    expect(new TextDecoder().decode(bytes)).not.toMatch(/SECRET|api_error|overloaded_error/);
  });
});
