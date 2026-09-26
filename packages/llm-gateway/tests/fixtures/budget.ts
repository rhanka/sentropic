/**
 * B3b budget admission fixtures: a fake quoting planner, a recording budget
 * port and metering sink sharing one ordered event log, and a routed router.
 */
import type {
  PreparedRouteAttempt, RoutePlanInput, RoutePlanner, RouteQuote, RouteQuoteInput, StreamEvent,
} from '@sentropic/llm-mesh';
import {
  createGatewayRouter, stubGatewayConfig, type BudgetAdmissionDecision, type BudgetAdmissionPort,
  type BudgetAdmissionRequest, type GatewayBudgetOptions, type RouteRequestSettlement,
} from '../../src/index.js';

export const MODEL = 'gpt-5.6-terra';
export const NOW_MS = Date.parse('2026-09-25T12:00:00.000Z');

export const budgetConfig = {
  ...stubGatewayConfig,
  callerAuth: { async verify() {
    return { ok: true as const, cost: {
      tenantId: 'tenant-1', principalId: 'user-1', source: 'test', correlationId: 'request-1',
    } };
  } },
};

export const fixtureQuote = (overrides: Partial<RouteQuote> = {}): RouteQuote => ({
  quoteRef: 'quote_fixture', requestedModel: MODEL, maxAttempts: 2,
  quotedAt: new Date(NOW_MS).toISOString(), policyRevision: 'default', councilRevision: 'fixture',
  candidates: [{
    providerId: 'openai', modelId: MODEL, reason: 'exact',
    allowance: { inputTokens: 100, outputTokens: 64 }, outputCeilingEnforced: true,
  }],
  ...overrides,
});

const policy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};

export interface QuotingPlannerCalls {
  readonly quote: RouteQuoteInput[];
  readonly plan: RoutePlanInput[];
  readonly prepare: number[];
}

/** Fake planner; `quote: null` builds a planner without a `quote()` method. */
export const quotingPlanner = (
  attempts: PreparedRouteAttempt[],
  options: { quote?: ((input: RouteQuoteInput) => RouteQuote) | null; plan?: () => never } = {},
): { planner: RoutePlanner; calls: QuotingPlannerCalls } => {
  const calls: QuotingPlannerCalls = { quote: [], plan: [], prepare: [] };
  const quote = options.quote === undefined ? () => fixtureQuote() : options.quote;
  const planner: RoutePlanner = {
    async plan(_subject, input) {
      calls.plan.push(input);
      if (options.plan) options.plan();
      return {
        planRef: 'plan-1', expiresAt: '2027-01-01T00:00:00Z',
        candidateRefs: attempts.map((_, index) => `candidate-${index}`), policy,
        councilRevision: 'fixture',
        diagnostics: attempts.map((_, index) => ({
          candidateRef: `candidate-${index}`, diagnosticAccountRef: `account-${index}`,
          requestedModel: MODEL, actualProviderId: 'openai', actualModelId: MODEL,
          actualTransportProviderId: `transport-${index}`, reason: 'exact' as const,
          cacheContinuityRisk: false,
        })),
      };
    },
    async prepareAttempt(_subject, _plan, _candidate, _request, index) {
      calls.prepare.push(index);
      return attempts[index]!;
    },
    describeAffinity() { return null; },
    promoteAffinity() { throw new Error('unused'); },
    rebindAffinity() { throw new Error('unused'); },
    resetAffinity() { return false; },
    ...(quote ? { quote(input: RouteQuoteInput) { calls.quote.push(input); return quote(input); } } : {}),
  };
  return { planner, calls };
};

export interface BudgetRecorder {
  readonly port: BudgetAdmissionPort;
  readonly options: GatewayBudgetOptions;
  readonly events: string[];
  readonly admitted: BudgetAdmissionRequest[];
  readonly settlements: RouteRequestSettlement[];
  readonly metering: { settleRoute(value: RouteRequestSettlement): Promise<void> };
}

export const recordingBudget = (
  decide: (request: BudgetAdmissionRequest) => Promise<BudgetAdmissionDecision> | BudgetAdmissionDecision
    = () => ({ kind: 'admitted', holdRef: 'hold-1' }),
  extra: Partial<Omit<GatewayBudgetOptions, 'port'>> & { markDispatched?: () => Promise<void> } = {},
): BudgetRecorder => {
  const events: string[] = [];
  const admitted: BudgetAdmissionRequest[] = [];
  const settlements: RouteRequestSettlement[] = [];
  const port: BudgetAdmissionPort = {
    async admit(request) { events.push('admit'); admitted.push(request); return decide(request); },
    async markDispatched(holdRef, index) {
      events.push(`mark:${holdRef}:${index}`);
      await extra.markDispatched?.();
    },
    async release(holdRef) { events.push(`release:${holdRef}`); },
  };
  const { markDispatched: _unused, ...rest } = extra;
  return {
    port, events, admitted, settlements,
    options: { port, now: () => NOW_MS, ...rest },
    metering: { async settleRoute(value) { events.push('settle'); settlements.push(value); } },
  };
};

export const jsonAttempt = (
  generate: () => Promise<unknown>, hooks: string[] = [],
): PreparedRouteAttempt => ({
  attemptRef: 'attempt',
  generate: generate as PreparedRouteAttempt['generate'],
  async stream() { throw new Error('unused'); },
  async recordOutcome(outcome) { hooks.push(`outcome:${outcome.reason}`); },
  async markCommitted() { hooks.push('committed'); },
  async complete() { hooks.push('completed'); },
  async releaseCancelled() { hooks.push('cancelled'); },
});

export const textResponse = (usage?: { inputTokens: number; outputTokens: number }) => async () => ({
  id: 'r', providerId: 'openai', modelId: MODEL,
  message: { role: 'assistant', content: 'answer' }, text: 'answer', toolCalls: [],
  finishReason: 'stop', ...(usage ? { usage } : {}),
});

export const streamAttempt = (
  events: () => AsyncIterable<StreamEvent>, hooks: string[] = [],
): PreparedRouteAttempt => ({
  ...jsonAttempt(async () => { throw new Error('unused'); }, hooks),
  async stream() { return events(); },
});

export const answerStream = (usage?: { inputTokens: number; outputTokens: number }) =>
  async function* (): AsyncGenerator<StreamEvent> {
    yield { type: 'content_delta', data: { delta: 'answer' } };
    yield { type: 'done', data: { finishReason: 'stop', ...(usage ? { usage } : {}) } };
  };

export const budgetRouter = (input: {
  readonly planner: RoutePlanner;
  readonly recorder: BudgetRecorder;
  readonly budget?: boolean;
}) => createGatewayRouter({
  config: budgetConfig, routePlanner: input.planner, routeMetering: input.recorder.metering,
  ...(input.budget === false ? {} : { budget: input.recorder.options }),
  requestId: () => 'req_budget',
});

export const WIRES = [
  { wire: 'anthropic-messages' as const, path: '/v1/messages' },
  { wire: 'openai-chat-completions' as const, path: '/v1/chat/completions' },
];

export const send = (
  app: ReturnType<typeof createGatewayRouter>, path: string, stream: boolean,
  body: Record<string, unknown> = {},
): Promise<Response> => Promise.resolve(app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: MODEL, max_tokens: 64, stream, messages: [{ role: 'user', content: 'hello' }], ...body,
  }),
}));
