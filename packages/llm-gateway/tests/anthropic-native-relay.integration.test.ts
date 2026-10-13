import { describe, expect, it } from 'vitest';
import { nativeHttpFixture } from './fixtures/anthropic-native-http.js';
import { nativeHarness, nativeRouter, nativeFrame, nativeStart } from './fixtures/native-flow.js';

describe('native relay through loopback HTTP', () => {
  it.each([false, true])('preserves opaque bodies/headers and isolates caller authority (stream=%s)', async stream => {
    const frames = [new TextEncoder().encode(': unknown ☃\r\n\r\n'), nativeStart('claude-sonnet-5'),
      nativeFrame('message_delta', { usage: { output_tokens: 3 }, delta: { safeguard_results: { future: ['雪'] } } }),
      nativeFrame('message_stop')];
    const upstream = await nativeHttpFixture({ ...(stream ? { frames } : {}), headers: {
      'anthropic-new-extension': 'kept', 'set-cookie': 'SECRET', 'anthropic-api-key': 'SECRET',
      'x-sentropic-request-id': 'SPOOF', 'x-sentropic-relay': 'SPOOF', 'x-forwarded-for': 'SECRET' } });
    try {
      const h = nativeHarness({ execute: upstream.execute, allowanceOutput: 16, body: {
        container: { id: 'opaque' }, mcp_servers: [{ url: 'https://fixture.invalid' }],
        safeguards: { unknown: ['雪'] }, future_body: { nested: [true, null] },
        authorization: 'BODY-INERT', max_completion_tokens: 999 } });
      const body = { ...h.request.body, stream };
      const response = await nativeRouter(h).request('/v1/messages', { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', authorization: 'Bearer CALLER-SECRET',
          'x-api-key': 'CALLER-KEY', 'anthropic-api-key': 'CALLER-KEY', 'anthropic-version': '2023-06-01',
          'anthropic-beta': 'future-beta, dangerous-tool-use-2026-09-03', 'anthropic-organization-id': 'opaque-org',
          'anthropic-future': 'opaque', 'x-app': 'claude-code', 'x-stainless-arch': 'fixture',
          'user-agent': 'CALLER-AGENT', 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8',
          forwarded: 'for=203.0.113.7', 'x-sentropic-caller': 'SPOOF', traceparent: 'CALLER-TRACE' } });
      expect(response.status).toBe(200);
      if (stream) expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(Buffer.concat(frames)));
      else expect((await response.json()).safeguard_results).toEqual({ future: ['雪'] });
      const captured = upstream.requests[0]!;
      expect(captured.body).toEqual(body);
      expect(new Uint8Array(captured.bytes)).toEqual(new TextEncoder().encode(JSON.stringify(body)));
      expect(captured.headers).toMatchObject({ 'x-api-key': 'SERVER-FIXTURE-KEY', 'anthropic-version': '2023-06-01',
        'anthropic-beta': 'future-beta, dangerous-tool-use-2026-09-03', 'anthropic-organization-id': 'opaque-org',
        'anthropic-future': 'opaque', 'x-app': 'claude-code', 'x-stainless-arch': 'fixture' });
      for (const name of ['authorization', 'anthropic-api-key', 'x-forwarded-for', 'x-real-ip', 'forwarded',
        'x-sentropic-caller', 'traceparent']) expect(captured.headers[name]).toBeUndefined();
      expect(captured.headers['user-agent']).not.toBe('CALLER-AGENT');
      expect(captured.headers['content-length']).toBe(String(captured.bytes.length));
      expect(response.headers.get('anthropic-organization-id')).toBe('org-fixture');
      expect(response.headers.get('anthropic-new-extension')).toBe('kept');
      expect(response.headers.get('x-sentropic-request-id')).toBe('req-native');
      expect(response.headers.get('x-sentropic-relay')).toBe('native');
      for (const name of ['set-cookie', 'anthropic-api-key', 'x-forwarded-for']) expect(response.headers.has(name)).toBe(false);
      expect(upstream.requests).toHaveLength(1); expect(h.recorder.settlements).toHaveLength(1);
    } finally { await upstream.close(); }
  });
  it.each([
    ['messages.0.content.0.clear_at: invalid value', 'messages.0.content.0.clear_at: invalid value'],
    ['Unsupported beta: dangerous-tool-use-2026-09-03', 'Unsupported beta: dangerous-tool-use-2026-09-03'],
    ['anthropic-billing-header: invalid value', 'anthropic-billing-header: invalid value'],
    ['Your credit balance is too low; purchase credits', 'The upstream service could not accept this request.'],
  ])('applies native 400 public policy over HTTP: %s', async (message, expected) => {
    const upstream = await nativeHttpFixture({ status: 400,
      json: { type: 'error', error: { type: 'invalid_request_error', message }, extra: 'PRIVATE' } });
    try {
      const h = nativeHarness({ execute: upstream.execute });
      const response = await nativeRouter(h).request('/v1/messages', { method: 'POST', body: JSON.stringify(h.request.body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: expected } });
      expect(response.headers.has('anthropic-organization-id')).toBe(false);
      expect(response.headers.has('x-sentropic-relay')).toBe(false);
      expect(upstream.requests).toHaveLength(1); expect(h.recorder.settlements).toHaveLength(1);
    } finally { await upstream.close(); }
  });
  it('returns the first frame before upstream completion and cancels a paused HTTP response', async () => {
    const first = new TextEncoder().encode(': ready\r\n\r\n');
    const upstream = await nativeHttpFixture({ frames: [first, nativeStart('claude-sonnet-5')], pauseAfterFirst: true });
    try {
      const h = nativeHarness({ execute: upstream.execute });
      const response = await nativeRouter(h).request('/v1/messages', { method: 'POST',
        body: JSON.stringify({ ...h.request.body, stream: true }) });
      const reader = response.body!.getReader();
      expect((await reader.read()).value).toEqual(first);
      await reader.cancel(); await upstream.closed;
      expect(h.attempt.releaseCancelled).toHaveBeenCalledTimes(1);
      expect(h.recorder.settlements).toHaveLength(1);
      expect(h.snapshots[0]!.termination).toBe('cancelled');
    } finally { await upstream.close(); }
  });
});
