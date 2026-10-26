import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJevTransport } from '../../src/transport/jev.js';

afterEach(() => vi.useRealTimers());
describe('JEV deadline, cancellation and status mapping without retry', () => {
  it.each([[401, 'AUTHENTICATION_FAILED'], [422, 'PROVIDER_REJECTED'], [429, 'RATE_LIMITED'],
    [529, 'PROVIDER_OVERLOADED'], [500, 'PROVIDER_UNAVAILABLE'], [400, 'PROVIDER_REJECTED']])(
    'maps status %s to %s once and ignores undocumented retry headers', async (status, code) => {
      const fetch = vi.fn().mockResolvedValue(new Response('upstream-secret', { status: Number(status), headers: { 'retry-after': '10' } }));
      const result = await createJevTransport({ fetch }).send('{}', 'synthetic-key');
      expect(result).toMatchObject({ ok: false, error: { code, phase: 'dispatch' } });
      expect(JSON.stringify(result)).not.toMatch(/upstream-secret|retryAfterMs/);
      expect(fetch).toHaveBeenCalledOnce();
    });
  it('refuses cancellation before dispatch and cancels a fetch that ignores abort', async () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const transport = createJevTransport({ fetch });
    expect(await transport.send('{}', 'synthetic-key', { signal: AbortSignal.abort() })).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = transport.send('{}', 'synthetic-key', { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('enforces the deadline across a stalled body and clears timers', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
    const fetch = vi.fn().mockResolvedValue(response);
    const pending = createJevTransport({ fetch }).send('{}', 'synthetic-key', { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({ error: { code: 'TIMEOUT', phase: 'dispatch' } });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('sanitizes network exceptions and refuses invalid deadline configuration', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('synthetic-key content-canary'));
    const transport = createJevTransport({ fetch });
    const result = await transport.send('{}', 'synthetic-key');
    expect(result).toMatchObject({ error: { code: 'TRANSPORT_FAILED' } });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-key|content-canary/);
    expect(await transport.send('{}', 'synthetic-key', { timeoutMs: 60_001 })).toMatchObject({ error: { code: 'REQUEST_INVALID' } });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
