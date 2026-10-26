import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiDecisionsTransport } from '../src/decision/host.js';

afterEach(() => vi.useRealTimers());
describe('bounded dedicated Decisions transport', () => {
  it.each([301, 302, 307, 308, 401, 422, 429, 500, 503])('should send once and refuse HTTP %s without following redirects', async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status, headers: { location: 'https://foreign.invalid' } }));
    const result = await createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token');
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toHaveLength(2);
  });
  it('should reject a redirected response even when it reports HTTP 200', async () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'redirected', { value: true });
    const fetch = vi.fn(async () => response);
    expect(await createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token'))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_REJECTED' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['text/plain', 'application/html'])('should reject unexpected media type %s', async (contentType) => {
    const fetch = vi.fn(async () => new Response('{}', { headers: { 'content-type': contentType } }));
    expect(await createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token'))
      .toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' } });
  });
  it('should bound the streamed body independently of content length', async () => {
    const fetch = vi.fn(async () => new Response('123456789', { headers: { 'content-type': 'application/json' } }));
    expect(await createOpenAiDecisionsTransport({ fetch, maxResponseBytes: 8 }).send('{}', 'fixture-token'))
      .toMatchObject({ ok: false, error: { code: 'RESPONSE_TOO_LARGE' } });
  });
  it('should reject malformed JSON and invalid UTF-8 without repair', async () => {
    for (const body of ['broken', new Uint8Array([0xff])]) {
      const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json' } }));
      expect(await createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token'))
        .toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' } });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('should complete at deadline when fetch ignores abort', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const result = createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token', { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('should complete at deadline when the body and cancellation ignore abort', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => new Promise<void>(() => {}) });
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json' } }));
    const result = createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token', { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });
  it('should reject cancelled calls and malformed credentials before egress', async () => {
    const fetch = vi.fn();
    const transport = createOpenAiDecisionsTransport({ fetch });
    expect(await transport.send('{}', 'fixture-token', { signal: AbortSignal.abort() }))
      .toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await transport.send('{}', 'bad\nheader')).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_MISSING' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('should redact a credential canary in the upstream request ID', async () => {
    const fetch = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-token' } }));
    expect(await createOpenAiDecisionsTransport({ fetch }).send('{}', 'fixture-token')).toEqual({ ok: true, body: {} });
  });
});
