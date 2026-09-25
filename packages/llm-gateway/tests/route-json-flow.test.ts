import type { PreparedRouteAttempt, RoutePlanner } from '@sentropic/llm-mesh';
import { describe, expect, it, vi } from 'vitest';
import { runRouteJsonFlow } from '../src/route-json-flow.js';
import { RouteAttemptDispatch } from '../src/route-attempt-dispatch.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';
import {
  budgetConfig, fixtureQuote, jsonAttempt, quotingPlanner, recordingBudget, textResponse, type BudgetRecorder,
} from './fixtures/budget.js';

const policy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};

const request = {
  wire: 'openai-chat-completions' as const, headers: {}, authContext: { method: "POST", url: "https://gateway.test/v1/chat/completions", requestId: "req-test" }, model: 'gpt-5.6-terra', stream: false,
  body: { model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }] },
};

const config = {
  ...stubGatewayConfig,
  callerAuth: { async verify() {
    return {
      ok: true as const,
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
  it('settles zero usage when dispatch validation cancels before the provider call', async () => {
    const controller = new AbortController(); const settleRoute = vi.fn();
    const source = { generate: vi.fn(), releaseCancelled: vi.fn(), recordOutcome: vi.fn() } as unknown as PreparedRouteAttempt;
    const adapter = new RouteAttemptDispatch();
    const dispatch = { stream: vi.fn(), generate: (input: import('../src/ports/dispatch.js').RouteAttemptDispatchRequest) => {
      controller.abort(); return adapter.generate(input);
    } };
    await expect(runRouteJsonFlow({ config, routePlanner: routePlanner([source]), dispatch,
      metering: { settleRoute } }, { ...request, signal: controller.signal })).rejects.toThrow();
    expect(source.generate).not.toHaveBeenCalled();
    expect(source.releaseCancelled).toHaveBeenCalledTimes(1);
    expect(source.recordOutcome).not.toHaveBeenCalled();
    expect(settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'cancelled',
      usage: { inputTokens: 0, outputTokens: 0, estimated: false },
      attempts: [expect.objectContaining({ usage: { inputTokens: 0, outputTokens: 0, estimated: false } })],
    }));
  });
  it('settles an empty plan exactly once with zero usage', async () => {
    const settleRoute = vi.fn();
    await expect(runRouteJsonFlow({ config, routePlanner: routePlanner([]), metering: { settleRoute } }, request))
      .rejects.toMatchObject({ kind: 'no-eligible-account' });
    expect(settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'failed', attempts: [], usage: { inputTokens: 0, outputTokens: 0, estimated: false },
    }));
  });
  it.each([undefined, { inputTokens: 0, outputTokens: 0 }])('preserves reported zero and estimates only missing usage: %j', async usage => {
    const source = { generate: vi.fn(async () => ({
      id: 'r', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
      message: { role: 'assistant' as const, content: 'response' }, text: 'response', toolCalls: [],
      finishReason: 'stop' as const, usage,
    })), complete: vi.fn() } as unknown as PreparedRouteAttempt;
    const settleRoute = vi.fn();
    await runRouteJsonFlow({ config, routePlanner: routePlanner([source]), metering: { settleRoute } }, request);
    const settled = settleRoute.mock.calls[0]![0];
    expect(settled.usage.estimated).toBe(!usage);
    expect(settled.usage.inputTokens).toEqual(usage ? 0 : expect.any(Number));
    if (!usage) expect(settled.usage.inputTokens).toBeGreaterThan(0);
  });
  it('never redispatches or completes twice after a settlement rejection', async () => {
    const generate = vi.fn(async () => ({ id: 'r', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
      message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' as const }));
    const source = { generate, complete: vi.fn(), recordOutcome: vi.fn() } as unknown as PreparedRouteAttempt;
    const settleRoute = vi.fn(async () => { throw Object.assign(Error('ledger'), { status: 502 }); });
    await expect(runRouteJsonFlow({ config, routePlanner: routePlanner([source, source]), metering: { settleRoute } }, request))
      .rejects.toThrow('ledger');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(source.complete).toHaveBeenCalledTimes(1);
    expect(source.recordOutcome).not.toHaveBeenCalled();
    expect(settleRoute).toHaveBeenCalledTimes(1);
  });
  it('uses the injected opaque adapter without calling native ports', async () => {
    const source = { attemptRef: 'exact', generate: vi.fn(async () => ({
      id: 'r', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
      message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' as const,
    })), stream: vi.fn(), complete: vi.fn(), recordOutcome: vi.fn(), markCommitted: vi.fn(), releaseCancelled: vi.fn() };
    const dispatch = { generate: vi.fn(async (input: import("../src/ports/dispatch.js").RouteAttemptDispatchRequest) => input.attempt.generate(input.request)), stream: vi.fn() };
    const forbidden = vi.fn(() => { throw Error('native port called'); });
    await runRouteJsonFlow({ config: { ...config, pool: { ...config.pool, select: forbidden },
      authResolver: { resolve: forbidden }, dispatch: { dispatch: forbidden, dispatchStream: forbidden } },
    routePlanner: routePlanner([source]), dispatch, metering: { settleRoute() {} } }, request);
    expect(dispatch.generate).toHaveBeenCalledTimes(1);
    expect(dispatch.generate.mock.calls[0]![0].attempt).toBe(source);
    expect(source.complete).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
  });
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

  it('surfaces an upstream invalid refusal as bad-request instead of pooled-account-unavailable', async () => {
    const failed = (status: number): PreparedRouteAttempt => ({
      attemptRef: `attempt-${status}`,
      async generate() { throw { status }; },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    });

    // Live-proven: Codex answers 400 `Unsupported parameter: max_output_tokens`.
    // A 400 invalid is the caller's request, non-retryable — it must surface
    // as 400 invalid_request_error, never as 503 pooled-account-unavailable.
    const error = await runRouteJsonFlow({
      config, routePlanner: routePlanner([failed(400), failed(400)]),
      metering: { settleRoute() {} },
    }, request).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { kind?: string }).kind).toBe('bad-request');
  });

  it('does not try another candidate after a terminal auth failure', async () => {
    let secondCalls = 0;
    const failed = (status: number): PreparedRouteAttempt => ({
      attemptRef: `attempt-${status}`,
      async generate() { if (status === 200) secondCalls += 1; throw { status }; },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    });

    // A terminal upstream 401 keeps its auth class (401 authentication_error),
    // never a pooled 503 — and stays non-retryable across candidates.
    const error = await runRouteJsonFlow({
      config, routePlanner: routePlanner([failed(401), failed(200)]),
      metering: { settleRoute() {} },
    }, request).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { kind?: string }).kind).toBe('upstream-auth-failed');
    expect(secondCalls).toBe(0);
  });

  it('surfaces a terminal upstream rate limit with its Retry-After', async () => {
    const limited: PreparedRouteAttempt = {
      attemptRef: 'attempt-429',
      async generate() { throw { status: 429, retryAfterMs: 9_000 }; },
      async stream() { throw new Error('unused'); }, async recordOutcome() {},
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    };

    const error = await runRouteJsonFlow({
      config, routePlanner: routePlanner([limited]),
      metering: { settleRoute() {} },
    }, request).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { kind?: string }).kind).toBe('upstream-rate-limited');
    expect((error as { retryAfterSeconds?: number }).retryAfterSeconds).toBe(9);
  });
});

describe('route JSON flow with budget admission', () => {
  const deps = (planner: RoutePlanner, recorder: BudgetRecorder) => ({
    config: budgetConfig, routePlanner: planner, metering: recorder.metering, budget: recorder.options,
  });
  const budgetRequest = { ...request, body: { ...request.body, max_tokens: 64 } };
  const allowanceUsage = { inputTokens: 100, outputTokens: 64, estimated: true };

  it('settles one aggregate with hold refs across fallback attempts', async () => {
    const failing = jsonAttempt(async () => { throw Object.assign(Error('upstream'), { status: 500 }); });
    const serving = jsonAttempt(textResponse({ inputTokens: 5, outputTokens: 2 }));
    const { planner } = quotingPlanner([failing, serving]);
    const recorder = recordingBudget();
    await runRouteJsonFlow(deps(planner, recorder), budgetRequest);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'mark:hold-1:1', 'settle']);
    expect(recorder.settlements).toHaveLength(1);
    expect(recorder.settlements[0]).toMatchObject({
      outcome: 'success', requestId: 'req-test', holdRef: 'hold-1', quoteRef: 'quote_fixture',
      attempts: [{ outcome: 'provider-5xx', usage: allowanceUsage },
        { outcome: 'success', usage: { inputTokens: 5, outputTokens: 2, estimated: false } }],
    });
  });
  it.each([
    ['planning fails', { plan: () => { throw new Error('no route'); } }, [] as PreparedRouteAttempt[]],
    ['the plan is empty', {}, [] as PreparedRouteAttempt[]],
  ] as const)('releases the hold before one zero-usage settlement when %s', async (_name, options, attempts) => {
    const { planner } = quotingPlanner([...attempts], options);
    const recorder = recordingBudget();
    await expect(runRouteJsonFlow(deps(planner, recorder), budgetRequest)).rejects.toThrow();
    expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({ outcome: 'failed', attempts: [], holdRef: 'hold-1',
      usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
  });
  it('releases a request cancelled after admission and before any dispatch', async () => {
    const controller = new AbortController();
    const generate = vi.fn();
    const { planner, calls } = quotingPlanner([jsonAttempt(generate)]);
    const recorder = recordingBudget(() => { controller.abort(); return { kind: 'admitted', holdRef: 'hold-1' }; });
    await expect(runRouteJsonFlow(deps(planner, recorder), { ...budgetRequest, signal: controller.signal }))
      .rejects.toThrow();
    expect(calls.prepare).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({ outcome: 'cancelled' });
  });
  it('charges the quoted allowance when a dispatched attempt reports no usage', async () => {
    const { planner } = quotingPlanner([jsonAttempt(textResponse())]);
    const recorder = recordingBudget();
    await runRouteJsonFlow(deps(planner, recorder), budgetRequest);
    expect(recorder.settlements[0]!.usage).toEqual(allowanceUsage);
    expect(recorder.settlements[0]!.overrun).toBeUndefined();
  });
  it('settles actual usage and records the overrun of an unenforced (codex) ceiling', async () => {
    const quote = fixtureQuote({ candidates: [{ ...fixtureQuote().candidates[0]!, outputCeilingEnforced: false }] });
    const { planner } = quotingPlanner([jsonAttempt(textResponse({ inputTokens: 10, outputTokens: 500 }))],
      { quote: () => quote });
    const recorder = recordingBudget();
    await runRouteJsonFlow(deps(planner, recorder), budgetRequest);
    expect(recorder.settlements[0]).toMatchObject({
      holdRef: 'hold-1', quoteRef: 'quote_fixture',
      usage: { inputTokens: 10, outputTokens: 500, estimated: false },
      overrun: [{ candidateRef: 'candidate-0', outputCeilingEnforced: false,
        allowance: { inputTokens: 100, outputTokens: 64 },
        usage: { inputTokens: 10, outputTokens: 500, estimated: false } }],
    });
  });
  it('never calls the provider when the dispatch marker fails', async () => {
    const generate = vi.fn(); const hooks: string[] = [];
    const { planner } = quotingPlanner([jsonAttempt(generate, hooks), jsonAttempt(generate, hooks)]);
    const recorder = recordingBudget(undefined, { markDispatched: async () => { throw Error('store down'); } });
    await expect(runRouteJsonFlow(deps(planner, recorder), budgetRequest))
      .rejects.toMatchObject({ kind: 'budget-unavailable' });
    expect(generate).not.toHaveBeenCalled();
    expect(hooks).toEqual(['cancelled']);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'release:hold-1', 'settle']);
  });
  it('never redispatches after a settlement sink failure', async () => {
    const generate = vi.fn(textResponse({ inputTokens: 1, outputTokens: 1 }));
    const { planner } = quotingPlanner([jsonAttempt(generate), jsonAttempt(generate)]);
    const recorder = recordingBudget();
    const failingSink = { async settleRoute() { recorder.events.push('settle'); throw Error('ledger down'); } };
    await expect(runRouteJsonFlow({ ...deps(planner, recorder), metering: failingSink }, budgetRequest))
      .rejects.toThrow('ledger down');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
  });
});
