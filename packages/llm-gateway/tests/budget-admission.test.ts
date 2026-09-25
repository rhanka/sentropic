import {
  InMemoryRoutePlanner, type AccountDirectoryPort, type PreparedRouteAttempt, type RoutePlanner,
} from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import {
  BudgetConfigurationError, budgetRetryAfterSeconds, createGatewayRouter, routeUsageCeiling,
  runRouteJsonFlow, runRouteStreamFlow,
} from '../src/index.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import {
  MODEL, NOW_MS, WIRES, budgetConfig, budgetRouter, fixtureQuote, jsonAttempt, quotingPlanner,
  recordingBudget, send, textResponse,
} from './fixtures/budget.js';

const flowRequest = (stream: boolean, body: Record<string, unknown> = {}) => ({
  wire: 'openai-chat-completions' as const, headers: {}, model: MODEL, stream,
  authContext: { method: 'POST', url: 'https://gateway.test/v1/chat/completions', requestId: 'req-1' },
  body: { model: MODEL, max_tokens: 64, stream, messages: [{ role: 'user', content: 'hello' }], ...body },
});

describe('budget admission construction', () => {
  const { planner } = quotingPlanner([]);
  const recorder = recordingBudget();
  const build = (routePlanner: RoutePlanner | undefined, options = recorder.options) => () => createGatewayRouter({
    config: budgetConfig, ...(routePlanner ? { routePlanner } : {}),
    routeMetering: recorder.metering, budget: options,
  });

  it('refuses a budget with a planner that cannot quote (explicit code, no silent skip)', () => {
    const { planner: noQuote } = quotingPlanner([], { quote: null });
    expect(build(noQuote)).toThrow(BudgetConfigurationError);
    expect(build(noQuote)).toThrow(expect.objectContaining({ code: 'budget-quote-required' }));
  });
  it('refuses a decorator that enumerates own properties and drops the prototype quote()', () => {
    const real = new InMemoryRoutePlanner({ directory: { async listEligible() { return []; },
      async prepareAttempt() { throw new Error('unused'); } } });
    const decorated = { ...real } as unknown as RoutePlanner;
    expect(build(decorated)).toThrow(expect.objectContaining({ code: 'budget-quote-required' }));
  });
  it('refuses a budget without a route planner or with an invalid default ceiling', () => {
    expect(build(undefined)).toThrow(expect.objectContaining({ code: 'budget-route-planner-required' }));
    expect(build(planner, { ...recorder.options, defaultOutputTokens: 0 }))
      .toThrow(expect.objectContaining({ code: 'budget-invalid-default-ceiling' }));
    expect(build(planner)).not.toThrow();
  });
  it('fails a direct flow call the same way before any quote or dispatch', async () => {
    const { planner: noQuote, calls } = quotingPlanner([], { quote: null });
    await expect(runRouteJsonFlow({ config: budgetConfig, routePlanner: noQuote,
      metering: recorder.metering, budget: recorder.options }, flowRequest(false)))
      .rejects.toMatchObject({ code: 'budget-quote-required' });
    expect(calls.plan).toEqual([]);
  });
});

describe('budget admission opt-in', () => {
  it.each([false, true])('without a budget port never quotes and plans unpinned (stream=%s)', async (stream) => {
    const { planner, calls } = quotingPlanner([jsonAttempt(textResponse({ inputTokens: 1, outputTokens: 1 }))]);
    const recorder = recordingBudget();
    const response = await send(budgetRouter({ planner, recorder, budget: false }), '/v1/chat/completions', stream);
    await response.text();
    expect(calls.quote).toEqual([]);
    expect(calls.plan).toHaveLength(1);
    expect('quote' in calls.plan[0]!).toBe(false);
    expect(recorder.admitted).toEqual([]);
    expect(Object.keys(recorder.settlements[0] ?? {}).sort())
      .toEqual(['attempts', 'cost', 'outcome', 'requestedModel', 'usage', 'wire']);
  });
});

describe('budget admission quote and ceiling', () => {
  it('computes the quote in-process and ignores any caller-supplied quote', async () => {
    const { planner, calls } = quotingPlanner([jsonAttempt(textResponse({ inputTokens: 1, outputTokens: 1 }))]);
    const recorder = recordingBudget();
    const app = budgetRouter({ planner, recorder });
    const response = await app.request('/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sentropic-quote': 'quote_forged' },
      body: JSON.stringify({ model: MODEL, max_tokens: 64, quote: { quoteRef: 'quote_forged', candidates: [] },
        messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(response.status).toBe(200);
    expect(calls.quote).toHaveLength(1);
    expect(calls.quote[0]).toMatchObject({ requestedModel: MODEL, ceiling: { outputTokens: 64 } });
    expect(calls.quote[0]!.now.getTime()).toBe(NOW_MS);
    expect(recorder.admitted[0]).toMatchObject({ requestId: 'req_budget', wire: 'openai-chat-completions' });
    expect(recorder.admitted[0]!.quote.quoteRef).toBe('quote_fixture');
    expect(calls.plan[0]!.quote).toBe(recorder.admitted[0]!.quote);
  });
  it('refuses a request without a finite output ceiling as bad-request before quoting', async () => {
    for (const max of [undefined, 0, 1.5]) {
      const { planner, calls } = quotingPlanner([]);
      const recorder = recordingBudget();
      const response = await send(budgetRouter({ planner, recorder }), '/v1/messages', false, { max_tokens: max });
      expect(response.status).toBe(400);
      expect(calls.quote).toEqual([]);
      expect(recorder.events).toEqual([]);
    }
  });
  it('applies the host default output ceiling when the request has none', () => {
    const canonical = normalizeGatewayIngress('openai-chat-completions', { model: MODEL, messages: [] });
    expect(routeUsageCeiling(canonical, { ...recordingBudget().options, defaultOutputTokens: 512 }))
      .toMatchObject({ outputTokens: 512 });
  });
  it('reserves nothing for an empty quote and answers like an empty route', async () => {
    const { planner, calls } = quotingPlanner([], { quote: () => fixtureQuote({ candidates: [] }) });
    const recorder = recordingBudget();
    const response = await send(budgetRouter({ planner, recorder }), '/v1/chat/completions', false);
    expect(response.status).toBe(503);
    expect(recorder.events).toEqual([]);
    expect(calls.plan).toEqual([]);
  });
});

describe('budget admission Retry-After', () => {
  it('bounds the hint to [1, 60] seconds', () => {
    expect(budgetRetryAfterSeconds(NOW_MS + 30 * 24 * 3600_000, NOW_MS)).toBe(60);
    expect(budgetRetryAfterSeconds(NOW_MS + 2_100, NOW_MS)).toBe(3);
    expect(budgetRetryAfterSeconds(NOW_MS - 5_000, NOW_MS)).toBe(1);
    expect(budgetRetryAfterSeconds(Number.NaN, NOW_MS)).toBe(60);
  });
  it.each(WIRES)('emits the bounded header on $wire', async ({ path }) => {
    const { planner } = quotingPlanner([]);
    const recorder = recordingBudget(() => ({ kind: 'over-budget', resetAtMs: NOW_MS + 12_001 }));
    const response = await send(budgetRouter({ planner, recorder }), path, true);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('13');
  });
  it('maps an admit rejection or malformed decision to the sanitized 503, never 429', async () => {
    for (const decide of [async () => { throw new Error('pricing table missing'); },
      () => ({ kind: 'admitted', holdRef: '' }) as never, () => ({ kind: 'free' }) as never]) {
      const { planner, calls } = quotingPlanner([]);
      const recorder = recordingBudget(decide);
      const response = await send(budgetRouter({ planner, recorder }), '/v1/chat/completions', false);
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(await response.text()).not.toContain('pricing');
      expect(calls.plan).toEqual([]);
      expect(recorder.settlements).toEqual([]);
    }
  });
});

describe('budget admission with the real mesh planner', () => {
  const directory = (attempt: PreparedRouteAttempt): AccountDirectoryPort => ({
    async listEligible() {
      return [{ accountRef: 'internal-a', diagnosticAccountRef: 'acct_a', targetProviderId: 'gemini',
        transportProviderId: 'cloud-code', supportedModelIds: ['gemini-3.5-flash'],
        enrollmentCompletedAt: '2026-08-01T00:00:00Z', readiness: 'ready' as const, revision: 'r1' }];
    },
    async prepareAttempt() { return attempt; },
  });
  it.each([false, true])('pins the plan to the gateway quote without mismatch (stream=%s)', async (stream) => {
    const attempt: PreparedRouteAttempt = {
      ...jsonAttempt(textResponse({ inputTokens: 3, outputTokens: 2 })),
      async stream() {
        return (async function* () {
          yield { type: 'content_delta' as const, data: { delta: 'answer' } };
          yield { type: 'done' as const, data: { finishReason: 'stop' as const, usage: { inputTokens: 3, outputTokens: 2 } } };
        })();
      },
    };
    const planner = new InMemoryRoutePlanner({ directory: directory(attempt) });
    const recorder = recordingBudget();
    const run = stream ? runRouteStreamFlow : runRouteJsonFlow;
    const result = await run({ config: budgetConfig, routePlanner: planner, metering: recorder.metering,
      budget: recorder.options }, { ...flowRequest(stream), model: 'gemini-3.5-flash',
      body: { ...flowRequest(stream).body, model: 'gemini-3.5-flash' } });
    if ('stream' in result) for await (const _frame of result.stream) { /* drain */ }
    const quote = recorder.admitted[0]!.quote;
    expect(quote.candidates.length).toBeGreaterThan(0);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({
      outcome: 'success', requestId: 'req-1', holdRef: 'hold-1', quoteRef: quote.quoteRef,
      usage: { inputTokens: 3, outputTokens: 2, estimated: false },
    });
  });
});
