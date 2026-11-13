import { expect, it, vi } from 'vitest';
import { createGeminiDecisionsTransport } from '../src/transport/gemini-decisions.js';

it.each([
  { status: 400 }, { status: 302 }, { status: 200, redirected: true },
  { status: 200, contentType: 'text/plain' },
  { status: 200, length: 'invalid' }, { status: 200, length: '5' },
])('should cancel an unread response body on early refusal: %j', async ({ status, redirected, contentType, length }) => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const response = new Response(body, { status, headers: {
    'content-type': contentType ?? 'application/json', ...(length ? { 'content-length': length } : {}),
  } });
  if (redirected) Object.defineProperty(response, 'redirected', { value: true });
  const fetch = vi.fn(async () => response);
  expect(await createGeminiDecisionsTransport({ fetch, maxResponseBytes: 4 }).send('{}', 'synthetic-secret'))
    .toMatchObject({ ok: false });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([[400, 'PROVIDER_REJECTED'], [401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'],
  [429, 'RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE'], [302, 'PROVIDER_REJECTED']] as const)(
  'should map HTTP %s without exposing provider errors or retrying', async (status, code) => {
    const fetch = vi.fn(async () => new Response('synthetic-secret error', { status }));
    const result = await createGeminiDecisionsTransport({ fetch }).send('{}', 'synthetic-secret');
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

it('should enforce a deadline even if fetch ignores its abort signal', async () => {
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  expect(await createGeminiDecisionsTransport({ fetch }).send('{}', 'synthetic-secret', { timeoutMs: 5 }))
    .toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('should cancel before dispatch and enforce the response byte bound', async () => {
  const fetch = vi.fn(async () => new Response('{"padding":"too large"}', { headers: { 'content-type': 'application/json' } }));
  const transport = createGeminiDecisionsTransport({ fetch, maxResponseBytes: 4 });
  expect(await transport.send('{}', 'synthetic-secret', { signal: AbortSignal.abort() }))
    .toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  expect(fetch).not.toHaveBeenCalled();
  expect(await transport.send('{}', 'synthetic-secret')).toMatchObject({ ok: false, error: { code: 'RESPONSE_TOO_LARGE' } });
});

it('should refuse non-JSON content and malformed JSON', async () => {
  for (const response of [new Response('{}'), new Response('{', { headers: { 'content-type': 'application/json' } })]) {
    const fetch = vi.fn(async () => response);
    expect(await createGeminiDecisionsTransport({ fetch }).send('{}', 'synthetic-secret'))
      .toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' } });
  }
});
