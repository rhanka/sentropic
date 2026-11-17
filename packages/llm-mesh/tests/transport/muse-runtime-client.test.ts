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

const sseResponse = (chunks: string[]): Response => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    const encoder = new TextEncoder();
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const completedPayload = {
  id: 'resp-1', model: 'muse-spark-1.3-contributor', status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello world' }] }],
  usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
};

describe('Muse runtime client (mesh-side upstream transport)', () => {
  it('POSTs the muse client Responses path with Bearer auth and maps a completion', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({ ...request }, auth);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/responses');
    expect((init.headers as Record<string, string>).authorization)
      .toBe(`Bearer ${'secret'}-muse-token`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'muse-spark-1.3-contributor',
      input: [{ type: 'message', role: 'user', content: 'hello' }],
    });
    expect(response).toMatchObject({
      providerId: 'muse', modelId: 'muse-spark-1.3-contributor',
      text: 'hello world',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it('emulates the muse client identity headers (seat attestation)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^muse-build\//);
    expect(headers).toMatchObject({
      'x-client-id': 'tbh:exec',
      'x-meta-ai-gateway-session-id': 'stable-session-1',
      'x-tbh-session-id': 'stable-session-1',
      'x-tbh-thread-id': 'stable-session-1',
      'x-tbh-root-session-id': 'stable-session-1',
    });
  });

  it('sends the Responses param name max_output_tokens', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({ ...request, maxOutputTokens: 64 }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.max_output_tokens).toBe(64);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('projects mesh tools to the Responses function shape', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', description: 'Get time', inputSchema: { type: 'object', properties: {} }, strict: true }],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{
      type: 'function', name: 'get_time', description: 'Get time',
      parameters: { type: 'object', properties: {} }, strict: true,
    }]);
  });

  it('maps a named tool choice to the Responses function shape', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
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

  it('projects history onto the Responses input (instructions, function calls, outputs)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
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
    expect(body.instructions).toBe('Be brief.');
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'What time is it?' },
        { type: 'input_image', image_url: 'https://example.test/clock.png' },
      ] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }] },
      { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{"x":1}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"value":42}' },
    ]);
    expect(JSON.stringify(body.input)).not.toContain('ingress');
  });

  it('decodes Responses output items (text + function calls) instead of dropping them', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-tc', model: 'muse-spark-1.3-contributor', status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] },
        { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{"x":1}' },
        { type: 'function_call', name: 'ghost' },
        'not-an-object',
      ],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    const response = await client.generate({
      ...request,
      tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' } }],
    }, auth);
    expect(response.text).toBe('partial');
    expect(response.toolCalls).toEqual([{
      toolCallId: 'call_1', providerCallId: 'call_1', name: 'get_time', argumentsText: '{"x":1}',
    }]);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('requalifies returned bare tool names through the Responses carrier refs', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-2', model: 'muse-spark-1.3-contributor', status: 'completed',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'work_list', arguments: '{}' }],
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

  it('maps an incomplete response reason instead of stop', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-len', model: 'muse-spark-1.3-contributor', status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'cut' }] }],
      usage: { input_tokens: 4, output_tokens: 12, total_tokens: 16 },
    }), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    const response = await client.generate({ ...request }, auth);
    expect(response.finishReason).toBe('length');
    expect(response.text).toBe('cut');
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

  it('refuses unsupported reasoning before Meta I/O (spec §16.4)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(completedPayload), { status: 200 }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    await expect(client.generate({
      ...request, reasoning: { effort: 'max', summary: 'auto' },
    }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sets stream:true on the wire for SSE', async () => {
    const fetchFn = vi.fn(async () => sseResponse([]));
    const client = new MuseRuntimeClient({ fetch: fetchFn });

    const stream = await client.stream({ ...request }, auth);
    for await (const _ of stream) { /* drain */ }

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true });
  });

  it('streams Responses events as content deltas then done', async () => {
    const sse = sseResponse([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-1","model":"muse-spark-1.3-contributor"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1","model":"muse-spark-1.3-contributor","status":"completed","output":[],"usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}}\n\n',
    ]);
    const client = new MuseRuntimeClient({ fetch: async () => sse });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('hello world');
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', data: {
      finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    } });
  });

  it('decodes streamed function calls into start/delta events with a tool_calls terminal', async () => {
    const sse = sseResponse([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"item_1","call_id":"call_9","name":"get_time","arguments":""}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"item_1","call_id":"call_9","delta":"{\\"x\\""}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"item_1","call_id":"call_9","delta":"1}"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-1","status":"completed","output":[{"type":"function_call","call_id":"call_9","name":"get_time","arguments":"{\\"x\\"1}"}],"usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n',
    ]);
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const starts = events.filter((e) => e.type === 'tool_call_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ data: { toolCallId: 'call_9', providerCallId: 'call_9', name: 'get_time' } });
    const deltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(deltas.map((e) => (e as { data: { delta: string } }).data.delta).join('')).toBe('{"x"1}');
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { finishReason: 'tool_calls' } });
  });

  it('ends done/unknown when the stream closes without a completed terminal (R4-MIN-3)', async () => {
    const sse = sseResponse([
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    ]);
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { finishReason: 'unknown' } });
  });

  it('maps a streamed incomplete terminal to length, never stop', async () => {
    const sse = sseResponse([
      'data: {"type":"response.output_text.delta","delta":"cut"}\n\n',
      'data: {"type":"response.incomplete","response":{"id":"resp-1","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[],"usage":{"input_tokens":4,"output_tokens":12,"total_tokens":16}}}\n\n',
    ]);
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toMatchObject({
      data: { finishReason: 'length', usage: { inputTokens: 4, outputTokens: 12, totalTokens: 16 } },
    });
  });

  it('surfaces a streamed provider failure as an error event', async () => {
    const sse = sseResponse([
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"upstream broke"}}}\n\n',
    ]);
    const client = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) {
      events.push(event);
    }
    expect(events[events.length - 1]).toMatchObject({
      type: 'error', data: { message: 'upstream broke' },
    });
  });

  it('surfaces upstream-reported model in providerMetadata and stream metadata', async () => {
    const clientWithModel = new MuseRuntimeClient({
      fetch: async () => new Response(JSON.stringify({
        ...completedPayload, id: 'resp-m1', model: 'muse-spark-1.2-fallback',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const generated = await clientWithModel.generate({ ...request }, auth);
    expect(generated.modelId).toBe('muse-spark-1.3-contributor');
    expect(generated.providerMetadata).toEqual({ observedServedModelId: 'muse-spark-1.2-fallback' });

    const sse = sseResponse([
      'data: {"type":"response.created","response":{"id":"resp-m1","model":"muse-spark-1.2-fallback"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-m1","model":"muse-spark-1.2-fallback","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ]);
    const streamClient = new MuseRuntimeClient({ fetch: async () => sse });
    const events = [];
    for await (const ev of await streamClient.stream({ ...request }, auth)) events.push(ev);
    expect(events[0]).toMatchObject({ type: 'status', data: { metadata: { observedServedModelId: 'muse-spark-1.2-fallback' } } });
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { metadata: { observedServedModelId: 'muse-spark-1.2-fallback' } } });
  });
});
