import { describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../../src/adapters.js';
import { GeminiApiKeyRuntimeClient } from '../../src/transport/gemini-apikey-runtime-client.js';

const SECRET = 'secret-gemini-fallback-key';

const auth = { auth: { type: 'direct-token' as const, token: SECRET } };

const request = {
  providerId: 'gemini' as const,
  modelId: 'gemini-3.8-flash',
  messages: [
    { role: 'system' as const, content: 'You are concise.' },
    { role: 'user' as const, content: 'hello' },
  ],
};

const okPayload = {
  candidates: [{
    content: { parts: [{ text: 'hello world' }], role: 'model' },
    finishReason: 'STOP',
  }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
};

describe('Gemini API-key runtime client (paid fallback transport)', () => {
  it('POSTs the GenerateContent path with the key in the header and maps a completion', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(okPayload),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({ ...request }, auth);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(String(url)).not.toContain(SECRET);
    expect(init.headers).toMatchObject({ 'x-goog-api-key': SECRET });
    expect(JSON.parse(String(init.body))).toMatchObject({
      system_instruction: { parts: [{ text: 'You are concise.' }] },
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    });
    expect(response).toMatchObject({
      providerId: 'gemini',
      modelId: 'gemini-3.8-flash',
      text: 'hello world',
      finishReason: 'stop',
      providerRawFinishReason: 'STOP',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it('projects mesh tools to functionDeclarations with an ANY tool config and ceiling', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(okPayload), { status: 200 }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    await client.generate({
      ...request,
      tools: [{
        type: 'function', name: 'get_time', description: 'Get time',
        inputSchema: { type: 'object', properties: {} },
      }],
      toolChoice: 'required',
      maxOutputTokens: 64,
      temperature: 0.2,
      responseFormat: { type: 'json-object' },
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [{ functionDeclarations: [{ name: 'get_time', description: 'Get time' }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      generationConfig: {
        maxOutputTokens: 64, temperature: 0.2, responseMimeType: 'application/json',
      },
    });
  });

  it('round-trips named tool results as functionResponse and assistant calls as functionCall', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'get_time', args: { zone: 'UTC' } } }],
          role: 'model',
        },
        finishReason: 'STOP',
      }],
    }), { status: 200 }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    const response = await client.generate({
      ...request,
      messages: [
        { role: 'user' as const, content: 'time?' },
        {
          role: 'assistant' as const, content: '',
          toolCalls: [{
            toolCallId: 'mesh-1', name: 'get_time', argumentsText: '{"zone":"UTC"}',
          }],
        },
        {
          role: 'tool' as const, content: '',
          toolResult: { toolCallId: 'mesh-1', name: 'get_time', output: { time: 'now' } },
        },
      ],
    }, auth);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.contents).toMatchObject([
      { role: 'user', parts: [{ text: 'time?' }] },
      { role: 'model', parts: [{ functionCall: { name: 'get_time', args: { zone: 'UTC' } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'get_time', response: { time: 'now' } } }],
      },
    ]);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toMatchObject([{ name: 'get_time' }]);
  });

  it('streams SSE chunks and reports usage on the terminal done event', async () => {
    const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"hel"}],"role":"model"}}]}\n\n'
      + 'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"},"finishReason":"STOP"}],'
      + '"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}\n\n';
    const fetchFn = vi.fn(async () => new Response(sse,
      { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    const events = [];
    for await (const event of await client.stream({ ...request }, auth)) events.push(event);

    const [streamUrl] = fetchFn.mock.calls[0]!;
    expect(String(streamUrl)).toContain(':streamGenerateContent?alt=sse');
    expect(events.filter((event) => event.type === 'content_delta')).toHaveLength(2);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.data.finishReason).toBe('stop');
      expect(done.data.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    }
  });

  it('fails closed without calling the provider when no direct-token is present', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    await expect(client.generate({ ...request }, {})).rejects.toMatchObject({ status: 401 });
    await expect(client.generate({ ...request }, {
      auth: { type: 'environment-token' as const, envVar: 'GEMINI_API_KEY' },
    })).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never carries the key in the URL or the error message', async () => {
    const fetchFn = vi.fn(async () => new Response('denied', { status: 429 }));
    const client = new GeminiApiKeyRuntimeClient({ fetch: fetchFn });

    const error = await client.generate({ ...request }, auth).catch((cause: unknown) => cause);
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(String(fetchFn.mock.calls[0]![0])).not.toContain(SECRET);
    const normalized = new GeminiAdapter({ client }).normalizeError(error);
    expect(normalized.retryable).toBe(true);
  });

  it('maps MAX_TOKENS to length and safety blocks to content_filter', async () => {
    const run = async (finishReason: string) => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason }],
      }), { status: 200 }));
      return new GeminiApiKeyRuntimeClient({ fetch: fetchFn }).generate({ ...request }, auth);
    };
    expect((await run('MAX_TOKENS')).finishReason).toBe('length');
    expect((await run('SAFETY')).finishReason).toBe('content_filter');
  });
});
