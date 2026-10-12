import { describe, expect, it, vi } from 'vitest';
import { MistralRuntimeClient } from '../../src/transport/mistral-runtime-client.js';

const auth = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'mistral' as const,
      accessToken: 'secret-mistral-token', accountId: 'acct_mistral_1',
      metadata: { stableSessionId: 'stable-session-1' },
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'mistral' as const },
  },
};

const request = {
  providerId: 'mistral' as const, modelId: 'mistral-small-2603',
  messages: [{ role: 'user', content: 'hello' }] as const,
};

describe('Mistral runtime client (mesh-side upstream transport)', () => {
  it('POSTs the documented serving path with Bearer auth and maps a completion', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-1',
      choices: [{ message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({ ...request }, auth);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-mistral-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'mistral-small-2603',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(response).toMatchObject({
      id: 'resp-1',
      providerId: 'mistral', modelId: 'mistral-small-2603',
      text: 'hello world',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it('sends the OpenAI param name max_tokens (Mistral 400s max_output_tokens)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hi' } }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request, maxOutputTokens: 64 }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(64);
    expect(body).not.toHaveProperty('max_output_tokens');
  });

  it('projects mesh tools to OpenAI function shape (verbatim mesh tools get a live 400)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hi' } }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', description: 'Get time', inputSchema: { type: 'object', properties: {} } }],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'get_time', description: 'Get time', parameters: { type: 'object', properties: {} },
      },
    }]);
  });

  it('sends no gateway session header (Mistral has no muse x-meta session slot)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hi' } }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const headers = init.headers as Record<string, unknown>;
    expect(Object.keys(headers).some((key) => key.includes('x-meta'))).toBe(false);
    expect(Object.keys(headers).some((key) => key.includes('session'))).toBe(false);
  });

  it('strips gateway ingress metadata from the wire (Mistral 422s extra message inputs)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hi' } }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      messages: [
        {
          role: 'user' as const,
          content: 'hello',
          metadata: { ingress: { role: 'user', content: 'hello' } },
        },
      ],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('never accepts an absent executable mistral token', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    await expect(client.generate({ ...request }, {
      auth: { material: { type: 'account-transport', provider: 'mistral' } },
    })).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('preserves rate-limit status and Retry-After for gateway classification', async () => {
    const client = new MistralRuntimeClient({
      fetch: async () => new Response('slow down', { status: 429, headers: { 'retry-after': '9' } }),
    });

    await expect(client.generate({ ...request }, auth))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 9_000 });
  });

  it('surfaces billing failures without leaking the key', async () => {
    const client = new MistralRuntimeClient({
      fetch: async () => new Response(JSON.stringify({ message: 'billing verification failed' }), { status: 402 }),
    });

    const err = await client.generate({ ...request }, auth).catch((e: Error) => e);
    expect(err.message).toContain('402');
    expect(err.message).not.toContain('secret-mistral-token');
  });

  it('streams JSON chunks as content deltas then done', async () => {
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of ['data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', 'data: {"choices":[{"delta":{"content":" world"}}]}\n\n']) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MistralRuntimeClient({ fetch: async () => sse });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('hello world');
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('drops the OpenAI SSE done terminator (never a stray content delta)', async () => {
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of [
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MistralRuntimeClient({ fetch: async () => sse });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('hi');
    const done = events[events.length - 1];
    expect(done?.type).toBe('done');
    expect((done as { data: { finishReason: string } }).data.finishReason).toBe('stop');
  });

  it('sets stream:true on the wire for SSE (Mistral answers 200 JSON without it)', async () => {
    const fetchFn = vi.fn(async () => new Response('data: {"x":1}\n\n', { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });

    const stream = await client.stream({ ...request }, auth);
    for await (const _ of stream) { /* drain */ }

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true });
  });

  it('streams OpenAI chat chunks via choices delta content with usage on the final chunk', async () => {
    const chunks = [
      { choices: [{ delta: { role: 'assistant', content: 'Hi' }, finish_reason: null, index: 0 }], object: 'chat.completion.chunk' },
      { choices: [{ delta: { content: ' there' }, finish_reason: null, index: 0 }], object: 'chat.completion.chunk' },
      { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }], object: 'chat.completion.chunk', usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 } },
    ];
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MistralRuntimeClient({ fetch: async () => sse });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('Hi there');
    const done = events[events.length - 1];
    expect(done?.type).toBe('done');
    expect((done as { data: { usage: unknown } }).data.usage).toMatchObject({ inputTokens: 8, outputTokens: 5 });
  });

  it('maps a named tool choice to the OpenAI function shape (spec §16.4)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-2', choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });
    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'get_time' },
      parallelToolCalls: false,
    }, auth);
    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      tool_choice: { type: 'function', name: 'get_time' },
      parallel_tool_calls: false,
    });
  });

  it('decodes message tool calls instead of dropping them (spec §16.4)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-tc', choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"x":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });
    const response = await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' } }],
    }, auth);
    expect(response.toolCalls).toEqual([{
      toolCallId: 'call_1', providerCallId: 'call_1', name: 'get_time', argumentsText: '{"x":1}',
    }]);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.message).toMatchObject({
      toolCalls: [{ toolCallId: 'call_1', name: 'get_time' }],
    });
  });

  it('recovers from malformed tool entries without losing valid calls', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-tc2', choices: [{
        message: {
          content: 'partial',
          tool_calls: [
            { id: 'call_ok', type: 'function', function: { name: 'get_time', arguments: '{}' } },
            { type: 'function', function: { name: 'ghost' } },
            'not-an-object',
          ],
        },
        finish_reason: 'tool_calls',
      }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });
    const response = await client.generate({ ...request }, auth);
    expect(response.toolCalls.map((call) => call.toolCallId)).toEqual(['call_ok']);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.text).toBe('partial');
  });

  it('decodes SSE tool deltas into start/delta events with a tool_calls terminal', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"get_time","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
    ];
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MistralRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const starts = events.filter((e) => e.type === 'tool_call_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ data: { toolCallId: 'call_9', providerCallId: 'call_9', name: 'get_time' } });
    const deltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('{"x"1}');
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', data: { finishReason: 'tool_calls' } });
  });

  it('forwards effort on the proven reasoning_effort slot and omits none (spec §16.4)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-3', choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }));
    const client = new MistralRuntimeClient({ fetch: fetchFn });
    await client.generate({
      ...request, reasoning: { effort: 'high', summary: 'auto' },
    }, auth);
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1].body)) as Record<string, unknown>;
    // Proven by Vibe 2.26.1 itself (reasoning_effort: "high" on this wire).
    expect(body).toMatchObject({ reasoning_effort: 'high' });
    expect(body).not.toHaveProperty('reasoning');

    const noneFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-4', choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }));
    await new MistralRuntimeClient({ fetch: noneFn }).generate({
      ...request, reasoning: { effort: 'none' },
    }, auth);
    expect(JSON.parse(String(noneFn.mock.calls[0]![1].body)) as Record<string, unknown>)
      .not.toHaveProperty('reasoning_effort');
  });
});
