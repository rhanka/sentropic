import { describe, expect, it, vi } from 'vitest';
import { MuseRuntimeClient } from '../../src/transport/muse-runtime-client.js';

const auth = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'muse' as const,
      accessToken: 'secret-muse-token', accountId: 'acct_muse_1',
      metadata: { stableSessionId: 'stable-session-1' },
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const },
  },
};

const request = {
  providerId: 'muse' as const, modelId: 'muse-spark-1.3-contributor',
  messages: [{ role: 'user', content: 'hello' }] as const,
};

describe('Muse runtime client (mesh-side upstream transport)', () => {
  it('POSTs the measured serving path with Bearer auth and maps a completion', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-1',
      output_text: 'hello world',
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({ ...request }, auth);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/muse-code/models');
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-muse-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'muse-spark-1.3-contributor',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(response).toMatchObject({
      providerId: 'muse', modelId: 'muse-spark-1.3-contributor',
      text: 'hello world',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it('forwards the gateway session id when the account carries one', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).toMatchObject({ 'x-meta-ai-gateway-session-id': 'stable-session-1' });
  });

  it('never accepts an absent executable muse token', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await expect(client.generate({ ...request }, {
      auth: { material: { type: 'account-transport', provider: 'muse' } },
    })).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('preserves rate-limit status and Retry-After for gateway classification', async () => {
    const client = new MuseRuntimeClient({
      fetch: async () => new Response('slow down', { status: 429, headers: { 'retry-after': '9' } }),
    });

    await expect(client.generate({ ...request }, auth))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 9_000 });
  });

  it('surfaces billing failures without leaking the key', async () => {
    const client = new MuseRuntimeClient({
      fetch: async () => new Response(JSON.stringify({ error: { message: 'billing verification failed' } }), { status: 402 }),
    });

    const err = await client.generate({ ...request }, auth).catch((e: Error) => e);
    expect(err.message).toContain('402');
    expect(err.message).not.toContain('secret-muse-token');
  });

  it('streams JSON chunks as content deltas then done', async () => {
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of ['data: {"output_text":"hello"}\n\n', 'data: {"output_text":" world"}\n\n']) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MuseRuntimeClient({ fetch: async () => sse });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('hello world');
    expect(events[events.length - 1]?.type).toBe('done');
  });
});
