import type { PreparedRouteAttempt, RoutePlanner, StreamEvent } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';

const policy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};
const request = {
  wire: 'openai-chat-completions' as const, headers: {}, model: 'gpt-5.6-terra', stream: true,
  body: {
    model: 'gpt-5.6-terra', stream: true,
    messages: [{ role: 'user', content: 'hello' }],
  },
};
const config = {
  ...stubGatewayConfig,
  callerAuth: { async verify() { return {
    ok: true,
    cost: { tenantId: 'tenant-1', principalId: 'user-1', source: 'test', correlationId: 'request-1' },
  }; } },
};

const plannerFor = (attempts: PreparedRouteAttempt[]): RoutePlanner => ({
  async plan() { return {
    planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z',
    candidateRefs: attempts.map((_, index) => `candidate-${index}`), policy,
    councilRevision: 'fixture', diagnostics: attempts.map((_, index) => ({
      candidateRef: `candidate-${index}`, diagnosticAccountRef: `account-${index}`,
      requestedModel: request.model, actualProviderId: 'openai', actualModelId: request.model,
      actualTransportProviderId: `transport-${index}`,
      reason: 'exact' as const, cacheContinuityRisk: false,
    })),
  }; },
  async prepareAttempt(_subject, _plan, _candidate, _request, index) { return attempts[index]!; },
  describeAffinity() { return null; }, promoteAffinity() { throw new Error('unused'); },
  rebindAffinity() { throw new Error('unused'); }, resetAffinity() { return false; },
});

const attempt = (events: () => AsyncIterable<StreamEvent>, hooks: string[]): PreparedRouteAttempt => ({
  attemptRef: `attempt-${hooks.length}`,
  async generate() { throw new Error('unused'); }, async stream() { return events(); },
  async recordOutcome(outcome) { hooks.push(`outcome:${outcome.reason}`); },
  async markCommitted() { hooks.push('committed'); },
  async complete() { hooks.push('completed'); },
  async releaseCancelled() { hooks.push('cancelled'); },
});

const collect = async (stream: AsyncIterable<{ raw: string }>) => {
  let raw = '';
  for await (const frame of stream) raw += frame.raw;
  return raw;
};

describe('route stream flow', () => {
  it('falls back before the first visible event and settles once', async () => {
    const firstHooks: string[] = []; const secondHooks: string[] = [];
    const settlements: RouteRequestSettlement[] = [];
    const first = attempt(async function* () {
      throw Object.assign(new TypeError('offline'), { code: 'network_error' });
      yield { type: 'content_delta', data: { delta: 'unreachable' } };
    }, firstHooks);
    const second = attempt(async function* () {
      yield { type: 'status', data: { status: 'started' } };
      yield { type: 'content_delta', data: { delta: 'ok' } };
      yield {
        type: 'done', data: {
          finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        },
      };
    }, secondHooks);

    const result = await runRouteStreamFlow({
      config, routePlanner: plannerFor([first, second]),
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request);
    const raw = await collect(result.stream);

    expect(raw).toContain('"content":"ok"');
    expect(firstHooks).toEqual(['outcome:network-unavailable']);
    expect(secondHooks).toEqual(['committed', 'completed']);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'success', attempts: [
        { outcome: 'network-unavailable' }, { outcome: 'success' },
      ],
    });
  });

  it('never retries after commitment and emits one terminal error frame', async () => {
    const firstHooks: string[] = []; let secondCalls = 0;
    const first = attempt(async function* () {
      yield { type: 'content_delta', data: { delta: 'started' } };
      throw { status: 502 };
    }, firstHooks);
    const second = attempt(async function* () {
      secondCalls += 1; yield { type: 'content_delta', data: { delta: 'wrong' } };
    }, []);
    const settlements: RouteRequestSettlement[] = [];

    const result = await runRouteStreamFlow({
      config, routePlanner: plannerFor([first, second]),
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request);
    const raw = await collect(result.stream);

    expect(raw).toContain('started');
    expect((raw.match(/stream failed after commitment/g) ?? [])).toHaveLength(1);
    expect(firstHooks).toEqual(['committed', 'outcome:provider-5xx']);
    expect(secondCalls).toBe(0);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.outcome).toBe('failed');
  });
});
