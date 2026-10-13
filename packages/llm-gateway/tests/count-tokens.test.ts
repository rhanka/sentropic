/**
 * Claude Code token counting — POST /v1/messages/count_tokens (Lot 3).
 *
 * Round 2: the gateway relays authenticated, recognized count requests to a
 * host-owned NativeCountTokensPort (real provider counting — the host owns the
 * provider credential), and returns the provider count verbatim. Without a
 * port the route keeps an explicit provider-shaped refusal so the client falls
 * back to its own local counting: caller-auth gates first (401 pre-pool),
 * unknown models get the frozen unknown-model 404, and no lease is taken and
 * nothing is metered on any count path.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner, type VerifiedRoutingSubject } from '@sentropic/llm-mesh';

import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import {
  CLASSIFIER_BETA, createGatewayRouter, DANGEROUS_TOOL_BETA, GatewayError, NATIVE_BILLING_MASKED_MESSAGE,
  NativeCountTokensRateLimiter, NativeCountUpstreamError, parseNativeErrorDetail,
  PersonalPassthroughCallerAuth, runNativeCountTokens, SAFEGUARDS_NOT_SUPPORTED_MESSAGE,
  stubGatewayConfig, VerifiedCostContextResolver,
  type NativeCountTokensResult,
} from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';
import {
  COUNT_MODEL, countBody, countHarness, sendCount,
} from './fixtures/native-count.js';

/** Refusal body for a count the gateway cannot serve (no port / not countable). */
const NOT_SUPPORTED = {
  type: 'error',
  error: { type: 'invalid_request_error', message: 'Token counting is not supported by this gateway route.' },
};
const NOT_SUPPORTED_FOR_REQUEST = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Token counting is not supported by this gateway route for this request.',
  },
};

const countBodyJson = (model: string): string =>
  JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }] });

/**
 * Planner-mode app: the real mesh planner over a stubbed directory.
 * Recognition must not depend on the executable inventory, so the
 * directory shape models an empty pool, a not-ready pool, an absent
 * `listModels`, and a rejecting `listModels`.
 */
const plannerModeApp = (routePlanner: unknown, settleRoute = vi.fn()) => {
  const verify = vi.fn(() => ({
    tenantId: 't', principalId: 'p', source: 'test', ownerScopeRef: 'enrolled:p',
  }));
  const app = createGatewayRouter({
    config: {
      ...stubGatewayConfig,
      callerAuth: new PersonalPassthroughCallerAuth({
        verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver(),
      }),
    },
    routePlanner: routePlanner as never,
    routeMetering: { settleRoute } as never,
    requestId: () => 'count-tokens-req',
  });
  return { app, settleRoute };
};

const plannerApp = (directory: unknown, settleRoute = vi.fn()) => plannerModeApp(
  new InMemoryRoutePlanner({ directory: directory as never }), settleRoute,
);

const emptyDirectory = { listEligible: async () => [] };
const notReadyDirectory = {
  listEligible: async () => [{
    accountRef: 'internal-cold', diagnosticAccountRef: 'acct_cold',
    targetProviderId: 'anthropic', transportProviderId: 'claude-code',
    supportedModelIds: ['claude-opus-5'],
    enrollmentCompletedAt: '2026-08-01T00:00:00Z',
    readiness: 'reauth-required', revision: 'r1',
  }],
};

const postCount = (
  app: ReturnType<typeof createGatewayRouter>, model: string,
) => app.request('/v1/messages/count_tokens', {
  method: 'POST',
  headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
  body: countBodyJson(model),
});

describe('POST /v1/messages/count_tokens', () => {
  it('is mounted (no bare framework 404) and gates unauthenticated callers', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: countBodyJson('claude-sonnet-4-6'),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('maps an unknown model to the frozen unknown-model 404', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: countBodyJson('no-such-model-xyz'),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "no-such-model-xyz"' },
    });
  });

  it('maps a known model to an explicit count refusal without touching the pool', async () => {
    const transport = new FixtureTransport();
    const { app, metering } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: countBodyJson('claude-sonnet-4-6'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NOT_SUPPORTED);
    // No lease, no metering: the counting path settles nothing.
    expect(metering.settlements).toHaveLength(0);
    expect(transport.seenBodies).toHaveLength(0);
  });

  it('maps malformed JSON to the provider-shaped 400', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: 'not-json{{{',
    });
    expect(res.status).toBe(400);
  });

  it('leaves the Anthropic inference body fixture untouched', async () => {
    // The count endpoint must not alter /v1/messages semantics: the fixture
    // request shape used here still parses, dispatches and relays for inference.
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(anthropicMessageResponse);
    expect(transport.seenBodies).toHaveLength(1);
  });

  describe('planner-mode recognition is account-independent', () => {
    it.each([['empty pool', emptyDirectory], ['not-ready pool', notReadyDirectory]])(
      'maps a known catalog model to the count refusal with a %s',
      async (_label, directory) => {
        const { app, settleRoute } = plannerApp(directory);
        const res = await postCount(app, 'claude-opus-5');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(NOT_SUPPORTED);
        expect(settleRoute).not.toHaveBeenCalled();
      },
    );

    it('maps a known alias to the count refusal with an empty pool', async () => {
      const { app } = plannerApp(emptyDirectory);
      const res = await postCount(app, 'mistral-medium-3.5');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(NOT_SUPPORTED);
    });

    it.each([['empty pool', emptyDirectory], ['not-ready pool', notReadyDirectory]])(
      'maps an unknown ID to 404 with a %s',
      async (_label, directory) => {
        const { app } = plannerApp(directory);
        const res = await postCount(app, 'no-such-model-xyz');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          type: 'error',
          error: { type: 'not_found_error', message: 'Unknown model: "no-such-model-xyz"' },
        });
      },
    );

    it('ignores an absent or rejecting inventory', async () => {
      // Recognition never reads `listModels`: directory health cannot flip
      // the known/unknown verdict in either direction.
      const planners = [
        {},
        { listModels: async () => { throw new Error('keyring down'); } },
      ];
      for (const routePlanner of planners) {
        const known = plannerModeApp(routePlanner);
        expect((await postCount(known.app, 'claude-opus-5')).status).toBe(400);
        const unknown = plannerModeApp(routePlanner);
        expect((await postCount(unknown.app, 'no-such-model-xyz')).status).toBe(404);
      }
    });
  });

  describe('native count relay (host-owned port)', () => {
    it('returns the provider count verbatim for an authenticated, recognized request', async () => {
      const h = countHarness();
      const res = await sendCount(h, countBody({
        system: 'You are a test harness.',
        tools: [{ name: 'echo', description: 'echo', input_schema: { type: 'object' } }],
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-sentropic-request-id')).toBe('count-req');
      expect(await res.json()).toEqual({ input_tokens: 17 });
      // No lease, no metering, no inference dispatch: counting only.
      expect(h.h.metering.settlements).toHaveLength(0);
      expect(h.transport.seenBodies).toHaveLength(0);
    });

    it('forwards the full Anthropic Messages body — messages, system, tools — to the port', async () => {
      const h = countHarness();
      const body = countBody({
        system: [{ type: 'text', text: 'be brief' }],
        tools: [{
          name: 'get_weather',
          description: 'weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        }],
        tool_choice: { type: 'auto' },
        temperature: 0.2,
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });
      const res = await sendCount(h, body);
      expect(res.status).toBe(200);
      expect(h.prepare).toHaveBeenCalledTimes(1);
      const [subject, input] = h.prepare.mock.calls[0]!;
      expect((subject as VerifiedRoutingSubject).principalRef).toBeTruthy();
      expect(input.modelId).toBe(COUNT_MODEL);
      expect(h.execute).toHaveBeenCalledTimes(1);
      expect(h.execute.mock.calls[0]![0].body).toEqual(body);
    });

    it('drops caller auth headers and forwards only allowlisted anthropic headers', async () => {
      const h = countHarness();
      // Anthropic-SDK-style caller: x-api-key auth, no Authorization header.
      const res = await Promise.resolve(h.app.request('/v1/messages/count_tokens', {
        method: 'POST',
        body: JSON.stringify(countBody()),
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-user-a',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'context-management-2025-06-27',
          'x-stainless-timeout': '20',
          'x-sentropic-internal': 'never-forwarded',
        },
      }));
      expect(res.status).toBe(200);
      const forwarded = h.execute.mock.calls[0]![0].headers.forwarded;
      expect(forwarded['anthropic-version']).toBe('2023-06-01');
      expect(forwarded['anthropic-beta']).toBe('context-management-2025-06-27');
      expect(forwarded['x-stainless-timeout']).toBe('20');
      expect(Object.keys(forwarded).some((name) => name.startsWith('x-sentropic-'))).toBe(false);
      expect(forwarded.authorization).toBeUndefined();
      expect(forwarded['x-api-key']).toBeUndefined();
      expect(h.execute.mock.calls[0]![0].headers.anthropicVersion).toBe('2023-06-01');
    });

    it('keeps the frozen unknown-model 404 and caller auth ahead of the port', async () => {
      const h = countHarness();
      const unknown = await sendCount(h, { model: 'no-such-model-xyz', messages: [] });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({
        type: 'error',
        error: { type: 'not_found_error', message: 'Unknown model: "no-such-model-xyz"' },
      });
      expect(h.prepare).not.toHaveBeenCalled();
      const denied = await Promise.resolve(h.app.request('/v1/messages/count_tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(countBody()),
      }));
      expect(denied.status).toBe(401);
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.execute).not.toHaveBeenCalled();
    });

    it('refuses safeguards and uncountable capabilities without dispatching', async () => {
      const h = countHarness();
      const safeguards = await sendCount(h, countBody({ safeguards: {} }));
      expect(safeguards.status).toBe(400);
      expect(await safeguards.json()).toEqual({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'safeguards is not supported by this gateway route; retry without safeguards.',
        },
      });
      for (const [label, mutate] of [
        ['prepare returns undefined', (hh: ReturnType<typeof countHarness>) => {
          hh.prepare.mockResolvedValue(undefined);
        }],
        ['model not in the port allowlist', (hh: ReturnType<typeof countHarness>) => {
          (hh.port.modelIds as string[]).length = 0;
        }],
        ['capability names another model', (hh: ReturnType<typeof countHarness>) => {
          hh.prepare.mockResolvedValue({ ...hh.capability, modelId: 'other-model' });
        }],
        ['caller anthropic-version unsupported', undefined as never],
      ] as const) {
        const variant = countHarness();
        if (mutate) mutate(variant);
        const res = await sendCount(variant, countBody(), label === 'caller anthropic-version unsupported'
          ? { 'anthropic-version': 'unsupported' } : {});
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(NOT_SUPPORTED_FOR_REQUEST);
        expect(variant.execute).not.toHaveBeenCalled();
      }
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.execute).not.toHaveBeenCalled();
    });

    it('maps upstream count failures to provider-shaped errors', async () => {
      const h = countHarness();
      h.execute.mockRejectedValueOnce(new NativeCountUpstreamError({
        status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited upstream' } },
        headers: { 'Retry-After': '7' },
      }));
      const limited = await sendCount(h);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('7');
      expect(await limited.json()).toEqual({
        type: 'error', error: { type: 'rate_limit_error', message: 'rate limited upstream' },
      });
      h.execute.mockRejectedValueOnce(new NativeCountUpstreamError({
        status: 503, body: { type: 'error', error: { type: 'api_error', message: 'upstream unavailable' } },
      }));
      const down = await sendCount(h);
      expect(down.status).toBe(503);
      expect(await down.json()).toEqual({
        type: 'error', error: { type: 'api_error', message: 'upstream unavailable' },
      });
      // Nothing settles on failure either.
      expect(h.h.metering.settlements).toHaveLength(0);
    });

    it('fails closed on a malformed provider count', async () => {
      for (const malformed of [{ input_tokens: -1 }, { input_tokens: 1.5 }, { other: true }]) {
        const h = countHarness({}, async () => ({ kind: 'json', status: 200, headers: {}, body: malformed }));
        const res = await sendCount(h);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({
          type: 'error', error: { type: 'api_error', message: 'counting service temporarily unavailable' },
        });
      }
    });

    it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', undefined, null, NaN, Infinity])(
      'rejects invalid successful input_tokens %s without dispatch side effects', async inputTokens => {
        const h = countHarness({}, async () => ({ kind: 'json', status: 200, headers: {},
          body: { input_tokens: inputTokens } }));
        const res = await sendCount(h);
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({
          type: 'error', error: { type: 'api_error', message: 'counting service temporarily unavailable' },
        });
        expect(res.headers.has('x-sentropic-relay')).toBe(false);
        expect(h.h.metering.settlements).toHaveLength(0);
      });

    it('clones only the top level, preserves nested identity and prepares exactly once', async () => {
      // Direct call (no JSON round-trip): identity only holds before parsing.
      const h = countHarness();
      const body = Object.freeze({ model: COUNT_MODEL, messages: [{ role: 'user', content: 'ping' }],
        system: [{ text: 'system' }], tools: [{ name: 'tool', future: ['unknown'] }], unknown: { ordered: [2, 1] } });
      const before = JSON.stringify(body);
      const signal = new AbortController().signal;
      const cost = { tenantId: 't', principalId: 'p', source: 'test', correlationId: 'c' };
      const result = await runNativeCountTokens({ port: h.port, rate: h.rate },
        { body, cost, headers: {}, signal, requestId: 'server-id' });
      const sent = h.execute.mock.calls[0]![0];
      expect(sent.body).toEqual(body);
      expect(sent.body).not.toBe(body);
      for (const key of ['messages', 'system', 'tools', 'unknown']) {
        expect(sent.body[key]).toBe(body[key as keyof typeof body]);
      }
      expect(JSON.stringify(body)).toBe(before);
      expect(Object.keys(sent.body).sort()).toEqual(Object.keys(body).sort());
      expect(sent).toEqual({ body, signal, requestId: 'server-id',
        headers: { forwarded: {}, anthropicVersion: '2023-06-01' } });
      expect(result).toBe(await h.execute.mock.results[0]!.value);
      expect(h.prepare).toHaveBeenCalledTimes(1);
    });

    it('counts version-only requests with no beta, stream or ceiling insertion', async () => {
      const h = countHarness();
      const body = { model: COUNT_MODEL, messages: [], future: { kept: true } };
      const res = await sendCount(h, body, { 'anthropic-version': '2023-06-01' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ input_tokens: 17 });
      expect(h.execute.mock.calls[0]![0].body).toEqual(body);
      expect(h.execute.mock.calls[0]![0].headers.forwarded).toEqual({ 'anthropic-version': '2023-06-01' });
      expect(res.headers.get('x-sentropic-relay')).toBe('native');
      expect(res.headers.has('x-sentropic-served')).toBe(false);
    });

    it('keeps supplied stream/ceiling fields opaque and always responds with JSON', async () => {
      const h = countHarness();
      const body = { model: COUNT_MODEL, stream: true, max_tokens: 'upstream-validates', future: [1] };
      const res = await sendCount(h, body);
      expect(h.execute.mock.calls[0]![0].body).toEqual(body);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
    });

    it('refuses a Connection-nominated version instead of silently replacing it', async () => {
      const h = countHarness();
      const res = await sendCount(h, countBody(), { connection: 'Anthropic-Version', 'anthropic-version': '2023-06-01' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(NOT_SUPPORTED_FOR_REQUEST);
      expect(h.execute).not.toHaveBeenCalled();
    });

    it.each([{ kind: 'stream' }, { status: 201 }, { body: [] }, { headers: null },
      { headers: { secret: 3 } }])('rejects malformed successful envelopes %j', async patch => {
      const h = countHarness({}, async () => ({ kind: 'json', status: 200, headers: {},
        body: { input_tokens: 2 }, ...patch }) as unknown as NativeCountTokensResult);
      const res = await sendCount(h);
      expect(h.execute).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        type: 'error', error: { type: 'api_error', message: 'counting service temporarily unavailable' },
      });
      expect(h.h.metering.settlements).toHaveLength(0);
    });

    it('never plans, quotes or meters on the count path', async () => {
      const h = countHarness();
      await sendCount(h);
      await sendCount(h, countBody(), {}, undefined).catch(() => undefined);
      expect(h.h.metering.settlements).toHaveLength(0);
      expect(h.transport.seenBodies).toHaveLength(0);
      expect(h.prepare).toHaveBeenCalledTimes(2);
    });

    describe('native count mount parity (N24 rows 47/48b)', () => {
      it('marks native count success with the relay marker and native response exclusions', async () => {
        const h = countHarness({}, async () => ({
          kind: 'json', status: 200, headers: {
            'anthropic-organization-id': 'accepted-org', 'anthropic-future': 'kept', 'request-id': 'upstream-id',
            connection: 'anthropic-hop', 'anthropic-hop': 'dropped', authorization: 'secret', 'set-cookie': 'secret',
            'content-length': '9999', 'unlisted-response': 'dropped',
          }, body: { input_tokens: 123 },
        }));
        const res = await sendCount(h);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ input_tokens: 123 });
        expect(res.headers.get('x-sentropic-relay')).toBe('native');
        expect(res.headers.get('x-sentropic-request-id')).toBe('count-req');
        expect(res.headers.get('anthropic-organization-id')).toBe('accepted-org');
        expect(res.headers.get('anthropic-future')).toBe('kept');
        expect(res.headers.get('request-id')).toBe('upstream-id');
        for (const name of ['anthropic-hop', 'authorization', 'set-cookie', 'content-length',
          'unlisted-response', 'connection']) {
          expect(res.headers.has(name)).toBe(false);
        }
      });

      it('refuses the count when the cross-user partition is disabled, before the port', async () => {
        const h = countHarness();
        Object.assign(h.h.config, { mode: 'cross-user-pool', crossUserPoolEnabled: false });
        const res = await sendCount(h);
        expect(res.status).toBe(400);
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.execute).not.toHaveBeenCalled();
      });

      it.each([null, [], {}, { model: '' }, { model: 2 }])('rejects a malformed count body %j before the port', async body => {
        const h = countHarness();
        const res = await sendCount(h, body);
        expect(res.status).toBe(400);
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.execute).not.toHaveBeenCalled();
      });

      it('refuses a capability from another provider without dispatching', async () => {
        const h = countHarness();
        h.prepare.mockResolvedValue({ ...h.capability, providerId: 'openai' });
        const res = await sendCount(h);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(NOT_SUPPORTED_FOR_REQUEST);
        expect(h.execute).not.toHaveBeenCalled();
      });

      it('keeps a port-reported unknown model at the frozen 404', async () => {
        const h = countHarness();
        // Recognized by the catalog, rejected by the port: the rejection —
        // not the catalog verdict — must still surface the frozen 404.
        h.prepare.mockRejectedValue(new GatewayError('unknown-model', 'secret catalog'));
        const res = await sendCount(h);
        expect(h.prepare).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          type: 'error',
          error: { type: 'not_found_error', message: `Unknown model: "${COUNT_MODEL}"` },
        });
        expect(h.execute).not.toHaveBeenCalled();
      });
    });

    it('applies the per-principal count rate limit with Retry-After', async () => {
      const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, now: () => 0 });
      const h = countHarness({ nativeCountRate: rate });
      expect((await sendCount(h)).status).toBe(200);
      const blocked = await sendCount(h);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBe('1');
      expect(await blocked.json()).toEqual({
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Token counting request limit exceeded.' },
      });
      expect(h.execute).toHaveBeenCalledTimes(1);
      expect(h.h.metering.settlements).toHaveLength(0);
    });

    describe('count native errors are terminal and sanitized (N24 rows 48c/48c2)', () => {
      it.each([
        ['messages.0.content.0.clear_at: invalid value', undefined, 'messages.0.content.0.clear_at: invalid value'],
        [`Unsupported beta: ${DANGEROUS_TOOL_BETA}`, DANGEROUS_TOOL_BETA, `Unsupported beta: ${DANGEROUS_TOOL_BETA}`],
        [`Unexpected value(s) ${CLASSIFIER_BETA} for the anthropic-beta header`, CLASSIFIER_BETA,
          `Unexpected value(s) ${CLASSIFIER_BETA} for the anthropic-beta header`],
        [`Unsupported beta: ${CLASSIFIER_BETA}`, 'other-beta', `Unsupported beta: ${CLASSIFIER_BETA}`],
        ['Your credit balance is too low; purchase credits', undefined, NATIVE_BILLING_MASKED_MESSAGE],
        ['Your organization does not have access to fallback-credit-2026-06-01', undefined,
          'Your organization does not have access to fallback-credit-2026-06-01'],
        ['bad\u0000 field\nvalue', undefined, 'bad fieldvalue'],
      ] as const)('reuses bounded native validation policy: %s', async (message, beta, expected) => {
        const h = countHarness({}, async request => {
          const validation = parseNativeErrorDetail(JSON.stringify({ error: { type: 'invalid_request_error', message } }), 400,
            { requestSafeguards: Object.hasOwn(request.body, 'safeguards'), sentBetas: [request.headers.forwarded['anthropic-beta'] ?? ''] });
          throw new NativeMessagesUpstreamError({ status: 400, type: 'invalid_request_error', validation });
        });
        const res = await sendCount(h, countBody(), beta === undefined ? {} : { 'anthropic-beta': beta });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ type: 'error',
          error: { type: 'invalid_request_error', message: expected } });
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(res.headers.has('x-sentropic-relay')).toBe(false);
        expect(h.h.metering.settlements).toHaveLength(0);
      });

      it('prefers the safeguards refusal over a safeguards-related upstream validation error', async () => {
        // W fail-closed deviation: safeguards never reach the port, so the
        // classifier rewrite (which needs requestSafeguards) cannot be
        // observed on the count path — the refusal preempts dispatch.
        const h = countHarness({}, async () => {
          throw new NativeMessagesUpstreamError({ status: 400, type: 'invalid_request_error',
            validation: parseNativeErrorDetail(JSON.stringify({ error: { type: 'invalid_request_error',
              message: `Unexpected value(s) ${CLASSIFIER_BETA} for the anthropic-beta header` } }), 400,
              { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA] }) });
        });
        const res = await sendCount(h, countBody({ safeguards: {} }), { 'anthropic-beta': CLASSIFIER_BETA });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ type: 'error',
          error: { type: 'invalid_request_error', message: SAFEGUARDS_NOT_SUPPORTED_MESSAGE } });
        expect(h.execute).not.toHaveBeenCalled();
      });

      it.each([401, 403, 404, 413, 429, 500, 503, 529])('makes one call for upstream %s with no error-header forwarding', async status => {
        const h = countHarness({}, async () => {
          const error = new NativeMessagesUpstreamError({ status, retryAfterMs: 2500,
            ...(status === 413 ? { requestSize: { requestBytes: 50, limitBytes: 32, source: 'gateway' as const, sizeIsLowerBound: false } } : {}) });
          Object.assign(error, { headers: { 'anthropic-organization-id': 'secret-org', 'x-sentropic-request-id': 'spoof',
            'set-cookie': 'secret-cookie', 'retry-after': '999' } });
          throw error;
        });
        const res = await sendCount(h);
        const expectedStatus = status === 403 ? 401 : status >= 500 ? 503 : status;
        expect(res.status).toBe(expectedStatus);
        const body = await res.json() as { error: { type: string; message: string } };
        expect(body.error.type).toBe(status === 401 || status === 403 ? 'authentication_error'
          : status === 404 ? 'not_found_error' : status === 413 ? 'request_too_large'
            : status === 429 ? 'rate_limit_error' : 'overloaded_error');
        if (status === 413) expect(body.error.message).toBe('Request size 50 bytes exceeds limit 32 bytes.');
        if (status === 404) expect(body.error.message).toBe(`Unknown model: ${JSON.stringify(COUNT_MODEL)}`);
        expect(res.headers.get('retry-after')).toBe(status === 429 ? '3' : null);
        expect(res.headers.get('x-should-retry')).toBe(status === 413 ? 'false' : null);
        expect(res.headers.get('x-sentropic-request-id')).toBe('count-req');
        for (const name of ['anthropic-organization-id', 'set-cookie', 'x-sentropic-relay', 'x-sentropic-served']) {
          expect(res.headers.has(name)).toBe(false);
        }
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(h.transport.seenBodies).toHaveLength(0);
        expect(h.h.metering.settlements).toHaveLength(0);
      });
    });

    describe('count HTTP limits and absence of generation side effects (N24 rows 49-2/49-2b)', () => {
      const deferred = () => {
        let resolve!: () => void;
        const promise = new Promise<void>(done => { resolve = done; });
        return { promise, resolve };
      };
      const noGeneration = (h: ReturnType<typeof countHarness>) => {
        expect(h.h.metering.settlements).toHaveLength(0);
        expect(h.transport.seenBodies).toHaveLength(0);
      };

      it('shares the default two-live-call limit across router instances and restores concurrency', async () => {
        const entered = deferred();
        const done = deferred();
        let calls = 0;
        const h = countHarness({ nativeCountRate: undefined }, async () => {
          if (++calls === 2) entered.resolve();
          await done.promise;
          return { kind: 'json', status: 200, headers: {}, body: { input_tokens: 999_999 } };
        });
        const other = { ...h, app: createGatewayRouter(h.options) };
        const first = sendCount(h);
        const second = sendCount(other);
        await entered.promise;
        const excess = await sendCount(other);
        expect(excess.status).toBe(429);
        expect(excess.headers.get('retry-after')).toBe('1');
        expect(await excess.json()).toEqual({ type: 'error', error: { type: 'rate_limit_error',
          message: 'Token counting request limit exceeded.' } });
        expect(h.execute).toHaveBeenCalledTimes(2);
        done.resolve();
        expect((await first).status).toBe(200);
        expect((await second).status).toBe(200);
        expect((await sendCount(other)).status).toBe(200);
        noGeneration(h);
      });

      it('charges dispatch tokens despite cancellation and releases concurrency without a generation event', async () => {
        const entered = deferred();
        let now = 0;
        const abort = new AbortController();
        const rate = new NativeCountTokensRateLimiter({ capacity: 1, now: () => now });
        const h = countHarness({ nativeCountRate: rate }, async request => {
          entered.resolve();
          await new Promise<void>((_, reject) => request.signal.addEventListener('abort',
            () => reject(request.signal.reason), { once: true }));
          throw new Error('unexpected count continuation');
        });
        const pending = sendCount(h, countBody(), {}, abort.signal);
        await entered.promise;
        abort.abort(new Error('cancelled'));
        expect((await pending).status).toBe(503);
        expect((await sendCount(h)).status).toBe(429);
        expect(h.execute).toHaveBeenCalledTimes(1);
        h.execute.mockResolvedValue({ kind: 'json', status: 200, headers: {}, body: { input_tokens: 2 } });
        now = 1000;
        expect((await sendCount(h)).status).toBe(200);
        noGeneration(h);
      });

      it('charges failed dispatches, but does not consume tokens for eligibility refusals', async () => {
        const rate = new NativeCountTokensRateLimiter({ capacity: 1, now: () => 0 });
        const h = countHarness({ nativeCountRate: rate }, async () => { throw new Error('transport secret'); });
        expect((await sendCount(h, countBody(), { 'anthropic-version': 'unsupported' })).status).toBe(400);
        expect((await sendCount(h)).status).toBe(503);
        expect((await sendCount(h)).status).toBe(429);
        expect(h.execute).toHaveBeenCalledTimes(1);
        noGeneration(h);
      });

      it('fails closed for a new authenticated principal when the active map is full, before upstream call', async () => {
        const rate = new NativeCountTokensRateLimiter({ maxKeys: 1, now: () => 0 });
        const h = countHarness({ nativeCountRate: rate });
        expect((await sendCount(h)).status).toBe(200);
        const res = await Promise.resolve(h.app.request('/v1/messages/count_tokens', {
          method: 'POST',
          body: JSON.stringify(countBody()),
          headers: { 'content-type': 'application/json', authorization: 'Bearer valid-other' },
        }));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ type: 'error', error: { type: 'overloaded_error',
          message: 'account service temporarily unavailable' } });
        expect(h.execute).toHaveBeenCalledTimes(1);
        noGeneration(h);
      });

      it('uses verified identity for limits despite caller-owned tenant, principal, workspace and auth fields', async () => {
        const rate = new NativeCountTokensRateLimiter({ capacity: 1, now: () => 0 });
        const h = countHarness({ nativeCountRate: rate });
        expect((await sendCount(h)).status).toBe(200);
        const forged = { ...countBody(), tenantId: 'other', principalId: 'other', workspaceId: 'other',
          cost: { tenantId: 'other', principalId: 'other' }, authContext: { requestId: 'spoof' } };
        expect((await sendCount(h, forged)).status).toBe(429);
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(h.prepare.mock.calls[1]![0]).toEqual(h.prepare.mock.calls[0]![0]);
        noGeneration(h);
      });
    });
  });
});
