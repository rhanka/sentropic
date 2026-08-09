/**
 * Lot-2: GET /v1/models (spec §3) — caller/pool-policy filtered, from the pool
 * snapshot. Asserts an authenticated caller gets the distinct model ids the
 * personal pool can serve, and that NO account ids/tokens leak. Also the
 * never-zero usage estimate (spec §5).
 */

import { describe, expect, it } from 'vitest';
import type { VerifiedRoutingSubject } from '@sentropic/llm-mesh';

import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness, claudeCodePool } from './fixtures/harness.js';
import { anthropicRequest } from './fixtures/anthropic.js';

describe('GET /v1/models', () => {
  it('lists the personal pool models for an authenticated caller', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport, accounts: claudeCodePool() });
    const res = await app.request('/v1/models', { headers: authHeaders('user-a') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      data: { id: string; object: string; owned_by: string }[];
    };
    expect(body.object).toBe('list');
    const ids = body.data.map((m) => m.id).sort();
    expect(ids).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(body.data.every((m) => m.owned_by === 'anthropic')).toBe(true);
    // No account ids/tokens.
    const text = JSON.stringify(body);
    expect(text).not.toContain('acct-alpha');
    expect(text).not.toContain('SECRET');
  });

  it('uses owner-scoped mesh inventory in route mode instead of the legacy pool', async () => {
    const { createGatewayRouter, stubGatewayConfig } = await import('../src/index.js');
    const app = createGatewayRouter({
      config: {
        ...stubGatewayConfig,
        callerAuth: { async verify() { return {
          ok: true as const,
          cost: {
            tenantId: 'tenant-a', principalId: 'session-a', ownerScopeRef: 'owner-a',
            source: 'test', correlationId: 'request-a',
          },
        }; } },
        pool: {
          ...stubGatewayConfig.pool,
          async snapshotModels() { throw new Error('legacy pool must not be queried'); },
        },
      },
      routePlanner: {
        async listModels(subject: VerifiedRoutingSubject) {
          expect(subject).toEqual({ principalRef: 'session-a', ownerScopeRef: 'owner-a' });
          return [{ modelId: 'gpt-5.6-terra', providerId: 'openai' }];
        },
      } as never,
      routeMetering: { settleRoute() {} },
    });

    const res = await app.request('/v1/models', { headers: authHeaders('user-a') });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: [{ id: 'gpt-5.6-terra', owned_by: 'openai' }],
    });
  });

  it('returns 401 for an unauthenticated caller (never the pool)', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/models');
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain('claude-sonnet-4-6');
  });
});

describe('never-zero usage estimate (spec §5)', () => {
  it('settles with an estimate when the provider reports no usage', async () => {
    const transport = new FixtureTransport({
      // Provider response WITHOUT a usage block.
      jsonResponse: {
        status: 200,
        body: { id: 'msg_x', type: 'message', role: 'assistant', content: [] },
      },
    });
    const { app, metering, config } = buildHarness({ transport });
    // Rebuild a router with an estimator so missing usage falls back to it.
    const { createGatewayRouter, createStaticTargetResolver } = await import('../src/index.js');
    const estimatingApp = createGatewayRouter({
      config,
      resolveTarget: createStaticTargetResolver({
        mappings: {
          'claude-sonnet-4-6': {
            providerId: 'anthropic',
            transportProviderId: 'claude-code',
            model: 'claude-sonnet-4-6',
          },
        },
      }),
      metering,
      estimateUsage: () => ({ inputTokens: 7, outputTokens: 3, estimated: true }),
      requestId: () => 'req_fixture_id',
    });
    void app;

    await estimatingApp.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    const settle = metering.last;
    expect(settle?.usage).toEqual({ inputTokens: 7, outputTokens: 3, estimated: true });
  });
});
