import { describe, expect, it, vi } from 'vitest';
import { CodexRuntimeClient } from '../../src/transport/codex-runtime-client.js';

const sseResponse = (events: readonly unknown[]) => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      events.forEach((event) => controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      ));
      controller.close();
    },
  }),
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
);

const auth = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'codex' as const,
      accessToken: 'secret-codex-token', accountId: 'chatgpt-account-1',
      metadata: { stableSessionId: 'stable-session-1' },
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'codex' as const },
  },
};

describe('Codex runtime client', () => {
  it('executes the ChatGPT-plan SSE backend with enrolled account context', async () => {
    const fetchFn = vi.fn(async () => sseResponse([
      { type: 'response.created', response: { id: 'response-1' } },
      { type: 'response.output_text.delta', delta: 'hello' },
      { type: 'response.output_text.delta', delta: ' world' },
      {
        type: 'response.completed',
        response: {
          id: 'response-1',
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        },
      },
    ]));
    const client = new CodexRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
    }, auth);

    expect(response).toMatchObject({
      id: 'response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
      text: 'hello world', finishReason: 'stop',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer secret-codex-token',
      'chatgpt-account-id': 'chatgpt-account-1', session_id: 'stable-session-1',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-5.6-terra', stream: true, store: false,
    });
  });

  it('preserves rate-limit status and Retry-After for gateway classification', async () => {
    const client = new CodexRuntimeClient({
      fetch: async () => new Response('rate limited', {
        status: 429, headers: { 'retry-after': '9' },
      }),
    });

    await expect(client.stream({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
    }, auth)).rejects.toMatchObject({ status: 429, retryAfterMs: 9_000 });
  });

  it('reports tool_calls when the live terminal event omits its streamed function call', async () => {
    const fetchFn = vi.fn(async () => sseResponse([
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call', id: 'item-1', call_id: 'call-1',
          name: 'report_probe', arguments: '{"status":"ok"}',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'response-tool-1', output: [],
          usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
        },
      },
    ]));
    const client = new CodexRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'call the tool' }],
      tools: [{ type: 'function', name: 'report_probe', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'report_probe' },
    }, auth);

    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toEqual([expect.objectContaining({
      toolCallId: 'item-1', providerCallId: 'call-1', name: 'report_probe',
    })]);
  });

  it('lets the done-item argument snapshot win over fragments (no duplication)', async () => {
    const fetchFn = vi.fn(async () => sseResponse([
      {
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'item-9', call_id: 'call-9', name: 'lookup', arguments: '' },
      },
      {
        type: 'response.function_call_arguments.delta', item_id: 'item-9', delta: '{"id":',
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call', id: 'item-9', call_id: 'call-9',
          name: 'lookup', arguments: '{"id":1}',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'response-9', output: [{ type: 'function_call', id: 'item-9', call_id: 'call-9' }],
          usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
        },
      },
    ]));
    const client = new CodexRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'look it up' }],
    }, auth);

    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toEqual([{
      toolCallId: 'item-9', providerCallId: 'call-9', name: 'lookup',
      argumentsText: '{"id":1}',
    }]);
  });

  it('reports incomplete terminals with usage instead of success', async () => {
    const fetchFn = vi.fn(async () => sseResponse([
      { type: 'response.output_text.delta', delta: 'cut off' },
      {
        type: 'response.incomplete',
        response: {
          id: 'response-10', incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 4, output_tokens: 12, total_tokens: 16 },
        },
      },
    ]));
    const client = new CodexRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'go long' }],
    }, auth);

    expect(response).toMatchObject({
      text: 'cut off', finishReason: 'length',
      usage: { inputTokens: 4, outputTokens: 12, totalTokens: 16 },
    });
  });

  it('never accepts an absent executable Codex token', async () => {
    const fetchFn = vi.fn();
    const client = new CodexRuntimeClient({ fetch: fetchFn });

    await expect(client.stream({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
    })).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces upstream response.model on status/done stream events and generate providerMetadata', async () => {
    const makeEvents = () => [
      { type: 'response.created', response: { id: 'resp-obs', model: 'gpt-5.6-mini-fallback' } },
      { type: 'response.output_text.delta', delta: 'ok' },
      {
        type: 'response.completed',
        response: {
          id: 'resp-obs', model: 'gpt-5.6-mini-fallback',
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        },
      },
    ];
    const client = new CodexRuntimeClient({ fetch: async () => sseResponse(makeEvents()) });
    const events = [];
    for await (const ev of await client.stream({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
    }, auth)) {
      events.push(ev);
    }
    expect(events[0]).toMatchObject({ type: 'status', data: { metadata: { observedServedModelId: 'gpt-5.6-mini-fallback' } } });
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { metadata: { observedServedModelId: 'gpt-5.6-mini-fallback' } } });

    const generated = await client.generate({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
    }, auth);
    expect(generated.modelId).toBe('gpt-5.6-terra');
    expect(generated.providerMetadata).toEqual({ observedServedModelId: 'gpt-5.6-mini-fallback' });
  });
});
