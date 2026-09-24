import { describe, expect, it, vi } from 'vitest';
import type { PreparedRouteAttempt } from '@sentropic/llm-mesh';
import { createGatewayRouter, RouteAttemptDispatch, stubGatewayConfig } from '../src/index.js';

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
});
