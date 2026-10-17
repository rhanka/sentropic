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
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
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

  it('sends the OpenAI param name max_tokens (Meta 400s max_output_tokens)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request, maxOutputTokens: 64 }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(64);
    expect(body).not.toHaveProperty('max_output_tokens');
  });

  it('projects mesh tools to OpenAI function shape (verbatim mesh tools get a live 400)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', description: 'Get time', inputSchema: { type: 'object', properties: {} } }],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'get_time', description: 'Get time',
        parameters: { type: 'object', properties: {} },
      },
    }]);
  });

  it('forwards the validated strict flag on function tools (fixture B serves strict:true)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' }, strict: true }],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{
      type: 'function',
      function: { name: 'get_time', parameters: { type: 'object' }, strict: true },
    }]);
  });

  it('forwards the gateway session id when the account carries one', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).toMatchObject({ 'x-meta-ai-gateway-session-id': 'stable-session-1' });
  });

  it('requalifies returned bare tool names through the Responses carrier refs', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-2',
      choices: [{ message: { content: '',
        tool_calls: [{ id: 'call_1', type: 'function',
          function: { name: 'work_list', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
    }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({ ...request,
      providerOptions: { responses: { customTools: [],
        functionToolRefs: [{ qualifiedName: 'muse.work_list', bareName: 'work_list', namespace: 'muse' }],
        reasoningArtifacts: [], itemIds: [] } } }, auth);

    expect(response.toolCalls).toEqual([{ toolCallId: 'call_1', providerCallId: 'call_1',
      name: 'muse.work_list', argumentsText: '{}' }]);
    expect(response.finishReason).toBe('tool_calls');
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

  it('sets stream:true on the wire for SSE (Meta answers 200 JSON without it)', async () => {
    const fetchFn = vi.fn(async () => new Response('data: {"x":1}\n\n', { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    const stream = await client.stream({ ...request }, auth);
    for await (const _ of stream) { /* drain */ }

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true });
  });

  it('streams OpenAI chat chunks via choices delta content (live Meta shape)', async () => {
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
    const client = new MuseRuntimeClient({ fetch: async () => sse });

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
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'get_time' },
      parallelToolCalls: false,
    }, auth);
    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      tool_choice: { type: 'function', function: { name: 'get_time' } },
      parallel_tool_calls: false,
    });
  });

  it('projects tool history onto the Chat wire shape (spec §16.4, R4-MAJ-2)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      messages: [
        { role: 'developer', content: 'Be brief.' },
        { role: 'user', content: [
          { type: 'text', text: 'What time is it?' },
          { type: 'image', url: 'https://example.test/clock.png' },
        ] },
        {
          role: 'assistant', content: [{ type: 'text', text: 'Checking.' }],
          toolCalls: [{
            toolCallId: 'call_1', providerCallId: 'call_1', name: 'get_time',
            argumentsText: '{"x":1}',
          }],
          metadata: { ingress: { raw: 'canonical-noise' } },
        },
        {
          role: 'tool', content: '{"value":42}',
          toolResult: {
            toolCallId: 'call_1', providerCallId: 'call_1', name: 'get_time',
            output: '{"value":42}',
          },
          metadata: { ingress: { raw: 'canonical-noise' } },
        },
      ],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: [
        { type: 'text', text: 'What time is it?' },
        { type: 'image_url', image_url: { url: 'https://example.test/clock.png' } },
      ] },
      {
        role: 'assistant', content: [{ type: 'text', text: 'Checking.' }],
        tool_calls: [{
          id: 'call_1', type: 'function',
          function: { name: 'get_time', arguments: '{"x":1}' },
        }],
      },
      { role: 'tool', content: '{"value":42}', tool_call_id: 'call_1' },
    ]);
    expect(JSON.stringify(body.messages)).not.toContain('ingress');
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
    const client = new MuseRuntimeClient({ fetch: fetchFn });
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
    const client = new MuseRuntimeClient({ fetch: fetchFn });
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
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const starts = events.filter((e) => e.type === 'tool_call_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ data: { toolCallId: 'call_9', providerCallId: 'call_9', name: 'get_time' } });
    const deltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(deltas).toHaveLength(2);
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('{"x"1}');
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', data: { finishReason: 'tool_calls' } });
  });

  it('honors provider finish reasons instead of defaulting to stop (spec §16.4)', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"cut"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":12,"total_tokens":16}}\n\n',
    ];
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toMatchObject({
      data: {
        finishReason: 'length', providerRawFinishReason: 'length',
        usage: { inputTokens: 4, outputTokens: 12, totalTokens: 16 },
      },
    });
  });

  it('treats an early usage-only chunk as accounting, not a terminal stop', async () => {
    const chunks = [
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":0,"total_tokens":4}}\n\n',
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\n',
    ];
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('hi');
    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    // No finish reason and no `[DONE]`: the trailing usage chunk is
    // accounting, and the truncated close is `unknown`, never `stop`
    // (spec §16.4, R4-MIN-3).
    expect(doneEvents[0]).toMatchObject({
      data: { finishReason: 'unknown', usage: { totalTokens: 5 } },
    });
  });

  it('ends done/unknown when the stream closes without finish_reason or terminator (R4-MIN-3)', async () => {
    const sse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { finishReason: 'unknown' } });
  });

  it('ends done/stop behind the SSE clean terminator without finish_reason (R4-MIN-3)', async () => {
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
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { finishReason: 'stop' } });
  });

  it('maps JSON finish reasons length and content_filter instead of stop', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-len', choices: [{ message: { content: 'cut' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 4, completion_tokens: 12, total_tokens: 16 },
    }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    const response = await client.generate({ ...request }, auth);
    expect(response.finishReason).toBe('length');
    expect(response).toMatchObject({ providerRawFinishReason: 'length' });
  });

  it('refuses unsupported reasoning before Meta I/O (spec §16.4)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-3', choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    await expect(client.generate({
      ...request, reasoning: { effort: 'max', summary: 'auto' },
    }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
