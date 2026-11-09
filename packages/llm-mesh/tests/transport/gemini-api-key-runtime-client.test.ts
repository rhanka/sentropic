import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiApiKeyClient,
  GeminiApiKeyRuntimeClient,
} from '../../src/transport/gemini-api-key-runtime-client.js';

const API_KEY = 'test-gemini-fallback-key';

const successPayload = {
  responseId: 'resp-1',
  candidates: [{
    content: { parts: [{ text: 'hello world' }], role: 'model' },
    finishReason: 'STOP',
  }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
};

const request = {
  providerId: 'gemini' as const,
  modelId: 'gemini-3.8-flash',
  messages: [{ role: 'user', content: 'hello' }] as const,
};

const okResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('Gemini static-key runtime client (mesh-side upstream transport)', () => {
  it('POSTs the GenerateContent path with x-goog-api-key and maps a completion', async () => {
    const fetchFn = vi.fn(async () => okResponse(successPayload));
    const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

    const response = await client.generate({ ...request });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(init.headers).toMatchObject({ 'x-goog-api-key': API_KEY });
    expect(init.headers).not.toHaveProperty('authorization');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    });
    expect(body).not.toHaveProperty('model');
    expect(response).toMatchObject({
      id: 'resp-1',
      providerId: 'gemini',
      modelId: 'gemini-3.8-flash',
      text: 'hello world',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it('routes system messages to systemInstruction, not contents', async () => {
    const fetchFn = vi.fn(async () => okResponse(successPayload));
    const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

    await client.generate({
      ...request,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
  });

  it('maps 429 to rate_limited with the retry hint', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota spent' } }),
      { status: 429, headers: { 'retry-after': '7' } },
    ));
    const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

    const failure = await client.generate({ ...request }).catch((error: unknown) => error);
    const record = failure as Record<string, unknown>;

    expect(record.status).toBe(429);
    expect(record.code).toBe('rate_limited');
    expect(record.retryAfterMs).toBe(7_000);
    expect(String((failure as Error).message)).toBe('Gemini API key rate limit exceeded (429)');
  });

  it('maps 402 to a distinct non-retryable billing failure naming depleted prepayment', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 402, message: 'Payment Required' } }),
      { status: 402 },
    ));
    const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

    const failure = await client.generate({ ...request }).catch((error: unknown) => error);
    const record = failure as Record<string, unknown>;

    expect(record.status).toBe(402);
    expect(record.code).toBe('billing_unavailable');
    expect(String((failure as Error).message)).toContain('prepayment credits are depleted');
  });

  it('maps 401 and 403 to auth_failed', async () => {
    for (const status of [401, 403]) {
      const fetchFn = vi.fn(async () => new Response(
        JSON.stringify({ error: { code: status, status: 'UNAUTHENTICATED' } }),
        { status },
      ));
      const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

      const failure = await client.generate({ ...request }).catch((error: unknown) => error);

      expect((failure as Record<string, unknown>).status).toBe(status);
      expect((failure as Record<string, unknown>).code).toBe('auth_failed');
    }
  });

  it('never leaks the key in thrown errors', async () => {
    const fetchFn = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const client = new GeminiApiKeyRuntimeClient({ apiKey: API_KEY, fetch: fetchFn });

    const failure = await client.generate({ ...request }).catch((error: unknown) => error);

    expect(JSON.stringify(failure)).not.toContain(API_KEY);
  });

  it('refuses an empty key without echoing it', () => {
    expect(() => new GeminiApiKeyRuntimeClient({ apiKey: '  ' })).toThrow('Gemini API key is missing');
    try {
      new GeminiApiKeyRuntimeClient({ apiKey: '' });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('test');
    }
  });

  it('streams a single-shot completion ending in done', async () => {
    const fetchFn = vi.fn(async () => okResponse(successPayload));
    const client = createGeminiApiKeyClient({ apiKey: API_KEY, fetch: fetchFn });

    const events = [];
    for await (const event of await client.stream({ ...request })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['content_delta', 'done']);
    expect(events[1]).toMatchObject({ data: { finishReason: 'stop' } });
  });
});
