import { describe, expect, it, vi } from 'vitest';
import type { PreparedRouteAttempt, RoutePlanner, StreamEvent } from '@sentropic/llm-mesh';
import { createGatewayRouter, PersonalPassthroughCallerAuth, stubGatewayConfig,
  VerifiedCostContextResolver } from '../src/index.js';

const fixture = () => {
  const native = vi.fn(() => { throw Error('native dispatch forbidden'); });
  const verify = vi.fn(() => ({ tenantId: 't', principalId: 'p', source: 'test', ownerScopeRef: 'enrolled:p' }));
  const hooks: string[] = [];
  const closed = vi.fn(); const settleRoute = vi.fn();
  let signal: AbortSignal | undefined;
  const attempt: PreparedRouteAttempt = {
    attemptRef: 'opaque',
    async generate() { return { id: 'r', providerId: 'openai', modelId: 'gpt-5.6-terra',
      message: { role: 'assistant', content: 'answer' }, text: 'answer', toolCalls: [], finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 } }; },
    async stream(request) {
      signal = request.signal;
      return (async function* (): AsyncGenerator<StreamEvent> {
        try {
          yield { type: 'status', data: { status: 'started', metadata: {
            responseHeaders: { 'request-id': 'upstream', 'set-cookie': 'SECRET', 'x-account': 'SECRET' },
          } } };
          yield { type: 'content_delta', data: { delta: 'answer' } };
          yield { type: 'done', data: { finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 } } };
        } finally { closed(); }
      })();
    },
    async markCommitted() { hooks.push('committed'); }, async complete() { hooks.push('complete'); },
    async releaseCancelled() { hooks.push('cancelled'); }, async recordOutcome() { hooks.push('failed'); },
  };
  const plan = vi.fn(async () => ({ planRef: 'p', candidateRefs: ['c'], diagnostics: [{
    candidateRef: 'c', actualProviderId: 'openai', actualModelId: 'gpt-5.6-terra', actualTransportProviderId: 'codex',
  }] }));
  const app = createGatewayRouter({ config: { ...stubGatewayConfig,
    callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver() }),
    pool: { ...stubGatewayConfig.pool, select: native }, authResolver: { resolve: native },
    dispatch: { dispatch: native, dispatchStream: native },
  }, routePlanner: { plan, prepareAttempt: async () => attempt } as unknown as RoutePlanner,
  routeMetering: { settleRoute }, routeInput: () => ({ affinityKey: 'stable-session' }), requestId: () => 'unique-request' });
  const send = (path: string, stream = false) => app.request(path, { method: 'POST',
    headers: { 'x-api-key': 'trusted-token', 'x-correlation-id': 'forged' },
    body: JSON.stringify({ model: 'gpt-5.6-terra', stream, messages: [{ role: 'user', content: 'hello' }] }),
  });
  return { app, send, attempt, hooks, closed, settleRoute, native, verify, plan, signal: () => signal };
};

describe('Lot 2 routed Hono integration', () => {
  it.each(['/v1/messages', '/v1/chat/completions'])('preserves JSON/SSE and one financial event: %s', async path => {
    for (const stream of [false, true]) {
      const f = fixture();
      const response = await f.send(path, stream);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('answer'); expect(body).not.toContain('SECRET');
      if (stream) {
        expect(body.match(path.endsWith('messages') ? /event: message_stop/g : /\[DONE\]/g)).toHaveLength(1);
        expect(response.headers.get('request-id')).toBe('upstream');
        expect(response.headers.has('set-cookie')).toBe(false);
        expect(response.headers.has('x-account')).toBe(false);
      }
      expect(f.verify).toHaveBeenCalledTimes(1); expect(f.plan).toHaveBeenCalledTimes(1);
      expect(f.plan).toHaveBeenCalledWith({ principalRef: 'p', ownerScopeRef: 'enrolled:p' },
        expect.objectContaining({ affinityKey: 'stable-session' }));
      expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        cost: expect.objectContaining({ correlationId: 'unique-request' }), outcome: 'success',
        usage: { inputTokens: 5, outputTokens: 2, estimated: false },
      }));
      expect(f.native).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('propagates body cancellation and releases once (read first: %s)', async readFirst => {
    const f = fixture();
    const response = await f.send('/v1/messages', true);
    if (readFirst) { const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); }
    else await response.body!.cancel();
    expect(f.signal()?.aborted).toBe(true);
    expect(f.hooks).toEqual(['committed', 'cancelled']);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.settleRoute).toHaveBeenCalledTimes(1);
    expect(f.settleRoute.mock.calls[0]![0].outcome).toBe('cancelled');
  });
});
