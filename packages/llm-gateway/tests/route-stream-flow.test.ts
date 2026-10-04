import { RoutePlanError, type PreparedRouteAttempt, type RoutePlanner, type StreamEvent } from '@sentropic/llm-mesh';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayRouter, toProviderShapedError } from '../src/index.js';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';
import { RouteAttemptDispatch } from '../src/route-attempt-dispatch.js';
import type { RouteRequestSettlement } from '../src/route-flow-core.js';
import { stubGatewayConfig } from '../src/stubs.js';
import { parseSse } from '../src/wire.js';
import { nativeHarness, nativeStreamHarness, nativeFrame, nativeStart, sendNative, nativeAmount } from './fixtures/native-flow.js';
import { CACHE_START, NATIVE_MODELS } from './fixtures/native-usage.js';
import * as nativeUsage from '../src/native-usage.js';
import * as nativeLife from '../src/native-lifecycle.js';
import { runRouteJsonFlow } from '../src/route-json-flow.js';
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

const collect = async (stream: AsyncIterable<{ raw: string } | { bytes: Uint8Array }>) => {
  let raw = '';
  for await (const frame of stream) raw += 'bytes' in frame ? new TextDecoder().decode(frame.bytes) : frame.raw;
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
    await expect((async () => { for await (const frame of result.stream) raw += 'bytes' in frame ? new TextDecoder().decode(frame.bytes) : frame.raw; })())
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

describe('native stream commitment and cancellation', () => {
  it('relays exact comment/unknown/UTF-8/CRLF bytes and native SSE headers', async () => {
    const comment = new TextEncoder().encode(': ready\r\n\r\n');
    const future = new TextEncoder().encode('event: future\ndata: {"text":"é💡"}\n\n');
    const h = nativeStreamHarness([comment, nativeStart('claude-sonnet-5'), future,
      nativeFrame('message_delta', { usage: { output_tokens: 3 } }), nativeFrame('message_stop')]);
    const response = await sendNative(h, true);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-sentropic-relay')).toBe('native');
    expect(response.headers.get('x-sentropic-served')).toBeNull();
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const raw = new TextDecoder().decode(await response.arrayBuffer());
    expect(raw).toBe(new TextDecoder().decode(comment) + new TextDecoder().decode(nativeStart(h.model))
      + new TextDecoder().decode(future) + new TextDecoder().decode(nativeFrame('message_delta', { usage: { output_tokens: 3 } }))
      + new TextDecoder().decode(nativeFrame('message_stop')));
    expect(h.attempt.markCommitted).toHaveBeenCalledTimes(1);
    expect(h.recorder.settlements).toHaveLength(1);
    expect(h.snapshots[0]).toMatchObject({ estimated: false, finalOutputObserved: true, termination: 'completed' });
  });
  it('claims one failed snapshot when markCommitted rejects after a valid start', async () => {
    const h = nativeStreamHarness([nativeStart('claude-sonnet-5')]);
    h.attempt.markCommitted.mockRejectedValue(Error('commit failed'));
    await expect(runRouteStreamFlow(h.deps, { ...h.request, stream: true })).rejects.toThrow();
    expect(h.execute).toHaveBeenCalledTimes(1); expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.snapshots[0]).toMatchObject({ termination: 'commit_failed', inputTokens: 2,
      outputTokens: 1, nativeInputUsageValidated: true, finalOutputObserved: false, estimated: true });
    expect(h.recorder.settlements[0]!.attempts[0]!.usage).toMatchObject({ inputTokens: 2, outputTokens: 32_000, estimated: true });
    expect(h.attempt.recordOutcome).toHaveBeenCalledTimes(1);
  });
  it('cancels an exposed but never-consumed stream once', async () => {
    const h = nativeStreamHarness([nativeStart('claude-sonnet-5')]);
    const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true });
    await result.stream.return(undefined); await result.stream.return(undefined);
    expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.attempt.releaseCancelled).toHaveBeenCalledTimes(1);
    expect(h.recorder.settlements).toHaveLength(1);
    expect(h.snapshots[0]).toMatchObject({ termination: 'cancelled', finalOutputObserved: false });
  });
  it('settles and closes once when caller cancellation interrupts a pending read', async () => {
    const controller = new AbortController(); const closed = vi.fn(async () => ({ done: true as const, value: undefined }));
    let reads = 0;
    const h = nativeHarness({ execute: async () => ({ kind: 'stream', status: 200, headers: {}, body: {
      [Symbol.asyncIterator]: () => ({ next: () => ++reads === 1
        ? Promise.resolve({ done: false as const, value: nativeStart('claude-sonnet-5') })
        : new Promise<IteratorResult<Uint8Array>>(() => {}), return: closed }),
    } }) });
    const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true, signal: controller.signal });
    await result.stream.next(); const pending = result.stream.next();
    await Promise.resolve(); controller.abort();
    await expect(pending).resolves.toMatchObject({ done: true });
    await result.stream.return(undefined);
    expect(closed).toHaveBeenCalledTimes(1); expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.attempt.releaseCancelled).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
  });
  it.each([false, true])('requires a final delta before clean stop establishes measured output: delta=%s', async delta => {
    const h = nativeStreamHarness([nativeStart('claude-sonnet-5'),
      ...(delta ? [nativeFrame('message_delta', { usage: { output_tokens: 3 } })] : []), nativeFrame('message_stop')]);
    const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true });
    await collect(result.stream);
    expect(h.snapshots[0]).toMatchObject({ finalOutputObserved: delta, estimated: !delta, outputTokens: delta ? 3 : 1 });
    expect(h.recorder.settlements[0]!.usage.outputTokens).toBe(delta ? 3 : 32_000);
  });
});

describe('native cumulative input and pinned stream amounts', () => {
  const start = { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 1 };
  it.each(NATIVE_MODELS.flatMap(model => [false, true].map(clean => ({ model, clean }))))(
    'prices K1 growth once without a clean output floor: $model clean=$clean', async ({ model, clean }) => {
      const h = nativeStreamHarness([nativeStart(model, start), nativeFrame('message_delta', { usage: {
        input_tokens: 150, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 500 } }),
        ...(clean ? [nativeFrame('message_stop')] : [])], { model });
      const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true });
      await collect(result.stream);
      const fable = model === NATIVE_MODELS[2];
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(clean ? fable ? 1200 : 1350 : fable ? 64_200 : 64_350);
      expect(h.snapshots[0]).toMatchObject({ inputTokens: 2150, outputTokens: 500, totalTokens: 2650,
        nativeInputUsageValidated: true, nativeInputUsageSource: 'message_delta', finalOutputObserved: clean, estimated: !clean });
      expect(h.recorder.settlements[0]!.usage.outputTokens).toBe(clean ? 500 : 32_000);
    });
  it.each([{ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }, {},
    { input_tokens: 100, cache_read_input_tokens: null }, { cache_read_input_tokens: 1000 }])(
    'keeps equal/absent/nullable cumulative categories without revoking proof: %j', async delta => {
      const h = nativeStreamHarness([nativeStart(NATIVE_MODELS[0], start),
        nativeFrame('message_delta', { usage: { ...delta, output_tokens: 500 } }), nativeFrame('message_stop')]);
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(h.snapshots[0]).toMatchObject({ inputTokens: 1100, nativeInputUsageValidated: true, estimated: false });
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(1200);
    });
  it.each([{ input_tokens: 99 }, { cache_read_input_tokens: 999 }, { input_tokens: 0 }])(
    'permanently revokes decreased input even after later growth: %j', async decrease => {
      const h = nativeStreamHarness([nativeStart(NATIVE_MODELS[0], start), nativeFrame('message_delta', { usage: decrease }),
        nativeFrame('message_delta', { usage: { input_tokens: 150, cache_read_input_tokens: 2000, output_tokens: 500 } }),
        nativeFrame('message_stop')]);
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(h.snapshots[0]).toMatchObject({ nativeInputUsageValidated: false, estimated: true,
        nativeUsageUncertainty: 'input_breakdown_changed', outputTokens: 500 });
      expect(h.snapshots[0]!.nativeInputPriceUnits40).toBeUndefined();
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(74_000);
    });
  it.each(NATIVE_MODELS.flatMap(model => [false, true].map(clean => ({ model, clean }))))(
    'pins official V-1 cumulative usage: $model clean=$clean', async ({ model, clean }) => {
      const h = nativeStreamHarness([nativeStart(model, { input_tokens: 2679, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 3 }), nativeFrame('message_delta', { usage: {
          input_tokens: 10_682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 510,
          server_tool_use: { web_search_requests: 1 } } }), ...(clean ? [nativeFrame('message_stop')] : [])],
      { model, allowanceInput: 20_000 });
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(clean ? 11_702 : 74_682);
      expect(h.snapshots[0]).toMatchObject({ inputTokens: 10_682, outputTokens: 510, totalTokens: 11_192,
        nativeInputUsageValidated: true, finalOutputObserved: clean, estimated: !clean });
      expect(JSON.stringify(h.snapshots)).not.toContain('server_tool_use');
    });
});

describe('native served-model and substantive-iterations latches', () => {
  const mixed = { input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 250,
    cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 }, output_tokens: 1 };
  it.each(NATIVE_MODELS.flatMap(model => [undefined, null, [], [{}], {}, 'malformed', 0, false].map(iterations => ({ model, iterations }))))(
    'uses the shared empty-iterations predicate and realistic floor: $model iterations=$iterations', async ({ model, iterations }) => {
      const h = nativeStreamHarness([nativeStart(model, mixed), nativeFrame('message_delta', {
        usage: { output_tokens: 500, iterations } }), nativeFrame('message_delta', { usage: { iterations: [] } }),
        nativeFrame('message_stop')], { model });
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      const latched = iterations != null && (!Array.isArray(iterations) || iterations.length > 0);
      const snapshot = h.snapshots[0]!;
      expect(snapshot).toMatchObject({ inputTokens: 10_350, outputTokens: 500, totalTokens: 10_850,
        iterationsPresent: latched, nativeInputUsageValidated: !latched, estimated: latched, finalOutputObserved: true });
      const charged = h.recorder.settlements[0]!.attempts[0]!.usage;
      expect(nativeAmount(charged)).toBe(latched ? 74_350 : model === NATIVE_MODELS[2] ? 1700 : 2450);
      expect(charged.outputTokens).toBe(latched ? 32_000 : 500);
      if (latched) {
        expect(snapshot.nativeInputPriceUnits40).toBeUndefined();
        expect(snapshot.nativeUsageUncertainty).toBe('served_model_mismatch');
        expect(charged.outputTokens / snapshot.outputTokens!).toBe(64);
      } else expect(snapshot.nativeUsageUncertainty).toBeUndefined();
      expect(JSON.stringify(snapshot.rawUsage)).not.toContain('iterations');
    });
  it.each(NATIVE_MODELS.flatMap(model => ['mismatch', 'fallback', 'iterations'].map(cause => ({ model, cause }))))(
    'keeps a late latch after valid input even if later evidence looks normal: $model $cause', async ({ model, cause }) => {
      const other = model === NATIVE_MODELS[2] ? NATIVE_MODELS[1] : NATIVE_MODELS[2];
      const trigger = cause === 'mismatch' ? nativeStart(other, mixed)
        : cause === 'fallback' ? nativeFrame('content_block_start', { content_block: { type: 'fallback', fallback_credit_token: 'opaque' } })
          : nativeFrame('message_delta', { usage: { iterations: [{ input_tokens: 999_999, output_tokens: 999_999 }] } });
      const h = nativeStreamHarness([nativeStart(model, mixed), trigger,
        ...(cause === 'mismatch' ? [nativeStart(model, mixed)] : []),
        nativeFrame('message_delta', { usage: { output_tokens: 500, iterations: null } }), nativeFrame('message_stop')], { model });
      const wire = await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(wire).toContain(new TextDecoder().decode(trigger));
      expect(h.snapshots[0]).toMatchObject({ inputTokens: 10_350, outputTokens: 500, nativeInputUsageValidated: false,
        nativeUsageUncertainty: 'served_model_mismatch', estimated: true });
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(74_350);
      expect(JSON.stringify(h.snapshots)).not.toContain('fallback_credit_token');
      expect(JSON.stringify(h.snapshots)).not.toContain('999999');
      expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
    });
});

describe('native finalize parity and independent cleanup', () => {
  it.each(['clean', 'cancel', 'commit', 'eof', 'overflow', 'reader', 'upstream'] as const)(
    'shares one snapshot and releases the reader/lease seam before a never-settling hook: %s', async cause => {
      vi.useFakeTimers();
      const snapshotSpy = vi.spyOn(nativeUsage.NativeUsageObserver.prototype, 'snapshot');
      const projectionSpy = vi.spyOn(nativeUsage, 'nativeSnapshotUsage');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const leaseReleased = vi.fn();
      const closed = vi.fn(async () => { leaseReleased(); return { done: true as const, value: undefined }; });
      try {
        const chunks = [nativeStart(NATIVE_MODELS[0])];
        if (cause === 'clean') chunks.push(nativeFrame('message_delta', { usage: { output_tokens: 3 } }), nativeFrame('message_stop'));
        if (cause === 'overflow') chunks.push(new Uint8Array(1_048_577).fill(65));
        if (cause === 'upstream') chunks.push(nativeFrame('error', { error: { type: 'rate_limit_error', message: 'secret' } }));
        let index = 0;
        const h = nativeHarness({ finalize: () => new Promise<void>(() => {}), execute: async () => ({
          kind: 'stream', status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({
            next: async () => {
              if (index < chunks.length) return { done: false as const, value: chunks[index++]! };
              if (cause === 'reader') throw Error('private reader failure');
              return { done: true as const, value: undefined };
            }, return: closed,
          }) },
        }) });
        if (cause === 'commit') h.attempt.markCommitted.mockRejectedValue(Error('private commit failure'));
        if (cause === 'commit') await expect(runRouteStreamFlow(h.deps, { ...h.request, stream: true })).rejects.toThrow();
        else {
          const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true });
          if (cause === 'cancel') await result.stream.return(undefined);
          else await collect(result.stream);
          await result.stream.return(undefined);
        }
        const snapshot = h.finalize.mock.calls[0]![0]!;
        expect(h.finalize).toHaveBeenCalledTimes(1); expect(snapshotSpy).toHaveBeenCalledTimes(1);
        expect(snapshotSpy.mock.results[0]!.value).toBe(snapshot);
        expect(projectionSpy).toHaveBeenCalledExactlyOnceWith(snapshot);
        expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.rawUsage)).toBe(true);
        expect(h.recorder.settlements).toHaveLength(1);
        expect(closed).toHaveBeenCalledTimes(1); expect(leaseReleased).toHaveBeenCalledTimes(1);
        expect(h.recorder.settlements[0]!.attempts[0]!.usage).toMatchObject({
          inputTokens: snapshot.inputTokens, outputTokens: cause === 'clean' ? snapshot.outputTokens : 32_000,
          estimated: snapshot.estimated, nativeInputUsageSource: snapshot.nativeInputUsageSource,
          nativeUsageUncertainty: snapshot.nativeUsageUncertainty,
        });
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(vi.getTimerCount()).toBe(0);
        expect(h.recorder.settlements).toHaveLength(1); expect(leaseReleased).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledExactlyOnceWith('Native observation unavailable', {
          requestId: 'req-native', attemptRef: 'attempt', reason: 'hook_timeout' });
      } finally { snapshotSpy.mockRestore(); projectionSpy.mockRestore(); warn.mockRestore(); vi.useRealTimers(); }
    });
  it.each(['reject', 'throw', 'never'] as const)('completes JSON accounting independently of observation: %s', async mode => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshotSpy = vi.spyOn(nativeUsage.NativeUsageObserver.prototype, 'snapshot');
    const projectionSpy = vi.spyOn(nativeUsage, 'nativeSnapshotUsage');
    try {
      const h = nativeHarness({ finalize: () => {
        if (mode === 'throw') throw Error('private hook failure');
        return mode === 'reject' ? Promise.reject(Error('private hook failure')) : new Promise<void>(() => {});
      } });
      await expect(runRouteJsonFlow(h.deps, h.request)).resolves.toMatchObject({ status: 200, relay: 'native' });
      const snapshot = h.finalize.mock.calls[0]![0]!;
      expect(snapshotSpy.mock.results[0]!.value).toBe(snapshot);
      expect(projectionSpy).toHaveBeenCalledExactlyOnceWith(snapshot);
      expect(h.attempt.complete).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private hook failure');
    } finally { warn.mockRestore(); snapshotSpy.mockRestore(); projectionSpy.mockRestore(); vi.useRealTimers(); }
  });
});

describe('SDK-shaped one-hour cache deltas and pinned amounts', () => {
  const cases = [
    { name: 'equal-no-split', delta: { input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200 }, growth: false },
    { name: 'aggregate-only', delta: { cache_creation_input_tokens: 200 }, growth: false },
    { name: 'nullable', delta: { input_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: null }, growth: false },
    { name: 'all-null', delta: { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }, growth: false },
    { name: 'omitted', delta: {}, growth: false },
    { name: 'growth', delta: { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 300 }, growth: true },
  ];
  const matrix = NATIVE_MODELS.flatMap(model => [false, true].flatMap(clean => ['1h', 'unknown'].flatMap(ttl =>
    cases.map(test => ({ model, clean, ttl, ...test })))));
  it.each(matrix)('inherits/reprices only growth: $model $name ttl=$ttl clean=$clean', async ({ model, clean, ttl, delta, growth }) => {
    const h = nativeStreamHarness([nativeStart(model, CACHE_START),
      nativeFrame('message_delta', { usage: { ...delta, output_tokens: 500 } }),
      nativeFrame('message_delta', { usage: delta }), ...(clean ? [nativeFrame('message_stop')] : [])], {
      model, allowanceInput: 10_300, body: { system: [{ type: 'text', text: 'cached', cache_control: { type: 'ephemeral', ttl } }] },
    });
    await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
    const fable = model === NATIVE_MODELS[2];
    const expected = growth ? clean ? fable ? 1950 : 2700 : fable ? 64_950 : 65_700
      : clean ? fable ? 1750 : 2500 : fable ? 64_750 : 65_500;
    expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(expected);
    expect(h.snapshots[0]).toMatchObject({ inputTokens: growth ? 10_400 : 10_300, outputTokens: 500,
      totalTokens: growth ? 10_900 : 10_800, nativeInputUsageValidated: true, estimated: !clean, finalOutputObserved: clean,
      rawUsage: { cache_creation_input_tokens: growth ? 300 : 200,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } } });
    expect(h.snapshots[0]!.nativeInputPriceUnits40).toBe(growth ? fable ? 38_000 : 68_000 : fable ? 30_000 : 60_000);
    expect(h.snapshots[0]!.nativeCacheWriteSplitReason).toBe(growth ? 'cache_write_split_inferred' : undefined);
    expect(h.snapshots[0]!.nativeUsageUncertainty).toBe(clean ? undefined : 'incomplete_output');
  });
  it.each(NATIVE_MODELS.flatMap(model => [false, true].map(clean => ({ model, clean }))))(
    'preserves mixed prior allocation and prices only +100 at 2x: $model clean=$clean', async ({ model, clean }) => {
      const h = nativeStreamHarness([nativeStart(model, { ...CACHE_START, cache_creation_input_tokens: 250,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 } }),
        nativeFrame('message_delta', { usage: { cache_creation_input_tokens: 350, output_tokens: 500 } }),
        ...(clean ? [nativeFrame('message_stop')] : [])], { model,
        body: { future: { cache_control: { type: 'ephemeral', ttl: '1h' } } } });
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(clean
        ? model === NATIVE_MODELS[2] ? 1900 : 2650 : model === NATIVE_MODELS[2] ? 64_900 : 65_650);
      expect(h.snapshots[0]).toMatchObject({ inputTokens: 10_450, outputTokens: 500,
        rawUsage: { cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 } } });
    });
  it.each(NATIVE_MODELS)('keeps eligible default-TTL growth at 1.25x: %s', async model => {
    const h = nativeStreamHarness([nativeStart(model, { ...CACHE_START,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } }),
      nativeFrame('message_delta', { usage: { cache_creation_input_tokens: 300, output_tokens: 500 } }),
      nativeFrame('message_stop')], { model });
    await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
    expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(model === NATIVE_MODELS[2] ? 1725 : 2475);
    expect(h.snapshots[0]!.nativeCacheWriteSplitReason).toBeUndefined();
  });
  it.each([{ cache_creation_input_tokens: 199 }, { cache_creation_input_tokens: 199,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 199 } },
    { cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 201 } }])(
    'revokes a supplied aggregate/split decrease or conflict permanently: %j', async delta => {
      const h = nativeStreamHarness([nativeStart(NATIVE_MODELS[0], CACHE_START), nativeFrame('message_delta', { usage: delta }),
        nativeFrame('message_delta', { usage: { cache_creation_input_tokens: 200, output_tokens: 500 } }), nativeFrame('message_stop')],
      { allowanceInput: 10_300, body: { future: { cache_control: { type: 'ephemeral', ttl: '1h' } } } });
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      expect(h.snapshots[0]).toMatchObject({ nativeInputUsageValidated: false, estimated: true, inputTokens: 10_300 });
      expect(h.snapshots[0]!.nativeInputPriceUnits40).toBeUndefined();
      expect(nativeAmount(h.recorder.settlements[0]!.attempts[0]!.usage)).toBe(74_300);
    });
});

describe('typed native finalize timeout and late results', () => {
  it.each(['resolve', 'reject'] as const)('ignores late %s after the exact 1000-ms bound without repeating lifecycle work', async mode => {
    vi.useFakeTimers();
    const factory = vi.spyOn(nativeLife, 'nativeLifecycle');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const closed = vi.fn(async () => ({ done: true as const, value: undefined }));
    let resolve!: () => void; let reject!: (error: Error) => void;
    const deferred = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    try {
      const chunks = [nativeStart(NATIVE_MODELS[0]), nativeFrame('message_delta', { usage: { output_tokens: 3 } }), nativeFrame('message_stop')];
      let index = 0;
      const h = nativeHarness({ finalize: () => deferred, execute: async () => ({ kind: 'stream', status: 200, headers: {},
        body: { [Symbol.asyncIterator]: () => ({ next: async () => index < chunks.length
          ? { done: false as const, value: chunks[index++]! } : { done: true as const, value: undefined }, return: closed }) } }) });
      await collect((await runRouteStreamFlow(h.deps, { ...h.request, stream: true })).stream);
      const lifecycle = factory.mock.results[0]!.value as ReturnType<typeof nativeLife.nativeLifecycle>;
      const snapshot = lifecycle.snapshot;
      const results: nativeLife.NativeFinalizeResult[] = [];
      void lifecycle.observation!.then(value => { results.push(value); });
      expect(h.recorder.settlements).toHaveLength(1); expect(closed).toHaveBeenCalledTimes(1);
      expect(h.attempt.complete).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(999); expect(results).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(results).toEqual([{ kind: 'observation_unavailable', reason: 'hook_timeout' }]);
      expect(vi.getTimerCount()).toBe(0);
      if (mode === 'resolve') resolve(); else reject(Error('private late failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.finish('cancelled')).toBe(snapshot);
      expect(lifecycle.snapshot).toBe(h.finalize.mock.calls[0]![0]);
      expect(results).toHaveLength(1); expect(h.finalize).toHaveBeenCalledTimes(1);
      expect(h.attempt.complete).toHaveBeenCalledTimes(1); expect(closed).toHaveBeenCalledTimes(1);
      expect(h.recorder.settlements).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1); expect(JSON.stringify(warn.mock.calls)).not.toContain('private late failure');
    } finally { factory.mockRestore(); warn.mockRestore(); vi.useRealTimers(); }
  });
  it.each(['absent', 'completed', 'throw', 'reject'] as const)('returns a closed typed result and clears its timer: %s', async mode => {
    vi.useFakeTimers();
    try {
      const snapshot = new nativeUsage.NativeUsageObserver(NATIVE_MODELS[0]).snapshot('protocol_error');
      const hook = mode === 'absent' ? undefined : () => {
        if (mode === 'throw') throw Error('private hook failure');
        return mode === 'reject' ? Promise.reject(Error('private hook failure')) : Promise.resolve();
      };
      const result = await nativeLife.finalizeNativeObservation(hook, snapshot);
      expect(result).toEqual(mode === 'absent' || mode === 'completed' ? { kind: mode }
        : { kind: 'observation_unavailable', reason: 'hook_error' });
      expect(vi.getTimerCount()).toBe(0); expect(snapshot.termination).toBe('protocol_error');
    } finally { vi.useRealTimers(); }
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
