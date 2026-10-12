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

import {
  createGatewayRouter, NativeCountTokensRateLimiter, NativeCountUpstreamError,
  PersonalPassthroughCallerAuth, stubGatewayConfig, VerifiedCostContextResolver,
} from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { anthropicRequest } from './fixtures/anthropic.js';
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
    // request shape used here stays valid for inference.
    expect((anthropicRequest(false) as { model: unknown }).model).toBeTruthy();
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

    it('never plans, quotes or meters on the count path', async () => {
      const h = countHarness();
      await sendCount(h);
      await sendCount(h, countBody(), {}, undefined).catch(() => undefined);
      expect(h.h.metering.settlements).toHaveLength(0);
      expect(h.transport.seenBodies).toHaveLength(0);
      expect(h.prepare).toHaveBeenCalledTimes(2);
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
  });
});
