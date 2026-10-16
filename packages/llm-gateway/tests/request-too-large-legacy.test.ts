import { describe, expect, it, vi } from 'vitest';
import { RequestTooLargeError } from '@sentropic/llm-mesh';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { FixtureTransport } from './fixtures/transport.js';

// N09: shared legacy passthrough numeric 413 on the pre-Responses wires (R
// covered two). A legacy/scaffold-only router answers an authenticated
// OpenAI-shaped 501 for the Responses wire without calling legacy dispatch
// (spec §16.2, R4-MAJ-5) — so the Responses leg below pins 501 with zero
// dispatch/settlement, and only Messages/Chat ride the 413 terminal mapping.
// Native HTTP/SSE stays N22.
describe('shared passthrough numeric 413', () => {
  it.each(['json-response', 'json-throw', 'stream-throw'] as const)('keeps %s terminal on every wire with rejecting settlement', async mode => {
    const requestSize = { requestBytes: 111, limitBytes: 100, source: 'upstream' as const };
    for (const [path, body] of [
      ['/v1/messages', { model: 'claude-sonnet-4-6', messages: [], stream: mode === 'stream-throw' }],
      ['/v1/chat/completions', { model: 'claude-sonnet-4-6', messages: [], stream: mode === 'stream-throw' }],
    ] as const) {
      const error = new RequestTooLargeError(requestSize);
      const transport = new FixtureTransport({ jsonResponse: { status: 413, requestSize,
        body: { error: { message: 'PRIVATE' } }, headers: { 'retry-after': '10', 'anthropic-organization-id': 'PRIVATE' } },
        streamOpenError: error });
      const dispatch = mode === 'stream-throw' ? vi.spyOn(transport, 'sendStream') : vi.spyOn(transport, 'send');
      if (mode === 'json-throw') vi.spyOn(transport, 'send').mockRejectedValue(error);
      const h = buildHarness({ transport });
      const settle = vi.spyOn(h.metering, 'settle').mockRejectedValue(Error('sink unavailable'));
      const response = await h.app.request(path, { method: 'POST', headers: authHeaders('user-a'),
        body: JSON.stringify(body) });
      expect(response.status).toBe(413);
      expect((await response.json()).error).toMatchObject({ message: 'Request size 111 bytes exceeds limit 100 bytes.' });
      expect(response.headers.get('x-should-retry')).toBe('false');
      expect(response.headers.has('retry-after')).toBe(false);
      expect(response.headers.has('anthropic-organization-id')).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(1); expect(settle).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['json-response', 'json-throw', 'stream-throw'] as const)('answers legacy-only %s on the Responses wire with 501 and zero dispatch', async mode => {
    const requestSize = { requestBytes: 111, limitBytes: 100, source: 'upstream' as const };
    const error = new RequestTooLargeError(requestSize);
    const transport = new FixtureTransport({ jsonResponse: { status: 413, requestSize,
      body: { error: { message: 'PRIVATE' } } }, streamOpenError: error });
    const send = vi.spyOn(transport, 'send');
    const sendStream = vi.spyOn(transport, 'sendStream');
    if (mode === 'json-throw') send.mockRejectedValue(error);
    const h = buildHarness({ transport });
    const settle = vi.spyOn(h.metering, 'settle').mockRejectedValue(Error('sink unavailable'));
    const response = await h.app.request('/v1/responses', { method: 'POST', headers: authHeaders('user-a'),
      body: JSON.stringify({ model: 'claude-sonnet-4-6', input: 'hello', stream: mode === 'stream-throw' }) });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'not_implemented' }) });
    expect(send).not.toHaveBeenCalled(); expect(sendStream).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
});
