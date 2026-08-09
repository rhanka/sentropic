import type { RoutePlanInput, RoutePlanner, VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { classifyRouteError, prepareRouteFlow } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';

describe('route flow core', () => {
  it('derives routing ownership only from verified caller state', async () => {
    let captured: { subject: VerifiedRoutingSubject; input: RoutePlanInput } | undefined;
    const routePlanner = {
      async plan(subject: VerifiedRoutingSubject, input: RoutePlanInput) {
        captured = { subject, input };
        return {
          planRef: 'plan-1', expiresAt: '2026-08-08T12:01:00Z', candidateRefs: [],
          policy: {
            strategy: { kind: 'last-enrolled' }, rules: [], fallbackMode: 'retest-preferred',
            negativeCacheTtlMs: 300_000, maxAttempts: 3, preferSameTransport: true,
            stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
          },
          councilRevision: 'fixture', diagnostics: [],
        };
      },
    } as unknown as RoutePlanner;
    const config = {
      ...stubGatewayConfig,
      callerAuth: { async verify() {
        return {
          ok: true,
          cost: {
            tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
            source: 'test', correlationId: 'session-1',
          },
        };
      } },
    };

    await prepareRouteFlow({
      config, routePlanner, metering: { settleRoute() {} },
    }, {
      wire: 'openai-chat-completions', headers: {}, model: 'gpt-5.6-terra', stream: false,
      body: {
        model: 'gpt-5.6-terra', ownerScopeRef: 'attacker',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(captured).toMatchObject({
      subject: { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' },
      input: {
        requestedModel: 'gpt-5.6-terra', workspaceId: 'workspace-1', affinityKey: 'session-1',
      },
    });
    expect(JSON.stringify(captured)).not.toContain('attacker');
  });

  it('classifies retryable availability without making auth retryable', () => {
    expect(classifyRouteError({ status: 429, retryAfterMs: 42_000 })).toEqual({
      reason: 'rate-limited', retryable: true, retryAfterMs: 42_000,
      healthScope: 'provider-model',
    });
    expect(classifyRouteError({ statusCode: 502 })).toEqual({
      reason: 'provider-5xx', retryable: true, healthScope: 'provider-model',
    });
    expect(classifyRouteError({ status: 401 })).toEqual({
      reason: 'auth-failed', retryable: false, healthScope: 'account',
    });
    expect(classifyRouteError(new Error('cancelled'), true)).toEqual({
      reason: 'cancelled', retryable: false, healthScope: 'route',
    });
  });
});
