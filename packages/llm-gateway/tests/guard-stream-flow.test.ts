import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';
import { GuardEngine } from '../src/guards/guard-engine.js';
import { SseGuardTee, SSE_CAPTURE_MAX_BYTES, SSE_GUARD_OVERLAP_BYTES } from '../src/guards/sse-guard-tee.js';
import { createGatewayRouter } from '../src/router/index.js';
import { stubGatewayConfig } from '../src/stubs.js';

const SPLIT_AWS_A = ['AKIA', 'IOSFOD'].join('');
const SPLIT_AWS_B = ['NN7EXAMPLE'].join('');
const FULL_AWS = SPLIT_AWS_A + SPLIT_AWS_B;

const callerAuth = {
  async verify() {
    return { ok: true as const, cost: { tenantId: 't1', workspaceId: 'w1', principalId: 'u1', ownerScopeRef: 'owner-a', source: 'test', correlationId: 'c1' } };
  },
};

const streamPlanner = (events: StreamEvent[], prepareSpy = vi.fn()) => new InMemoryRoutePlanner({
  directory: {
    listEligible: async () => [{
      accountRef: 'acct-1', diagnosticAccountRef: 'diag-1', targetProviderId: 'anthropic', transportProviderId: 'claude-code',
      supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1',
    }],
    prepareAttempt: async () => {
      prepareSpy();
      return {
        attemptRef: 'att-1',
        generate: async () => ({ id: 'r1', providerId: 'anthropic', modelId: 'claude-sonnet-5', message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' }),
        stream: async () => (async function* () { for (const e of events) yield e; })(),
        markCommitted: async () => undefined, complete: async () => undefined,
        releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
      } as unknown as PreparedRouteAttempt;
    },
  },
});

describe('L1.3b SseGuardTee (16 KiB overlap + 2 MiB cap) & router flow wiring', () => {
  it('catches chunk-split secrets via 16 KiB overlap window and marks >2 MiB capture truncated without overwriting start', () => {
    expect(SSE_GUARD_OVERLAP_BYTES).toBe(16 * 1024);
    expect(SSE_CAPTURE_MAX_BYTES).toBe(2 * 1024 * 1024);
    const tee = new SseGuardTee({ guard: new GuardEngine() });
    tee.pushChunk(`START_MARKER ${SPLIT_AWS_A}`);
    const second = tee.pushChunk(`${SPLIT_AWS_B} tail`);
    expect(second.findings.some((f) => f.detectorId === 'secret.aws_access_key')).toBe(true);
    const fin = tee.finalize();
    expect(fin.maskedCapture.__maskedCapturePayload).toBe(true);
    expect(String(fin.maskedCapture.payload)).not.toContain(FULL_AWS);
    expect(String(fin.maskedCapture.payload)).toContain('[REDACTED:TECH_SECRET]');
    expect(fin.truncated).toBe(false);

    // >2 MiB capture stops appending and preserves initial prefix
    const bigTee = new SseGuardTee({ guard: new GuardEngine(), maxCaptureBytes: 64 });
    bigTee.pushChunk('PREFIX_KEPT_0123456789');
    bigTee.pushChunk('X'.repeat(120));
    const bigFin = bigTee.finalize();
    expect(bigFin.truncated).toBe(true);
    expect(bigFin.maskedCapture.truncated).toBe(true);
    expect(String(bigFin.maskedCapture.payload).startsWith('PREFIX_KEPT_0123456789')).toBe(true);
    expect(Buffer.byteLength(String(bigFin.maskedCapture.payload), 'utf8')).toBeLessThanOrEqual(64);
  });

  it('refuses blocked ingress pre-dispatch (400, x-should-retry: false, zero seat called) and keeps capture OFF by default', async () => {
    const prepareSpy = vi.fn();
    const captureSpy = vi.fn();
    const guard = new GuardEngine({ detectorActions: { 'secret.aws_access_key': 'block' } });
    const app = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth },
      routePlanner: streamPlanner([{ type: 'content_delta', data: { delta: 'hi' } }, { type: 'done', data: { finishReason: 'stop' } }], prepareSpy),
      routeMetering: { settleRoute() {} },
      guard,
      onCapture: captureSpy,
    });
    const blockedRes = await app.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: FULL_AWS }] }),
    });
    expect(blockedRes.status).toBe(400);
    expect(blockedRes.headers.get('x-should-retry')).toBe('false');
    expect(prepareSpy).not.toHaveBeenCalled();

    // Clean request succeeds with captureEnabled defaulting OFF (onCapture never invoked)
    const okRes = await app.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(okRes.status).toBe(200);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('cuts SSE mid-stream on block posture without emitting synthetic message_stop or [DONE]', async () => {
    const guard = new GuardEngine({ detectorActions: { 'secret.aws_access_key': 'block' } });
    const app = createGatewayRouter({
      config: { ...stubGatewayConfig, callerAuth },
      routePlanner: streamPlanner([
        { type: 'content_delta', data: { delta: `safe ${SPLIT_AWS_A}` } },
        { type: 'content_delta', data: { delta: `${SPLIT_AWS_B} leaked` } },
        { type: 'content_delta', data: { delta: 'after-block' } },
        { type: 'done', data: { finishReason: 'stop' } },
      ]),
      routeMetering: { settleRoute() {} },
      guard,
    });
    const res = await app.request('/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, messages: [{ role: 'user', content: 'stream' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('after-block');
    expect(body).not.toContain('message_stop');
    expect(body).not.toContain('[DONE]');
  });
});
