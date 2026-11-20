import { describe, expect, it, vi } from 'vitest';
import { createGatewayRouter } from '../src/router/index.js';
import type { GuardPort } from '../src/ports/guards.js';
import { nativeHarness, nativeStart, nativeStreamHarness } from './fixtures/native-flow.js';

const MODEL = 'claude-sonnet-5';

const rogueGuardMutating = (mutate: (rec: Record<string, unknown>) => Record<string, unknown>): GuardPort => ({
  inspectRequest: (payload) => ({
    verdict: 'masked', findings: [],
    inFlightPayload: mutate({ ...(payload as Record<string, unknown>) }),
    maskedCapture: { __maskedCapturePayload: true, payload, findings: [] },
  }),
  maskForCapture: (payload) => ({ __maskedCapturePayload: true, payload, findings: [] }),
  scanText: (text) => ({ maskedText: text, findings: [], blocked: false }),
});

describe('L1.5 Protected Identification Invariant — native JSON/SSE, r8-F1 budget release & r8-F2 uniform Connection', () => {
  it('enforces P on native JSON & SSE strictly before markDurableAttempt/markRouteDispatched and releases budget hold (r8-F1)', async () => {
    for (const stream of [false, true]) {
      const h = stream ? nativeStreamHarness([nativeStart(MODEL)]) : nativeHarness();
      const beginAttempt = vi.fn();
      const refused: unknown[] = [];
      const app = createGatewayRouter({
        config: h.deps.config, routePlanner: h.deps.routePlanner, routeMetering: h.deps.metering,
        budget: h.deps.budget, nativeMessagesEnabled: true, requestId: () => 'req-nat-1',
        requestAudit: { admit: async () => ({ receiptId: 'rcpt-nat-1' }), beginAttempt, refuse: async (_id, d) => { refused.push(d); } },
        guard: rogueGuardMutating((r) => ({ ...r, system: 'tampered-native' })),
      });
      const res = await app.request('/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-beta': 'prompt-caching-2024-07-31', 'x-app': 'claude-code' },
        body: JSON.stringify({ ...h.request.body, system: 'orig-native', stream }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('x-should-retry')).toBe('false');
      expect(res.headers.get('x-sentropic-receipt')).toBe('rcpt-nat-1');
      expect(h.execute).not.toHaveBeenCalled();
      expect(beginAttempt).not.toHaveBeenCalled();
      expect(h.recorder.events.filter((e) => e.startsWith('mark:'))).toEqual([]);
      expect(h.recorder.events).toContain('release:hold-1');
      expect(h.attempt.releaseCancelled).toHaveBeenCalledTimes(1);
      expect(h.attempt.recordOutcome).not.toHaveBeenCalled();
      expect(refused).toEqual([expect.objectContaining({ integrity: 'protected_identification_violation' })]);
    }
  });

  it('rejects Connection-nominated protected headers uniformly on native and canonical fallback paths with no guard configured (r8-F2)', async () => {
    // Connection: x-claude-code-session on native path refused 400
    const hNative = nativeHarness();
    const appNative = createGatewayRouter({
      config: hNative.deps.config, routePlanner: hNative.deps.routePlanner, routeMetering: hNative.deps.metering,
      budget: hNative.deps.budget, nativeMessagesEnabled: true,
    });
    const resNative = await appNative.request('/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-claude-code-session': 's1', connection: 'keep-alive, x-claude-code-session',
      },
      body: JSON.stringify({ ...hNative.request.body, stream: false }),
    });
    expect(resNative.status).toBe(400);
    expect(hNative.execute).not.toHaveBeenCalled();
    expect(hNative.recorder.events.filter((e) => e.startsWith('mark:'))).toEqual([]);
    expect(hNative.recorder.events).toContain('release:hold-1');

    // Connection: anthropic-beta (attempting silent native -> canonical fallback) refused 400
    const hFallback = nativeHarness({ body: { safeguards: undefined } });
    const fallbackBody = { model: hFallback.model, max_tokens: 32_000, messages: [{ role: 'user', content: 'hi' }] };
    const appFallback = createGatewayRouter({
      config: hFallback.deps.config, routePlanner: hFallback.deps.routePlanner, routeMetering: hFallback.deps.metering,
      budget: hFallback.deps.budget, nativeMessagesEnabled: true,
    });
    const resFallback = await appFallback.request('/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'anthropic-beta': 'prompt-caching-2024-07-31',
        connection: 'keep-alive, anthropic-beta',
      },
      body: JSON.stringify(fallbackBody),
    });
    expect(resFallback.status).toBe(400);
    expect(hFallback.execute).not.toHaveBeenCalled();
    expect(hFallback.recorder.events.filter((e) => e.startsWith('mark:'))).toEqual([]);
    expect(hFallback.recorder.events).toContain('release:hold-1');
  });
});
