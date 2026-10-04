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
import { nativeHarness, nativeChunks, nativeFrame, nativeStart, sendNative } from './fixtures/native-flow.js';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';

const buildApp = () => createGatewayRouter({ config: stubGatewayConfig });

describe('native router isolation and bytes', () => {
  const excluded = ['authorization', 'x-api-key', 'api-key', 'anthropic-api-key',
    'anthropic-admin-api-key', 'anthropic-oauth-token', 'anthropic-key', 'cookie', 'cookie2',
    'set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'proxy-connection', 'te', 'trailer',
    'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
    'x-sentropic-request-id', 'x-sentropic-served', 'x-sentropic-relay', 'x-sentropic-future',
    'x-account', 'x-forwarded-for', 'content-length', 'content-encoding', 'x-accel-buffering',
    'anthropic-nominated', 'request-id'];
  it.each([false, true])('filters response authority before emitting own headers (stream=%s)', async stream => {
    const bytes = [new TextEncoder().encode(': comment ☃\r\n\r\n'), nativeStart('claude-sonnet-5'),
      nativeFrame('message_delta', { delta: { safeguard_results: { unknown: ['雪'] } }, usage: { output_tokens: 3 } }),
      nativeFrame('message_stop')];
    const headers = { ...Object.fromEntries(excluded.map(name => [name.toUpperCase(), 'UPSTREAM-SECRET'])),
      Connection: 'Anthropic-Nominated, Request-Id', 'Anthropic-Organization-Id': 'org-shared',
      'Anthropic-Future': 'kept', 'X-Request-Id': 'safe-upstream' };
    const h = nativeHarness({ execute: async () => stream
      ? { kind: 'stream', status: 200, headers, body: nativeChunks(bytes) }
      : { kind: 'json', status: 200, headers, body: { model: 'claude-sonnet-5', safeguard_results: { unknown: true } } } });
    const response = await sendNative(h, stream);
    expect(response.status).toBe(200);
    expect(response.headers.get('anthropic-organization-id')).toBe('org-shared');
    expect(response.headers.get('anthropic-future')).toBe('kept');
    expect(response.headers.get('x-request-id')).toBe('safe-upstream');
    expect(response.headers.get('x-sentropic-request-id')).toBe('req-native');
    expect(response.headers.get('x-sentropic-relay')).toBe('native');
    for (const name of excluded) expect(response.headers.get(name) ?? '').not.toContain('UPSTREAM-SECRET');
    if (stream) {
      expect(response.headers.has('x-sentropic-served')).toBe(false);
      expect(response.headers.get('x-accel-buffering')).toBe('no');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(Buffer.concat(bytes)));
    } else expect(response.headers.get('x-sentropic-served')).toContain('model=claude-sonnet-5');
    expect(h.recorder.settlements).toHaveLength(1);
  });
  it.each([false, true])('exposes no success headers on native validation refusal (stream=%s)', async stream => {
    const h = nativeHarness({ execute: async () => { throw new NativeMessagesUpstreamError({ status: 400,
      type: 'invalid_request_error', validation: { type: 'invalid_request_error', message: 'Invalid tool field.' } }); } });
    const response = await sendNative(h, stream);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid tool field.' } });
    for (const name of ['x-sentropic-relay', 'x-sentropic-served', 'anthropic-organization-id', 'x-accel-buffering']) {
      expect(response.headers.has(name)).toBe(false);
    }
  });
});

describe('@sentropic/llm-gateway router (v0 scaffold)', () => {
  const createOpenAiRoutePlanner = (
    actualTransportProviderId: string,
    options?: {
      onGenerate?: (request: { signal?: AbortSignal }) => void;
    },
  ): RoutePlanner => ({
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
        actualModelId: 'gpt-5.6-terra', actualTransportProviderId,
        reason: 'alias', cacheContinuityRisk: false,
      }],
    }; },
    async prepareAttempt() { return {
      attemptRef: 'attempt-1',
      async generate(request) {
        options?.onGenerate?.(request);
        return {
          id: 'response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
          message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [],
          finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 },
        };
      },
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
  });

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
        ok: true as const,
        cost: {
          tenantId: 'tenant-1', principalId: 'user-1', source: 'test', correlationId: 'request-1',
        },
      }; } },
    };
    const routePlanner = createOpenAiRoutePlanner('codex', {
      onGenerate: (request) => {
        observedSignal = request.signal;
      },
    });
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
    expect(response.headers.get('X-Sentropic-Served'))
      .toBe('provider=openai; model=gpt-5.6-terra; transport=codex');
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
        ok: true as const,
        cost: {
          tenantId: 'tenant-1', principalId: 'user-1', source: 'test',
          correlationId: 'stream-request-1',
        },
      }; } },
    };
    const routePlanner = createOpenAiRoutePlanner('codex');
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
    expect(response.headers.get('X-Sentropic-Served'))
      .toBe('provider=openai; model=gpt-5.6-terra; transport=codex');
    expect(JSON.parse(frames[0]!.data).message.usage.input_tokens).toBeGreaterThan(0);
    expect(JSON.parse(frames.at(-2)!.data).usage).toEqual({ output_tokens: 8 });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      usage: { inputTokens: 321, outputTokens: 8, estimated: false },
    });
  });

  it('distinguishes different transports for the same served provider/model', async () => {
    const runMeshRequest = async (transportProviderId: string): Promise<string> => {
      const settlements: unknown[] = [];
      const config = {
        ...stubGatewayConfig,
        callerAuth: { async verify() { return {
          ok: true as const,
          cost: {
            tenantId: 'tenant-1', principalId: 'user-1', source: 'test',
            correlationId: `transport-${transportProviderId}`,
          },
        }; } },
      };
      const app = createGatewayRouter({
        config,
        routePlanner: createOpenAiRoutePlanner(transportProviderId),
        routeMetering: { settleRoute(value) { settlements.push(value); } },
      });

      const response = await app.request('/v1/messages', {
        method: 'POST', headers: { authorization: 'Bearer gateway-session' },
        body: JSON.stringify({
          model: 'claude-opus-5-high', max_tokens: 100,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      expect(response.status).toBe(200);
      expect(settlements).toHaveLength(1);
      return response.headers.get('X-Sentropic-Served') ?? '';
    };

    const codexServed = await runMeshRequest('codex');
    const cloudCodeServed = await runMeshRequest('cloud-code');
    expect(codexServed).toBe('provider=openai; model=gpt-5.6-terra; transport=codex');
    expect(cloudCodeServed).toBe('provider=openai; model=gpt-5.6-terra; transport=cloud-code');
    expect(codexServed).not.toBe(cloudCodeServed);
  });
});
