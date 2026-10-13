import { describe, expect, it, vi } from 'vitest';
import type { PreparedRouteAttempt } from '@sentropic/llm-mesh';
import { createGatewayRouter, RouteAttemptDispatch, stubGatewayConfig } from '../src/index.js';
import { dispatchNativeMessages } from '../src/route-attempt-dispatch.js';

describe('opaque route attempt dispatch', () => {
  it.each(['generate', 'stream'] as const)('delegates %s to the exact attempt with the original request', async method => {
    const result = {};
    const call = vi.fn(async () => result);
    const attempt = { generate: call, stream: call } as unknown as PreparedRouteAttempt;
    const controller = new AbortController();
    const request = { messages: [], tools: [], signal: controller.signal, metadata: { correlationId: 'trusted' } };
    expect(await new RouteAttemptDispatch()[method]({ attempt, request })).toBe(result);
    expect(call).toHaveBeenCalledExactlyOnceWith(request);
    expect(call.mock.contexts[0]).toBe(attempt);
  });
  it.each(['generate', 'stream'] as const)('rejects auth injection and prior cancellation for %s', async method => {
    const call = vi.fn();
    const attempt = { generate: call, stream: call } as unknown as PreparedRouteAttempt;
    const dispatch = new RouteAttemptDispatch();
    await expect(dispatch[method]({ attempt, request: { messages: [], auth: undefined } as never })).rejects.toThrow('injection');
    const controller = new AbortController(); controller.abort();
    await expect(dispatch[method]({ attempt, request: { messages: [], signal: controller.signal } })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('preserves typed failure identity for flow classification', async () => {
    const error = { status: 429, retryAfterMs: 123, usage: { inputTokens: 2 } };
    const attempt = { async generate() { throw error; }, async stream() { throw error; } };
    await expect(new RouteAttemptDispatch().generate({ attempt, request: { messages: [] } })).rejects.toBe(error);
  });
  it('refuses incomplete routing configuration instead of choosing native dispatch', () => {
    expect(() => createGatewayRouter({ config: stubGatewayConfig, routeDispatch: new RouteAttemptDispatch() }))
      .toThrow('routePlanner and routeMetering');
  });

  it('delegates nativeMessages to capability and enforces model/version/signal validity', async () => {
    const result = { kind: 'json' as const, status: 200 as const, headers: {}, body: {} };
    const execute = vi.fn(async () => result);
    const capability = {
      contractVersion: 1 as const,
      protocol: 'anthropic-messages' as const,
      modelId: 'claude-sonnet-5',
      apiVersions: ['2023-06-01'],
      requiredBetas: [],
      execute,
    };
    const request = {
      stream: false,
      requestId: 'req-1',
      headers: { anthropicVersion: '2023-06-01', forwarded: {} },
      body: { model: 'claude-sonnet-5', messages: [], max_tokens: 64 },
      signal: new AbortController().signal,
    };
    const dispatch = new RouteAttemptDispatch();
    expect(await dispatch.nativeMessages({ capability, request })).toBe(result);
    expect(execute).toHaveBeenCalledWith(request);

    await expect(dispatch.nativeMessages({ capability: {} as never, request }))
      .rejects.toMatchObject({ status: 503, code: 'native_protocol_error' });
    await expect(dispatch.nativeMessages({ capability, request: { ...request, body: { ...request.body, model: 'claude-opus-5' } } }))
      .rejects.toMatchObject({ status: 503, code: 'native_protocol_error' });

    const aborted = new AbortController(); aborted.abort();
    await expect(dispatch.nativeMessages({ capability, request: { ...request, signal: aborted.signal } }))
      .rejects.toMatchObject({ status: 503, code: 'account_unavailable', usage: { inputTokens: 0, outputTokens: 0 } });

    const custom = { nativeMessages: vi.fn(async () => result) };
    expect(await dispatchNativeMessages(custom as never, { capability, request })).toBe(result);
    expect(custom.nativeMessages).toHaveBeenCalledOnce();
    expect(await dispatchNativeMessages(undefined, { capability, request })).toBe(result);
  });
});
