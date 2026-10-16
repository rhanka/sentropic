import { vi } from 'vitest';
import type { NativeMessagesRequest, NativeMessagesResult, NativeUsageSnapshot } from '@sentropic/llm-mesh';
import { budgetConfig, fixtureQuote, jsonAttempt, quotingPlanner, recordingBudget } from './budget.js';
import { NATIVE_MODELS } from './native-usage.js';
import { createGatewayRouter } from '../../src/router/index.js';

export const nativeFrame = (type: string, fields: Record<string, unknown> = {}) =>
  new TextEncoder().encode(`event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`);
export const nativeStart = (model: string, usage: Record<string, unknown> = {
  input_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1,
}) => nativeFrame('message_start', { message: { model, usage } });
export const nativeChunks = async function* (chunks: readonly Uint8Array[]) { yield* chunks; };

export const nativeHarness = (options: {
  model?: string; body?: Record<string, unknown>; allowanceInput?: number; allowanceOutput?: number;
  execute?: (request: NativeMessagesRequest) => Promise<NativeMessagesResult>;
  finalize?: (snapshot: NativeUsageSnapshot) => void | Promise<void>;
} = {}) => {
  const model = options.model ?? NATIVE_MODELS[0];
  const output = options.allowanceOutput ?? 32_000;
  const snapshots: NativeUsageSnapshot[] = [];
  const finalize = vi.fn(options.finalize ?? ((snapshot: NativeUsageSnapshot) => { snapshots.push(snapshot); }));
  const execute = vi.fn(options.execute ?? (async () => ({ kind: 'json' as const, status: 200 as const,
    headers: {}, body: { model, usage: { input_tokens: 2, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0, output_tokens: 3 }, safeguard_results: { future: ['kept'] } } })));
  const attempt = { ...jsonAttempt(vi.fn()), nativeMessages: {
    contractVersion: 1 as const, protocol: 'anthropic-messages' as const, modelId: model,
    apiVersions: ['2023-06-01'], requiredBetas: [], execute, finalize,
  }, complete: vi.fn(), markCommitted: vi.fn(), recordOutcome: vi.fn(), releaseCancelled: vi.fn() };
  const quote = fixtureQuote({ requestedModel: model, candidates: [{ providerId: 'anthropic', modelId: model,
    reason: 'exact', allowance: { inputTokens: options.allowanceInput ?? 10_000, outputTokens: output },
    outputCeilingEnforced: true }] });
  const { planner, calls } = quotingPlanner([attempt], { quote: () => quote });
  const originalPlan = planner.plan;
  planner.plan = async (...args) => {
    const plan = await originalPlan(...args);
    return { ...plan, diagnostics: plan.diagnostics.map(diagnostic => ({ ...diagnostic,
      requestedModel: model, actualProviderId: 'anthropic', actualModelId: model, actualTransportProviderId: 'anthropic' })) };
  };
  const recorder = recordingBudget();
  const request = { wire: 'anthropic-messages' as const, headers: {}, model, stream: false,
    authContext: { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'req-native' },
    body: { model, max_tokens: output, messages: [{ role: 'user', content: 'hello' }], safeguards: {}, ...options.body } };
  const deps = { config: budgetConfig, routePlanner: planner, metering: recorder.metering,
    budget: recorder.options, nativeMessagesEnabled: true };
  return { model, request, deps, attempt, execute, finalize, snapshots, recorder, calls };
};

/** Synthetic pinned prices: input=1 and output=2 micro-USD/token, integer monetary rounding. */
export const nativeAmount = (usage: import('../../src/flow.js').SettleUsage): number =>
  Number(((BigInt(usage.nativeInputPriceUnits40 ?? usage.inputTokens * 40) + 39n) / 40n)
    + 2n * BigInt(usage.outputTokens));

export const nativeRouter = (h: ReturnType<typeof nativeHarness>) => createGatewayRouter({
  config: h.deps.config, routePlanner: h.deps.routePlanner, routeMetering: h.deps.metering,
  budget: h.deps.budget, nativeMessagesEnabled: true, requestId: () => 'req-native',
});
export const sendNative = (h: ReturnType<typeof nativeHarness>, stream = false): Promise<Response> =>
  Promise.resolve(nativeRouter(h).request('/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...h.request.body, stream }) }));

export const nativeStreamHarness = (chunks: readonly Uint8Array[],
  options: NonNullable<Parameters<typeof nativeHarness>[0]> = {}) => nativeHarness({ ...options,
  execute: async () => ({ kind: 'stream', status: 200, headers: {}, body: nativeChunks(chunks) }),
});
