import type { PreparedRouteAttempt, RoutePlanner } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { runRouteJsonFlow } from '../src/route-json-flow.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';

const policy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};

const request = {
  wire: 'openai-chat-completions' as const, headers: {}, model: 'gpt-5.6-terra', stream: false,
  body: { model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }] },
};

const config = {
  ...stubGatewayConfig,
  callerAuth: { async verify() {
    return {
      ok: true,
      cost: {
        tenantId: 'tenant-1', principalId: 'user-1', source: 'test', correlationId: 'request-1',
      },
    };
  } },
};

const routePlanner = (attempts: PreparedRouteAttempt[]): RoutePlanner => ({
  async plan() {
    return {
      planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z',
      candidateRefs: attempts.map((_, index) => `candidate-${index}`), policy,
      councilRevision: 'fixture',
      diagnostics: attempts.map((_, index) => ({
        candidateRef: `candidate-${index}`, diagnosticAccountRef: `account-${index}`,
        requestedModel: 'gpt-5.6-terra', actualProviderId: 'openai',
        actualModelId: 'gpt-5.6-terra', actualTransportProviderId: `transport-${index}`,
        reason: 'exact' as const, cacheContinuityRisk: false,
      })),
    };
  },
  async prepareAttempt(_subject, _planRef, _candidateRef, _requestId, index) {
    return attempts[index]!;
  },
  describeAffinity() { return null; },
  promoteAffinity() { throw new Error('unused'); },
  rebindAffinity() { throw new Error('unused'); },
  resetAffinity() { return false; },
});

describe('route JSON flow', () => {
  it('settles once when planning fails after trusted route input starts the request', async () => {
    const settlements: RouteRequestSettlement[] = [];
    let routeInputCalls = 0;
    const failingPlanner = {
      async plan() { throw new Error('no eligible route'); },
    } as unknown as RoutePlanner;

    await expect(runRouteJsonFlow({
      config,
      routePlanner: failingPlanner,
      routeInput() {
        routeInputCalls += 1;
        return { affinityKey: 'session-a' };
      },
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request)).rejects.toThrow(/no eligible route/);

    expect(routeInputCalls).toBe(1);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'failed', requestedModel: 'gpt-5.6-terra',
      usage: { inputTokens: 0, outputTokens: 0, estimated: true }, attempts: [],
    });
  });

  it('falls back before commitment and settles aggregate usage once', async () => {
    const operational: unknown[] = [];
    const settlements: RouteRequestSettlement[] = [];
    const first: PreparedRouteAttempt = {
      attemptRef: 'attempt-1',
      async generate() { throw { status: 502, usage: { inputTokens: 2, outputTokens: 1, estimated: false } }; },
      async stream() { throw new Error('unused'); },
      async recordOutcome(outcome, usage) { operational.push({ outcome, usage }); },
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    };
    const second: PreparedRouteAttempt = {
      attemptRef: 'attempt-2',
      async generate() {
        return {
          id: 'response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
          message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [],
          finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete(usage) { operational.push({ complete: usage }); },
      async releaseCancelled() {},
    };

    const result = await runRouteJsonFlow({
      config, routePlanner: routePlanner([first, second]),
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request);

    expect(result.status).toBe(200);
    expect(operational).toHaveLength(2);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'success', usage: { inputTokens: 12, outputTokens: 6, estimated: false },
      attempts: [{ outcome: 'provider-5xx' }, { outcome: 'success' }],
    });
    expect(JSON.stringify(settlements)).not.toContain('account-0');
  });

  it('falls back and settles when exact-attempt preparation fails', async () => {
    const settlements: RouteRequestSettlement[] = [];
    const second = {
      attemptRef: 'attempt-2',
      async generate() { return {
        id: 'response-2', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
        message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [],
        finishReason: 'stop' as const,
      }; },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    } satisfies PreparedRouteAttempt;
    const planner = routePlanner([second, second]);
    let preparations = 0;
    planner.prepareAttempt = async (...args) => {
      preparations += 1;
      if (preparations === 1) throw Object.assign(new TypeError('offline'), { code: 'network_error' });
      return second;
    };

    await expect(runRouteJsonFlow({
      config, routePlanner: planner,
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request)).resolves.toMatchObject({ status: 200 });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'success', attempts: [
        { outcome: 'network-unavailable' }, { outcome: 'success' },
      ],
    });
  });

  it('does not try another candidate after a terminal auth failure', async () => {
    let secondCalls = 0;
    const failed = (status: number): PreparedRouteAttempt => ({
      attemptRef: `attempt-${status}`,
      async generate() { if (status === 200) secondCalls += 1; throw { status }; },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    });

    await expect(runRouteJsonFlow({
      config, routePlanner: routePlanner([failed(401), failed(200)]),
      metering: { settleRoute() {} },
    }, request)).rejects.toThrow(/all planned routes failed/);
    expect(secondCalls).toBe(0);
  });
});
