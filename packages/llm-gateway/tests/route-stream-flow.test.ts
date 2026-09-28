import { RoutePlanError, type PreparedRouteAttempt, type RoutePlanner, type StreamEvent } from '@sentropic/llm-mesh';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayRouter, toProviderShapedError } from '../src/index.js';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';
import { RouteAttemptDispatch } from '../src/route-attempt-dispatch.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';
import { parseSse } from '../src/wire.js';
import {
  NOW_MS, answerStream, budgetConfig, quotingPlanner, recordingBudget, streamAttempt, type BudgetRecorder,
} from './fixtures/budget.js';

const policy = {
  strategy: { kind: 'last-enrolled' as const }, rules: [], fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000, maxAttempts: 2, preferSameTransport: true,
  stickyAccount: true, rotateEquivalentAccounts: false, allowEquivalentModels: true,
};
const request = {
  wire: 'openai-chat-completions' as const, headers: {}, authContext: { method: "POST", url: "https://gateway.test/v1/chat/completions", requestId: "req-test" }, model: 'gpt-5.6-terra', stream: true,
  body: {
    model: 'gpt-5.6-terra', stream: true,
    messages: [{ role: 'user', content: 'hello' }],
  },
};
const config = {
  ...stubGatewayConfig,
  callerAuth: { async verify() { return {
    ok: true as const,
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
  it('settles zero usage when dispatch validation cancels before the provider call', async () => {
    const controller = new AbortController(); const settleRoute = vi.fn(); const hooks: string[] = [];
    const source = attempt(async function* () {}, hooks); source.stream = vi.fn();
    const adapter = new RouteAttemptDispatch();
    const dispatch = { generate: vi.fn(), stream: (input: import('../src/ports/dispatch.js').RouteAttemptDispatchRequest) => {
      controller.abort(); return adapter.stream(input);
    } };
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source]), dispatch,
      metering: { settleRoute } }, { ...request, signal: controller.signal })).rejects.toThrow();
    expect(source.stream).not.toHaveBeenCalled();
    expect(hooks).toEqual(['cancelled']);
    expect(settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'cancelled',
      usage: { inputTokens: 0, outputTokens: 0, estimated: false },
      attempts: [expect.objectContaining({ usage: { inputTokens: 0, outputTokens: 0, estimated: false } })],
    }));
  });
  it.each(['openai-chat-completions', 'anthropic-messages'] as const)(
    'rejects a first-event encoding failure before committing %s', async wire => {
      const hooks: string[] = []; const settleRoute = vi.fn(); const closed = vi.fn();
      const source = attempt(async function* () {
        try { yield { type: 'tool_call_start', data: { toolCallId: 't',
          get name(): string { throw Error('cannot encode'); } } } as StreamEvent; }
        finally { closed(); }
      }, hooks);
      await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source]),
        metering: { settleRoute } }, { ...request, wire })).rejects.toThrow();
      expect(hooks).toEqual(['outcome:provider-5xx']);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(settleRoute).toHaveBeenCalledTimes(1);
    });
  it('does not repeat terminal accounting when priming encounters a ledger failure', async () => {
    const hooks: string[] = []; const settleRoute = vi.fn(async (_value: RouteRequestSettlement) => { throw Error('ledger failure'); });
    const source = attempt(async function* () {
      yield { type: 'content_delta', data: { get delta(): string { throw Error('invalid event'); } } };
    }, hooks);
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source, source]),
      metering: { settleRoute } }, request)).rejects.toThrow('ledger failure');
    expect(hooks).toEqual(['outcome:provider-5xx']);
    expect(settleRoute).toHaveBeenCalledTimes(1);
    expect(settleRoute.mock.calls[0]![0].attempts).toHaveLength(1);
  });
  it('records only one cancellation when abort, pending next and return race', async () => {
    const controller = new AbortController(); const hooks: string[] = []; const settleRoute = vi.fn();
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const iterator: AsyncIterator<StreamEvent> = {
      next: async () => {
        if (++calls === 1) return { done: false, value: { type: 'content_delta', data: { delta: 'first' } } };
        entered();
        await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
        return { done: true, value: undefined };
      }, return: close,
    };
    const source = attempt(() => ({ [Symbol.asyncIterator]: () => iterator }), hooks);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute } },
      { ...request, signal: controller.signal });
    await result.stream.next(); await result.stream.next();
    const pending = result.stream.next();
    await waiting;
    controller.abort();
    await Promise.allSettled([pending, result.stream.return(undefined)]);
    expect(hooks).toEqual(['committed', 'cancelled']);
    expect(close).toHaveBeenCalledTimes(1); expect(settleRoute).toHaveBeenCalledTimes(1);
  });
  it('preserves typed usage on a pre-commit provider failure', async () => {
    const settleRoute = vi.fn();
    const source = attempt(async function* () {
      throw { status: 401, usage: { inputTokens: 7, outputTokens: 0, estimated: false } };
      yield { type: 'done', data: { finishReason: 'stop' } };
    }, []);
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute } }, request)).rejects.toThrow();
    expect(settleRoute.mock.calls[0]![0].usage).toEqual({ inputTokens: 7, outputTokens: 0, estimated: false });
  });
  it('maps a stream-opening 404 refusal to unknown-model without a second candidate', async () => {
    const hooks: string[] = []; const opened: string[] = []; const settleRoute = vi.fn();
    const refused = (tag: string, target: string[]) => attempt(async function* (): AsyncGenerator<StreamEvent> {
      opened.push(tag);
      throw { status: 404 };
    }, target);
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([refused('first', hooks), refused('second', [])]),
      metering: { settleRoute } }, request)).rejects.toMatchObject({ kind: 'unknown-model' });
    expect(opened).toEqual(['first']);
    expect(hooks).toEqual(['outcome:unsupported-model']);
    expect(settleRoute).toHaveBeenCalledTimes(1);
    expect(settleRoute.mock.calls[0]![0]).toMatchObject({
      outcome: 'failed', attempts: [{ outcome: 'unsupported-model' }],
    });
  });
  it('maps a first-event 404 error to unknown-model before commitment', async () => {
    const hooks: string[] = []; const settleRoute = vi.fn();
    const source = attempt(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'error', data: { providerId: 'openai', message: 'model not found',
        code: 'model_not_found', retryable: false } };
    }, hooks);
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source, source]),
      metering: { settleRoute } }, request)).rejects.toMatchObject({ kind: 'unknown-model' });
    expect(hooks).toEqual(['outcome:unsupported-model']);
    expect(settleRoute).toHaveBeenCalledTimes(1);
  });
  it('keeps a post-commit 404 as a sanitized stream error without rewriting the response', async () => {
    const hooks: string[] = []; const settleRoute = vi.fn();
    const source = attempt(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'content_delta', data: { delta: 'hello' } };
      yield { type: 'error', data: { providerId: 'openai', message: 'model not found',
        code: 'model_not_found', retryable: false } };
    }, hooks);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]),
      metering: { settleRoute } }, request);
    const wire = await collect(result.stream);
    // Already committed: the 404 arrives as a sanitized mid-stream error — no
    // HTTP-status rewrite, no replay, no success terminator.
    expect(wire).toContain('stream failed after commitment');
    expect(wire).not.toContain('[DONE]');
    expect(wire).not.toContain('Unknown model');
    expect(hooks).toEqual(['committed', 'outcome:unsupported-model']);
    expect(settleRoute).toHaveBeenCalledTimes(1);
  });
  it('releases a stream returned before first consumer iteration exactly once', async () => {
    const hooks: string[] = [];
    const closed = vi.fn(); const settleRoute = vi.fn();
    const source = attempt(async function* () {
      try { yield { type: 'content_delta', data: { delta: 'first' } }; }
      finally { closed(); }
    }, hooks);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute } }, request);
    await Promise.all([result.stream.return(undefined), result.stream.return(undefined)]);
    expect(hooks).toEqual(['committed', 'cancelled']);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(settleRoute).toHaveBeenCalledTimes(1);
    expect(settleRoute.mock.calls[0]![0].usage.inputTokens).toBeGreaterThan(0);
  });
  it('does not redispatch, record again or settle again when the ledger rejects', async () => {
    const hooks: string[] = []; const closed = vi.fn();
    const source = attempt(async function* () {
      try { yield { type: 'done', data: { finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } } }; }
      finally { closed(); }
    }, hooks);
    const settleRoute = vi.fn(async () => { throw Error('ledger failure'); });
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source, source]), metering: { settleRoute } }, request))
      .rejects.toThrow('ledger failure');
    expect(hooks).toEqual(['committed', 'completed']);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(settleRoute).toHaveBeenCalledTimes(1);
    expect(settleRoute.mock.calls[0]).toEqual([expect.objectContaining({
      usage: { inputTokens: 0, outputTokens: 0, estimated: false },
    })]);
  });
  it('does not emit a success terminator when settlement fails after content', async () => {
    const hooks: string[] = []; const settleRoute = vi.fn(async () => { throw Error('ledger failure'); });
    const source = attempt(async function* () {
      yield { type: 'content_delta', data: { delta: 'hello' } };
      yield { type: 'done', data: { finishReason: 'stop' } };
    }, hooks);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute } }, request);
    let raw = '';
    await expect((async () => { for await (const frame of result.stream) raw += frame.raw; })())
      .rejects.toThrow('ledger failure');
    expect(raw).not.toContain('[DONE]');
    expect(raw).not.toContain('"finish_reason":"stop"');
    expect(hooks).toEqual(['committed', 'completed']);
    expect(settleRoute).toHaveBeenCalledTimes(1);
  });
  it('sanitizes a mid-stream error and emits no success terminator', async () => {
    const source = attempt(async function* () {
      yield { type: 'content_delta', data: { delta: 'hello' } };
      yield { type: 'error', data: { providerId: 'openai', message: 'SECRET-TOKEN', code: 'SECRET-CODE', retryable: false } };
    }, []);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute() {} } }, request);
    const wire = await collect(result.stream);
    expect(wire).not.toContain('SECRET'); expect(wire).not.toContain('[DONE]');
    expect(wire.match(/stream failed after commitment/g)).toHaveLength(1);
  });
  it('retains only pre-commit string metadata headers', async () => {
    const source = attempt(async function* () {
      yield { type: 'status', data: { status: 'started', metadata: { responseHeaders: { 'X-Request-ID': 'early', count: 1 } } } };
      yield { type: 'content_delta', data: { delta: 'hello' } };
      yield { type: 'status', data: { status: 'started', metadata: { responseHeaders: { 'X-Request-ID': 'late' } } } };
      yield { type: 'done', data: { finishReason: 'stop' } };
    }, []);
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute() {} } }, request);
    await collect(result.stream);
    expect(result.headers).toEqual({ 'x-request-id': 'early' });
  });
  it('settles empty plans and closes empty streams before commitment', async () => {
    const settleRoute = vi.fn();
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([]), metering: { settleRoute } }, request))
      .rejects.toMatchObject({ kind: 'no-route' });
    expect(settleRoute).toHaveBeenCalledTimes(1);
    const hooks: string[] = [];
    const source = attempt(async function* () {}, hooks);
    await expect(runRouteStreamFlow({ config, routePlanner: plannerFor([source]), metering: { settleRoute } }, request))
      .rejects.toMatchObject({ kind: 'pooled-account-unavailable' });
    expect(hooks).toEqual(['outcome:provider-5xx']);
    expect(settleRoute).toHaveBeenCalledTimes(2);
  });
  it('uses the injected adapter for the exact prepared stream attempt', async () => {
    const hooks: string[] = [];
    const source = attempt(async function* () { yield { type: 'done', data: { finishReason: 'stop' } }; }, hooks);
    const dispatch = { generate: vi.fn(), stream: vi.fn(async (input: import("../src/ports/dispatch.js").RouteAttemptDispatchRequest) => input.attempt.stream(input.request)) };
    const result = await runRouteStreamFlow({ config, routePlanner: plannerFor([source]), dispatch,
      metering: { settleRoute() {} } }, request);
    await collect(result.stream);
    expect(dispatch.stream).toHaveBeenCalledTimes(1);
    expect(dispatch.stream.mock.calls[0]![0].attempt).toBe(source);
    expect(hooks).toEqual(['committed', 'completed']);
  });
  it('separates Anthropic compaction usage from provider settlement', async () => {
    const run = async (imageData: string) => {
      const settlements: RouteRequestSettlement[] = [];
      const source = attempt(async function* () {
        yield { type: 'content_delta', data: { delta: 'ok' } };
        yield {
          type: 'done',
          data: {
            finishReason: 'stop',
            usage: { inputTokens: 123, outputTokens: 7, totalTokens: 130 },
          },
        };
      }, []);
      const body = {
        model: request.model, stream: true, system: 'system context',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Bonjour 🌍' },
            { type: 'image', source: { media_type: 'image/png', data: imageData } },
          ],
        }],
        tools: [{
          name: 'lookup', description: 'Look up a record',
          input_schema: { type: 'object', properties: { id: { type: 'string' } } },
        }],
      };
      const result = await runRouteStreamFlow({
        config, routePlanner: plannerFor([source]),
        metering: { settleRoute(value) { settlements.push(value); } },
      }, { ...request, wire: 'anthropic-messages', body });
      return { frames: parseSse(await collect(result.stream)), settlements };
    };

    const small = await run('AAAA');
    const large = await run('A'.repeat(100_000));
    const smallStart = JSON.parse(small.frames[0]!.data);
    const largeStart = JSON.parse(large.frames[0]!.data);
    const terminal = JSON.parse(small.frames.at(-2)!.data);

    expect(smallStart.message.usage.input_tokens).toBeGreaterThan(0);
    expect(largeStart.message.usage.input_tokens).toBe(smallStart.message.usage.input_tokens);
    expect(terminal.usage).toEqual({ output_tokens: 7 });
    expect(small.settlements[0]).toMatchObject({
      usage: { inputTokens: 123, outputTokens: 7, estimated: false },
    });
  });

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

  it('falls back and settles when stream-attempt preparation fails', async () => {
    const hooks: string[] = [];
    const settlements: RouteRequestSettlement[] = [];
    const second = attempt(async function* () {
      yield { type: 'content_delta', data: { delta: 'ok' } };
      yield { type: 'done', data: { finishReason: 'stop' } };
    }, hooks);
    const planner = plannerFor([second, second]);
    let preparations = 0;
    planner.prepareAttempt = async () => {
      preparations += 1;
      if (preparations === 1) throw Object.assign(new TypeError('offline'), { code: 'network_error' });
      return second;
    };
    const result = await runRouteStreamFlow({
      config, routePlanner: planner,
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request);
    expect(await collect(result.stream)).toContain('ok');
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

  it('surfaces an upstream invalid refusal as bad-request before any content', async () => {
    const failing = (): PreparedRouteAttempt => ({
      attemptRef: 'attempt-400',
      async generate() { throw new Error('unused'); },
      async stream(): Promise<AsyncIterable<StreamEvent>> { throw { status: 400 }; },
      async recordOutcome() {}, async markCommitted() {}, async complete() {},
      async releaseCancelled() {},
    });

    const error = await runRouteStreamFlow({
      config, routePlanner: plannerFor([failing(), failing()]),
      metering: { settleRoute() {} },
    }, request).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { kind?: string }).kind).toBe('bad-request');
  });

  it('surfaces a terminal upstream auth refusal as upstream-auth-failed before any content', async () => {
    const failing = (): PreparedRouteAttempt => ({
      attemptRef: 'attempt-401',
      async generate() { throw new Error('unused'); },
      async stream(): Promise<AsyncIterable<StreamEvent>> { throw { status: 401 }; },
      async recordOutcome() {}, async markCommitted() {}, async complete() {},
      async releaseCancelled() {},
    });

    const error = await runRouteStreamFlow({
      config, routePlanner: plannerFor([failing()]),
      metering: { settleRoute() {} },
    }, request).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { kind?: string }).kind).toBe('upstream-auth-failed');
  });

  it('releases and settles a committed stream when the consumer cancels', async () => {
    const hooks: string[] = [];
    const settlements: RouteRequestSettlement[] = [];
    const source = attempt(async function* () {
      yield { type: 'content_delta', data: { delta: 'first' } };
      yield { type: 'content_delta', data: { delta: 'second' } };
    }, hooks);
    const result = await runRouteStreamFlow({
      config, routePlanner: plannerFor([source]),
      metering: { settleRoute(value) { settlements.push(value); } },
    }, request);

    for await (const _frame of result.stream) break;

    expect(hooks).toEqual(['committed', 'cancelled']);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'cancelled', attempts: [{ outcome: 'cancelled' }],
    });
  });
});

describe('route stream flow with budget admission', () => {
  const deps = (planner: RoutePlanner, recorder: BudgetRecorder) => ({
    config: budgetConfig, routePlanner: planner, metering: recorder.metering, budget: recorder.options,
  });
  const budgetRequest = { ...request, body: { ...request.body, max_tokens: 64 } };

  it('settles one aggregate with hold refs across a pre-commit fallback', async () => {
    const failing = streamAttempt(async function* (): AsyncGenerator<StreamEvent> {
      throw Object.assign(Error('upstream'), { status: 500 });
    });
    const serving = streamAttempt(answerStream({ inputTokens: 5, outputTokens: 2 }));
    const { planner } = quotingPlanner([failing, serving]);
    const recorder = recordingBudget();
    const result = await runRouteStreamFlow(deps(planner, recorder), budgetRequest);
    expect(recorder.settlements).toEqual([]);
    await collect(result.stream);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'mark:hold-1:1', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({
      outcome: 'success', holdRef: 'hold-1', quoteRef: 'quote_fixture', requestId: 'req-test',
      attempts: [{ outcome: 'provider-5xx', usage: { inputTokens: 100, outputTokens: 64, estimated: true } },
        { outcome: 'success', usage: { inputTokens: 5, outputTokens: 2, estimated: false } }],
    });
  });
  it('charges the allowance once when a committed stream is cancelled without usage', async () => {
    const hooks: string[] = [];
    const { planner } = quotingPlanner([streamAttempt(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'content_delta', data: { delta: 'partial' } };
      await new Promise(() => undefined);
    }, hooks)]);
    const recorder = recordingBudget();
    const result = await runRouteStreamFlow(deps(planner, recorder), budgetRequest);
    await result.stream.next();
    await result.stream.return(undefined);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({ outcome: 'cancelled', holdRef: 'hold-1',
      usage: { inputTokens: 100, outputTokens: 64, estimated: true } });
  });
  it('never opens the provider stream when the dispatch marker fails', async () => {
    const hooks: string[] = [];
    const source = streamAttempt(answerStream(), hooks);
    const opened = vi.spyOn(source, 'stream');
    const { planner } = quotingPlanner([source]);
    const recorder = recordingBudget(undefined, { markDispatched: async () => { throw Error('store down'); } });
    await expect(runRouteStreamFlow(deps(planner, recorder), budgetRequest))
      .rejects.toMatchObject({ kind: 'budget-unavailable' });
    expect(opened).not.toHaveBeenCalled();
    expect(hooks).toEqual(['cancelled']);
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'release:hold-1', 'settle']);
  });
  it('refuses over-budget before planning or opening any stream', async () => {
    const { planner, calls } = quotingPlanner([streamAttempt(answerStream())]);
    const recorder = recordingBudget(() => ({ kind: 'over-budget', resetAtMs: NOW_MS + 5_000 }));
    await expect(runRouteStreamFlow(deps(planner, recorder), budgetRequest))
      .rejects.toMatchObject({ kind: 'over-budget', retryAfterSeconds: 5 });
    expect(calls.plan).toEqual([]);
    expect(calls.prepare).toEqual([]);
    expect(recorder.settlements).toEqual([]);
  });
  it('preserves the typed refusal when the admitted-plan ledger fails', async () => {
    const typed = new RoutePlanError('Unknown requested model', 'unknown-model');
    const { planner } = quotingPlanner([], { plan: () => { throw typed; } });
    const recorder = recordingBudget();
    const failingSink = { async settleRoute() { recorder.events.push('settle'); throw Error('ledger down'); } };
    const error = await runRouteStreamFlow({ ...deps(planner, recorder), metering: failingSink }, budgetRequest).then(
      () => { throw new Error('expected rejection'); }, (error: unknown) => error);
    expect(error).toBe(typed);
    expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
    expect(toProviderShapedError('openai-chat-completions', error, 'gpt-5.6-terra').status).toBe(404);
  });
  it('preserves admitted terminal 404 when recordOutcome rejects', async () => {
    const source: PreparedRouteAttempt = {
      attemptRef: 'attempt-404',
      async generate() { throw new Error('unused'); },
      async stream(): Promise<AsyncIterable<StreamEvent>> { throw { status: 404 }; },
      async recordOutcome() { throw Object.assign(Error('hook down'), { status: 500 }); },
      async markCommitted() {}, async complete() {}, async releaseCancelled() {},
    };
    const { planner } = quotingPlanner([source]);
    const recorder = recordingBudget();
    const error = await runRouteStreamFlow(deps(planner, recorder), budgetRequest).then(
      () => { throw new Error('expected rejection'); }, (error: unknown) => error);
    expect((error as { kind?: string }).kind).toBe('unknown-model');
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
    expect(recorder.settlements).toHaveLength(1);
    expect(JSON.stringify(toProviderShapedError('openai-chat-completions', error, 'gpt-5.6-terra').body))
      .not.toContain('overloaded');
  });
  it('preserves admitted terminal 404 when the ledger fails after upstream 404', async () => {
    const source = streamAttempt(async function* (): AsyncGenerator<StreamEvent> { throw { status: 404 }; });
    const { planner } = quotingPlanner([source]);
    const recorder = recordingBudget();
    const failingSink = { async settleRoute() { recorder.events.push('settle'); throw Error('ledger down'); } };
    const error = await runRouteStreamFlow({ ...deps(planner, recorder), metering: failingSink }, budgetRequest).then(
      () => { throw new Error('expected rejection'); }, (error: unknown) => error);
    expect((error as { kind?: string }).kind).toBe('unknown-model');
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'settle']);
    const shaped = toProviderShapedError('openai-chat-completions', error, 'gpt-5.6-terra');
    expect(shaped.status).toBe(404);
    expect(JSON.stringify(shaped.body)).not.toContain('overloaded');
  });
  it('preserves admitted Q7 no-route when the empty-plan ledger fails', async () => {
    const { planner } = quotingPlanner([]);
    const recorder = recordingBudget();
    const failingSink = { async settleRoute() { recorder.events.push('settle'); throw Error('ledger down'); } };
    const error = await runRouteStreamFlow({ ...deps(planner, recorder), metering: failingSink }, budgetRequest).then(
      () => { throw new Error('expected rejection'); }, (error: unknown) => error);
    expect((error as { kind?: string }).kind).toBe('no-route');
    expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
    const shaped = toProviderShapedError('openai-chat-completions', error, 'gpt-5.6-terra');
    expect(shaped.status).toBe(503);
    expect(shaped.headers).toEqual({ 'x-should-retry': 'false' });
    expect(JSON.stringify(shaped.body)).not.toContain('overloaded');
  });
  it('preserves the admitted enrollment refusal when the ledger fails', async () => {
    const enrollment = { name: 'RoutePlanError', code: 'no-route',
      diagnostic: { code: 'reauth-required', transportProviderId: 'cloud-code' } };
    const { planner } = quotingPlanner([], { plan: () => { throw enrollment; } });
    const recorder = recordingBudget();
    const failingSink = { async settleRoute() { recorder.events.push('settle'); throw Error('ledger down'); } };
    const error = await runRouteStreamFlow({ ...deps(planner, recorder), metering: failingSink }, budgetRequest).then(
      () => { throw new Error('expected rejection'); }, (error: unknown) => error);
    expect(error).toBe(enrollment);
    expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
    const shaped = toProviderShapedError('openai-chat-completions', error, 'gpt-5.6-terra');
    expect(shaped.headers).toEqual({ 'X-Sentropic-Route-Action': 'reauthenticate-cloud-code' });
    expect(JSON.stringify(shaped.body)).not.toContain('overloaded');
  });
});

describe('route stream lifecycle through the router', () => {
  const streamRouterApp = (attempts: PreparedRouteAttempt[], settlements: RouteRequestSettlement[]) =>
    createGatewayRouter({
      config, routePlanner: plannerFor(attempts),
      routeMetering: { settleRoute(value) { settlements.push(value); } },
      requestId: () => 'req-test',
    });
  const postStream = (app: ReturnType<typeof createGatewayRouter>, path: string) => app.request(path, {
    method: 'POST',
    headers: { authorization: 'Bearer [REDACTED]', 'content-type': 'application/json' },
    body: JSON.stringify({ model: request.model, stream: true, messages: [{ role: 'user', content: 'hello' }] }),
  });
  const frozen404 = (path: string) => path === '/v1/messages'
    ? { type: 'error', error: { type: 'not_found_error', message: `Unknown model: "${request.model}"` } }
    : { error: { message: `Unknown model: "${request.model}"`,
      type: 'invalid_request_error', code: 'model_not_found' } };

  it.each(['/v1/messages', '/v1/chat/completions'])(
    'returns JSON 404 before commitment with no SSE bytes (%s)', async (path) => {
      const opened: string[] = []; const firstHooks: string[] = []; const secondHooks: string[] = [];
      const closed = vi.fn(); const settlements: RouteRequestSettlement[] = [];
      const first = attempt(async function* (): AsyncGenerator<StreamEvent> {
        try {
          opened.push('first');
          yield { type: 'error', data: { providerId: 'openai', message: 'model not found',
            code: 'model_not_found', retryable: false } };
        } finally { closed(); }
      }, firstHooks);
      const second = attempt(async function* (): AsyncGenerator<StreamEvent> {
        opened.push('second');
        yield { type: 'content_delta', data: { delta: 'wrong' } };
      }, secondHooks);
      const res = await postStream(streamRouterApp([first, second], settlements), path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      const text = await res.text();
      expect(text.startsWith('event:')).toBe(false);
      expect(text.startsWith('data:')).toBe(false);
      expect(JSON.parse(text)).toEqual(frozen404(path));
      expect(opened).toEqual(['first']);
      expect(firstHooks).toEqual(['outcome:unsupported-model']);
      expect(secondHooks).toEqual([]);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(settlements).toHaveLength(1);
      expect(settlements[0]).toMatchObject({ outcome: 'failed', attempts: [{ outcome: 'unsupported-model' }] });
    });

  it.each(['/v1/messages', '/v1/chat/completions'])(
    'keeps committed status with a sanitized terminal error (%s)', async (path) => {
      const opened: string[] = []; const firstHooks: string[] = []; const secondHooks: string[] = [];
      const closed = vi.fn(); const settlements: RouteRequestSettlement[] = [];
      const first = attempt(async function* (): AsyncGenerator<StreamEvent> {
        try {
          opened.push('first');
          yield { type: 'content_delta', data: { delta: 'hello' } };
          yield { type: 'error', data: { providerId: 'openai', message: 'model not found SECRET',
            code: 'model_not_found', retryable: false } };
        } finally { closed(); }
      }, firstHooks);
      const second = attempt(async function* (): AsyncGenerator<StreamEvent> {
        opened.push('second');
        yield { type: 'content_delta', data: { delta: 'wrong' } };
      }, secondHooks);
      const res = await postStream(streamRouterApp([first, second], settlements), path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('stream failed after commitment');
      expect(text).not.toContain('Unknown model');
      expect(text).not.toContain('SECRET');
      if (path === '/v1/chat/completions') expect(text).not.toContain('[DONE]');
      else expect(text).not.toContain('message_stop');
      expect(opened).toEqual(['first']);
      expect(firstHooks).toEqual(['committed', 'outcome:unsupported-model']);
      expect(secondHooks).toEqual([]);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(settlements).toHaveLength(1);
      expect(settlements[0]?.outcome).toBe('failed');
    });
});
