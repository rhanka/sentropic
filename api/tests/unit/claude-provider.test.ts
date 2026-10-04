import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { channel } from 'node:diagnostics_channel';

// Mock the Anthropic SDK before importing the provider
const mockAnthropicCreate = vi.fn();
const mockAnthropicStream = vi.fn();
const mockAnthropicConstructor = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    constructor(options: unknown) {
      mockAnthropicConstructor(options);
    }

    messages = {
      create: mockAnthropicCreate,
      stream: mockAnthropicStream,
    };
  }
  return { default: MockAnthropic };
});

// Mock env to control API key presence
vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  },
}));

import { ClaudeProviderRuntime } from '../../src/services/providers/claude-provider';
import { nativeReadiness } from '../../src/services/llm-runtime/anthropic-native-readiness';
import { nativeResponseBytes } from '../../src/services/llm-runtime/anthropic-native-transport';

const withNativeHttp = async (reply: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  run: () => Promise<void>) => {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk.toString(); });
    request.on('end', () => reply(request, response, body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('ANTHROPIC_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try { await run(); } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};
const nativeRequest = (extra: Record<string, unknown> = {}) => ({
  body: { model: 'claude-sonnet-5', messages: [], ...extra }, stream: false, requestId: 'native-fixture',
  signal: new AbortController().signal,
  headers: { anthropicVersion: '2023-06-01', forwarded: {} as Record<string, string> },
});
const mockNativeResponse = (response: Response) => vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
  const request = {};
  channel('undici:request:create').publish({ request });
  const reader = (init.body as ReadableStream<Uint8Array>).getReader();
  try { while (!(await reader.read()).done) { /* Fake outbound transport drains bytes. */ } }
  finally { reader.releaseLock(); }
  channel('undici:request:bodySent').publish({ request });
  return response;
}));

describe('ClaudeProviderRuntime', () => {
  let runtime: ClaudeProviderRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new ClaudeProviderRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('keeps the 55-second deadline through a partial first frame and closes its reader', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: message_start\ndata: {}\n')); },
      cancel: cancelled,
    }));
    const deadline = nativeReadiness(new AbortController().signal);
    const iterator = nativeResponseBytes(response, deadline)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const pending = iterator.next().then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await pending).toMatchObject({ status: 504, code: 'timeout' });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses trusted Bearer auth and excludes caller credentials, transport and Connection nominations', async () => {
    await withNativeHttp((request, response, body) => {
      expect(request.headers.authorization).toBe('Bearer server-account');
      expect(request.headers['x-api-key']).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers['x-forwarded-for']).toBeUndefined();
      expect(request.headers['anthropic-hidden']).toBeUndefined();
      expect(request.headers['anthropic-future']).toBe('opaque');
      expect(request.headers['anthropic-beta']).toBe('future-one, future-two');
      expect(JSON.parse(body).future).toEqual({ unchanged: true });
      response.setHeader('anthropic-future', 'response-opaque');
      response.end('{}');
    }, async () => {
      const request = nativeRequest({ future: { unchanged: true } });
      request.headers.forwarded = { authorization: 'caller', 'x-api-key': 'caller', cookie: 'secret',
        'x-forwarded-for': 'private', connection: 'Anthropic-Hidden', 'anthropic-hidden': 'private',
        'anthropic-future': 'opaque', 'anthropic-beta': 'future-one, future-two' };
      const result = await runtime.nativeMessages({ ...request, claudeCodeTransport: { accessToken: 'server-account' } });
      expect(result.headers['anthropic-future']).toBe('response-opaque');
      expect(mockAnthropicConstructor).not.toHaveBeenCalled();
    });
  });

  it.each([400, 401, 403, 404, 413, 429, 500, 529])('does not retry native HTTP %i', async status => {
    let calls = 0;
    await withNativeHttp((_request, response) => {
      calls++;
      response.statusCode = status;
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'future validation' } }));
    }, async () => {
      await expect(runtime.nativeMessages(nativeRequest())).rejects.toMatchObject({ status });
    });
    expect(calls).toBe(1);
  });

  it.each(['future validation', 'insufficient credit balance'])('preserves the bounded 400 policy for %s', async message => {
    await withNativeHttp((_request, response) => {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message } }));
    }, async () => {
      await expect(runtime.nativeMessages(nativeRequest())).rejects.toMatchObject({ status: 400,
        validation: { message: message.includes('credit') ? 'The upstream service could not accept this request.' : message },
      });
    });
  });

  it.each([-1, 1.5, null, '1'])('rejects invalid count_tokens result %s', async input_tokens => {
    await withNativeHttp((_request, response) => response.end(JSON.stringify({ input_tokens })), async () => {
      await expect(runtime.nativeCountTokens(nativeRequest())).rejects.toMatchObject({ status: 503, code: 'native_protocol_error' });
    });
  });

  it('times out before response headers without an SDK retry', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', upstream);
    const result = runtime.nativeMessages(nativeRequest()).catch(error => error);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await result).toMatchObject({ code: 'timeout', status: 504 });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['messages', 'count_tokens'] as const)('bounds %s JSON readiness after headers and cancels its reader', async operation => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    mockNativeResponse(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"input_tokens":')); },
      cancel: cancelled,
    })));
    const result = (operation === 'messages' ? runtime.nativeMessages(nativeRequest())
      : runtime.nativeCountTokens(nativeRequest())).catch(error => error);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await result).toMatchObject({ code: 'timeout', status: 504 });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears readiness on a complete non-error frame and retains caller abort afterwards', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const caller = new AbortController();
    const bytes = new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","text":"é"}\n\n');
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel: cancelled }));
    const deadline = nativeReadiness(caller.signal);
    const iterator = nativeResponseBytes(response, deadline)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(bytes);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(deadline.signal.aborted).toBe(false);
    const pending = iterator.next().catch(error => error);
    caller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('does not clear readiness for an error frame and closes an unconsumed reader', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: error\ndata: {"type":"error"}\n\n')); },
      cancel: cancelled,
    }));
    const iterator = nativeResponseBytes(response, nativeReadiness(new AbortController().signal))[Symbol.asyncIterator]();
    await iterator.next();
    expect(vi.getTimerCount()).toBe(1);
    await iterator.return?.();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects measured local oversize before native fetch with numeric size only', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    await expect(runtime.nativeCountTokens(nativeRequest({ padding: 'x'.repeat(32_000_000) })))
      .rejects.toMatchObject({ status: 413, requestSize: { limitBytes: 32_000_000, source: 'gateway' } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['messages', 'count_tokens'] as const)('relays native %s JSON through fake HTTP after upload completion', async operation => {
    let received = '';
    let auth: string | undefined;
    let path: string | undefined;
    const server = createServer((request, response) => {
      path = request.url;
      auth = request.headers['x-api-key'] as string | undefined;
      request.on('data', chunk => { received += chunk.toString(); });
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ model: 'claude-sonnet-5', opaque: true, input_tokens: 123 }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const holders = new Set<string>();
    const body = { model: 'claude-sonnet-5', messages: [], future: { unchanged: 'é' } };
    vi.stubEnv('ANTHROPIC_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      const started = vi.fn();
      const request = { body, stream: false, requestId: 'native-test', onResponseStarted: started,
        signal: new AbortController().signal,
        headers: { anthropicVersion: '2023-06-01', forwarded: { 'x-api-key': 'caller-key' } },
        bodyProbe: (holder: string, retained: boolean) => retained ? holders.add(holder) : holders.delete(holder),
      };
      const result = operation === 'messages' ? await runtime.nativeMessages(request) : await runtime.nativeCountTokens(request);
      expect(path).toBe(operation === 'messages' ? '/v1/messages' : '/v1/messages/count_tokens');
      expect(started).toHaveBeenCalledTimes(operation === 'messages' ? 1 : 0);
      expect(result).toMatchObject({ kind: 'json', status: 200, body: { opaque: true } });
      expect(received).toBe(JSON.stringify(body));
      expect(auth).toBe('test-anthropic-key');
      expect(result.requestSize?.requestBytes).toBe(Buffer.byteLength(received));
      expect(holders.size).toBe(0);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  describe('provider descriptor', () => {
    it('should have correct provider id and label', () => {
      expect(runtime.provider.providerId).toBe('anthropic');
      expect(runtime.provider.label).toBe('Anthropic Claude');
    });

    it('should report ready status when API key is configured', () => {
      expect(runtime.provider.status).toBe('ready');
    });

    it('should report correct capabilities', () => {
      expect(runtime.provider.capabilities).toEqual({
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsReasoning: true,
      });
    });
  });

  describe('listModels', () => {
    it('should return Claude model catalog entries', () => {
      const models = runtime.listModels();
      expect(models).toHaveLength(5);

      const fable51 = models.find((m) => m.modelId === 'claude-fable-5-1');
      expect(fable51).toBeDefined();
      expect(fable51!.providerId).toBe('anthropic');
      expect(fable51!.supportsTools).toBe(true);
      expect(fable51!.supportsStreaming).toBe(true);

      const sonnet = models.find((m) => m.modelId === 'claude-sonnet-5');
      expect(sonnet).toBeDefined();
      expect(sonnet!.providerId).toBe('anthropic');
      expect(sonnet!.reasoningTier).toBe('advanced');
      expect(sonnet!.supportsTools).toBe(true);
      expect(sonnet!.supportsStreaming).toBe(true);

      // Opus 5 is the default Opus; 4.8 stays explicitly selectable.
      const opus5 = models.find((m) => m.modelId === 'claude-opus-5');
      expect(opus5).toBeDefined();
      expect(opus5!.providerId).toBe('anthropic');
      expect(opus5!.reasoningTier).toBe('advanced');
      expect(opus5!.supportsTools).toBe(true);
      expect(opus5!.supportsStreaming).toBe(true);

      const opus = models.find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus).toBeDefined();
      expect(opus!.reasoningTier).toBe('advanced');
    });
  });

  describe('validateCredential', () => {
    it('should return ok when env key is configured', () => {
      const result = runtime.validateCredential();
      expect(result.ok).toBe(true);
    });

    it('should return ok when override credential is provided', () => {
      const result = runtime.validateCredential('override-key');
      expect(result.ok).toBe(true);
    });

    it('should return not ok when credential is empty string', () => {
      const result = runtime.validateCredential('  ');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Anthropic API key');
    });
  });

  describe('normalizeError', () => {
    it('should normalize error with message string', () => {
      const error = { message: 'Rate limit exceeded', status: 429 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.providerId).toBe('anthropic');
      expect(normalized.message).toBe('Rate limit exceeded');
      expect(normalized.retryable).toBe(true);
    });

    it('should normalize error with code', () => {
      const error = { message: 'Bad request', code: 'invalid_request', status: 400 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.code).toBe('invalid_request');
      expect(normalized.retryable).toBe(false);
    });

    it('should normalize server error as retryable', () => {
      const error = { message: 'Internal error', status: 500 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.retryable).toBe(true);
    });

    it('should handle Error instances', () => {
      const error = new Error('SDK error');
      const normalized = runtime.normalizeError(error);
      expect(normalized.message).toBe('SDK error');
    });

    it('should provide fallback message for unknown errors', () => {
      const normalized = runtime.normalizeError(null);
      expect(normalized.message).toBe('Anthropic request failed');
    });
  });

  describe('generate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.generate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should call Anthropic messages.create with stream false', async () => {
      mockAnthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Hello' }] });

      const result = await runtime.generate({
        mode: 'messages',
        requestOptions: {
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false }),
        expect.anything(),
      );
      expect(result).toEqual({ content: [{ type: 'text', text: 'Hello' }] });
    });

    it('uses Authorization Bearer without X-Api-Key for Claude Code transport', async () => {
      mockAnthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Hello' }] });

      await runtime.generate({
        mode: 'messages',
        claudeCodeTransport: { accessToken: 'claude-code-access' },
        requestOptions: {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      const options = mockAnthropicConstructor.mock.calls.at(-1)?.[0] as {
        fetch?: typeof fetch;
      };
      const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response('{}', { status: 200, headers: init?.headers }),
      );
      vi.stubGlobal('fetch', upstreamFetch);

      await options.fetch?.('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': 'dummy', 'anthropic-version': '2023-06-01' },
      });

      const headers = new Headers(upstreamFetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get('authorization')).toBe('Bearer claude-code-access');
      expect(headers.has('x-api-key')).toBe(false);
    });
  });

  describe('streamGenerate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should return async iterable from Anthropic stream', async () => {

      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'message_stop' },
      ];

      mockAnthropicStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
      });

      const iterable = await runtime.streamGenerate({
        mode: 'messages',
        requestOptions: {
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      const collected: unknown[] = [];
      for await (const event of iterable) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0]).toEqual(events[0]);
    });
  });
});
