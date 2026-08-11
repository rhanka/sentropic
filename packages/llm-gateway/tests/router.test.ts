import { describe, expect, it } from 'vitest';
import type { RoutePlanner } from '@sentropic/llm-mesh';

import {
  createGatewayRouter,
  notImplemented,
  stubGatewayConfig,
  type AuthzMode,
  type GatewayConfig,
} from '../src/index.js';
import { parseSse } from '../src/wire.js';

const buildApp = () => createGatewayRouter({ config: stubGatewayConfig });

describe('@sentropic/llm-gateway router (v0 scaffold)', () => {
  it('mounts and serves a real /healthz', async () => {
    const app = buildApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; mode: string };
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('personal-passthrough');
  });

  it('serves /readyz (ready by default in the scaffold)', async () => {
    const app = buildApp();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ready');
  });

  it('exposes the frozen v1 surface with provider-shaped 501 stubs', async () => {
    const app = buildApp();

    const anthropic = await app.request('/v1/messages', { method: 'POST' });
    expect(anthropic.status).toBe(501);
    const aBody = (await anthropic.json()) as { type: string; error: { type: string } };
    expect(aBody.type).toBe('error');
    expect(aBody.error.type).toBe('api_error');

    const openai = await app.request('/v1/chat/completions', { method: 'POST' });
    expect(openai.status).toBe(501);
    const oBody = (await openai.json()) as { error: { code?: string } };
    expect(oBody.error.code).toBe('not_implemented');

    // /v1/models is caller/pool-policy filtered (spec §3): the stub caller-auth
    // fails, so an unauthenticated request gets a provider-shaped 401 — never
    // the pool. (A real authenticated snapshot is covered in models.test.ts.)
    const models = await app.request('/v1/models');
    expect(models.status).toBe(401);
    const mBody = (await models.json()) as { error: { type: string } };
    expect(mBody.error.type).toBe('invalid_request_error');
  });

  it('defaults the cross-user kill switch OFF (personal-passthrough only)', () => {
    const config: GatewayConfig = stubGatewayConfig;
    expect(config.crossUserPoolEnabled).toBe(false);
    expect(config.mode).toBe('personal-passthrough');
  });

  it('carries the 3-mode authz type surface (gated, types-only in v0)', () => {
    const modes: AuthzMode[] = ['direct', 'explicit-validation', 'assisted'];
    expect(modes).toHaveLength(3);
  });

  it('produces a provider-shaped error mapper', () => {
    const err = notImplemented('openai-chat-completions');
    expect(err.status).toBe(501);
  });

  it('runs through the opaque mesh route path without a target resolver', async () => {
    const settlements: unknown[] = [];
    let observedSignal: AbortSignal | undefined;
    const config = {
      ...stubGatewayConfig,
      callerAuth: { async verify() { return {
        ok: true,
        cost: {
          tenantId: 'tenant-1', principalId: 'user-1', source: 'test', correlationId: 'request-1',
        },
      }; } },
    };
    const routePlanner: RoutePlanner = {
      async plan() { return {
        planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z', candidateRefs: ['candidate-1'],
        policy: {
          strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
          negativeCacheTtlMs: 300_000, maxAttempts: 3, preferSameTransport: true,
          stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
        },
        councilRevision: 'fixture',
        diagnostics: [{
          candidateRef: 'candidate-1', diagnosticAccountRef: 'redacted',
          requestedModel: 'claude-opus-5-high', actualProviderId: 'openai',
          actualModelId: 'gpt-5.6-terra', actualTransportProviderId: 'codex',
          reason: 'alias', cacheContinuityRisk: false,
        }],
      }; },
      async prepareAttempt() { return {
        attemptRef: 'attempt-1',
        async generate(request) {
          observedSignal = request.signal;
          return {
          id: 'response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
          message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [],
          finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 },
          };
        },
        async stream() { return { async *[Symbol.asyncIterator]() {} }; },
        async recordOutcome() {}, async markCommitted() {}, async complete() {},
        async releaseCancelled() {},
      }; },
      describeAffinity() { return null; }, promoteAffinity() { throw new Error('unused'); },
      rebindAffinity() { throw new Error('unused'); }, resetAffinity() { return false; },
    };
    const app = createGatewayRouter({
      config, routePlanner,
      routeMetering: { settleRoute(value) { settlements.push(value); } },
    });

    const abort = new AbortController();
    const response = await app.request('/v1/messages', {
      method: 'POST', headers: { authorization: 'Bearer gateway-session' },
      signal: abort.signal,
      body: JSON.stringify({
        model: 'claude-opus-5-high', max_tokens: 100,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: 'message', model: 'gpt-5.6-terra', content: [{ type: 'text', text: 'ok' }],
    });
    expect(settlements).toHaveLength(1);
    // Hono/undici may wrap the caller's signal, but the canonical request must
    // receive a live signal rather than dropping cancellation altogether.
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
  });

  it('serves Anthropic compaction usage through the real Hono SSE route', async () => {
    const settlements: unknown[] = [];
    const config = {
      ...stubGatewayConfig,
      callerAuth: { async verify() { return {
        ok: true,
        cost: {
          tenantId: 'tenant-1', principalId: 'user-1', source: 'test',
          correlationId: 'stream-request-1',
        },
      }; } },
    };
    const routePlanner: RoutePlanner = {
      async plan() { return {
        planRef: 'plan-stream', expiresAt: '2027-01-01T00:00:00Z',
        candidateRefs: ['candidate-stream'],
        policy: {
          strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
          negativeCacheTtlMs: 300_000, maxAttempts: 1, preferSameTransport: true,
          stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
        },
        councilRevision: 'fixture',
        diagnostics: [{
          candidateRef: 'candidate-stream', diagnosticAccountRef: 'redacted',
          requestedModel: 'claude-opus-5-high', actualProviderId: 'openai',
          actualModelId: 'gpt-5.6-terra', actualTransportProviderId: 'codex',
          reason: 'alias', cacheContinuityRisk: false,
        }],
      }; },
      async prepareAttempt() { return {
        attemptRef: 'attempt-stream',
        async generate() { throw new Error('unused'); },
        async stream() { return { async *[Symbol.asyncIterator]() {
          yield { type: 'content_delta' as const, data: { delta: 'ok' } };
          yield {
            type: 'done' as const,
            data: {
              finishReason: 'stop' as const,
              usage: { inputTokens: 321, outputTokens: 8, totalTokens: 329 },
            },
          };
        } }; },
        async recordOutcome() {}, async markCommitted() {}, async complete() {},
        async releaseCancelled() {},
      }; },
      describeAffinity() { return null; }, promoteAffinity() { throw new Error('unused'); },
      rebindAffinity() { throw new Error('unused'); }, resetAffinity() { return false; },
    };
    const app = createGatewayRouter({
      config, routePlanner,
      routeMetering: { settleRoute(value) { settlements.push(value); } },
    });
    const response = await app.request('/v1/messages', {
      method: 'POST', headers: {
        authorization: 'Bearer gateway-session', 'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5-high', stream: true, max_tokens: 100,
        system: 'Retain the marker BR74.',
        messages: [{ role: 'user', content: 'Continue after compaction.' }],
      }),
    });
    const frames = parseSse(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(JSON.parse(frames[0]!.data).message.usage.input_tokens).toBeGreaterThan(0);
    expect(JSON.parse(frames.at(-2)!.data).usage).toEqual({ output_tokens: 8 });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      usage: { inputTokens: 321, outputTokens: 8, estimated: false },
    });
  });
});
