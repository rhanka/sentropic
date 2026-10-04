import { describe, expect, it, vi } from 'vitest';
import { RequestTooLargeError } from '@sentropic/llm-mesh';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { FixtureTransport } from './fixtures/transport.js';

describe('shared passthrough numeric 413', () => {
  it.each(['json-response', 'json-throw', 'stream-throw'] as const)('keeps %s terminal on both wires with rejecting settlement', async mode => {
    const requestSize = { requestBytes: 111, limitBytes: 100, source: 'upstream' as const };
    for (const path of ['/v1/messages', '/v1/chat/completions']) {
      const error = new RequestTooLargeError(requestSize);
      const transport = new FixtureTransport({ jsonResponse: { status: 413, requestSize,
        body: { error: { message: 'PRIVATE' } }, headers: { 'retry-after': '10', 'anthropic-organization-id': 'PRIVATE' } },
        streamOpenError: error });
      const dispatch = mode === 'stream-throw' ? vi.spyOn(transport, 'sendStream') : vi.spyOn(transport, 'send');
      if (mode === 'json-throw') vi.spyOn(transport, 'send').mockRejectedValue(error);
      const h = buildHarness({ transport });
      const settle = vi.spyOn(h.metering, 'settle').mockRejectedValue(Error('sink unavailable'));
      const response = await h.app.request(path, { method: 'POST', headers: authHeaders('user-a'),
        body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [], stream: mode === 'stream-throw' }) });
      expect(response.status).toBe(413);
      expect((await response.json()).error).toMatchObject({ message: 'Request size 111 bytes exceeds limit 100 bytes.' });
      expect(response.headers.get('x-should-retry')).toBe('false');
      expect(response.headers.has('retry-after')).toBe(false);
      expect(response.headers.has('anthropic-organization-id')).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(1); expect(settle).toHaveBeenCalledTimes(1);
    }
  });
});
