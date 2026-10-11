/**
 * Claude Code token counting — POST /v1/messages/count_tokens (Lot 3).
 *
 * Claude Code calls the Anthropic count_tokens endpoint. The gateway has no
 * provider count seam, so it maps the call properly instead of answering a
 * bare framework 404: caller-auth gates first (401 pre-pool), unknown models
 * get the frozen unknown-model 404, and known models get a provider-shaped
 * 400 (the client falls back to its own local counting). No lease is taken
 * and nothing is metered — counting support is absent, never silent.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner } from '@sentropic/llm-mesh';

import {
  createGatewayRouter, PersonalPassthroughCallerAuth, stubGatewayConfig,
  VerifiedCostContextResolver,
} from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { anthropicRequest } from './fixtures/anthropic.js';

const countBody = (model: string): string =>
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
  body: countBody(model),
});

describe('POST /v1/messages/count_tokens', () => {
  it('is mounted (no bare framework 404) and gates unauthenticated callers', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: countBody('claude-sonnet-4-6'),
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
      body: countBody('no-such-model-xyz'),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "no-such-model-xyz"' },
    });
  });

  it('maps a known model to a provider-shaped 400 without touching the pool', async () => {
    const transport = new FixtureTransport();
    const { app, metering } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: countBody('claude-sonnet-4-6'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'invalid request' },
    });
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
      'maps a known catalog model to 400 with a %s',
      async (_label, directory) => {
        const { app, settleRoute } = plannerApp(directory);
        const res = await postCount(app, 'claude-opus-5');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'invalid request' },
        });
        expect(settleRoute).not.toHaveBeenCalled();
      },
    );

    it('maps a known alias to 400 with an empty pool', async () => {
      const { app } = plannerApp(emptyDirectory);
      const res = await postCount(app, 'mistral-medium-3.5');
      expect(res.status).toBe(400);
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
});
