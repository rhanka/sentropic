import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckedGatewayBody, GatewayBodyBytePool, createGatewayRouter, defaultGatewayBodyBytePool,
  ensureCheckedGatewayBody, gatewayRequestBodyLimit, type RequestBodyLimitOptions, type CreateGatewayRouterOptions,
} from '../src/index.js';
import { nativeHarness, nativeFrame, nativeStart } from './fixtures/native-flow.js';
import { NativeMessagesUpstreamError, RouteQuoteError, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';
import { fixtureQuote, textResponse } from './fixtures/budget.js';

const PATHS = ['/v1/messages', '/v1/chat/completions', '/v1/messages/count_tokens'];
const utf8 = (text: string) => new TextEncoder().encode(text);
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const bodyRequest = (chunks: readonly Uint8Array[], path = PATHS[0]!, headers: Record<string, string> = {}, signal?: AbortSignal) => {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); else controller.close(); }, cancel,
  });
  const raw = new Request(`https://gateway.test${path}`, { method: 'POST', body, headers, signal,
    duplex: 'half' } as RequestInit & { duplex: 'half' });
  return { raw, cancel };
};
const limitedRouter = (h: ReturnType<typeof nativeHarness>, options: RequestBodyLimitOptions,
  order = 'product', owners: CheckedGatewayBody[] = [], overrides: Partial<CreateGatewayRouterOptions> = {}) => {
  const app = new Hono();
  const inspect: MiddlewareHandler = async (c, next) => {
    owners.push(await ensureCheckedGatewayBody(c.req.raw, options)); await next();
  };
  // Product cap precedes settlement inspection; standalone inspection ensures the cap itself.
  if (order === 'standalone') app.use('*', (c, next) => gatewayRequestBodyLimit(options)(c, async () => { await inspect(c, next); }));
  app.use('*', gatewayRequestBodyLimit(options));
  if (order === 'product') app.use('*', inspect);
  app.route('/', createGatewayRouter({ config: h.deps.config, routePlanner: h.deps.routePlanner,
    routeMetering: h.deps.metering, budget: h.deps.budget, nativeMessagesEnabled: true,
    requestBody: options, requestId: () => 'req-native', ...overrides }));
  return app;
};

describe('gateway bounded ingress', () => {
  it.each(PATHS)('refuses actual over-cap bytes before parsing/auth/hold/dispatch on %s', async path => {
    const h = nativeHarness(); const pool = new GatewayBodyBytePool(16);
    const auth = vi.fn(h.deps.config.callerAuth.verify);
    const app = createGatewayRouter({ config: { ...h.deps.config, callerAuth: { verify: auth } },
      routePlanner: h.deps.routePlanner, routeMetering: h.deps.metering, budget: h.deps.budget,
      requestBody: { pool, limitBytes: 16 } });
    const { raw, cancel } = bodyRequest([utf8('not JSON at all!!')], path);
    const response = await app.request(raw);
    expect(response.status).toBe(413); expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.headers.get('x-should-retry')).toBe('false');
    expect(response.headers.has('retry-after')).toBe(false);
    expect(await response.json()).toEqual(path.includes('chat') ? { error: { type: 'invalid_request_error',
      code: 'request_too_large', message: 'Request size is at least 17 bytes and exceeds limit 16 bytes.' } }
      : { type: 'error', error: { type: 'request_too_large', message: 'Request size is at least 17 bytes and exceeds limit 16 bytes.' } });
    expect(auth).not.toHaveBeenCalled(); expect(h.calls.quote).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.recorder.events).toEqual([]);
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
  });
  it.each([0, 1])('accepts exact/below cap and parses split multibyte input once (headroom=%s)', async headroom => {
    const bytes = utf8('{"model":"é😀","content":"hello"}');
    const pool = new GatewayBodyBytePool(bytes.length + headroom);
    const { raw } = bodyRequest([bytes.subarray(0, 12), bytes.subarray(12)]);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const first = ensureCheckedGatewayBody(raw, { pool, limitBytes: bytes.length + headroom });
      const second = ensureCheckedGatewayBody(raw, { pool, limitBytes: bytes.length + headroom });
      expect(first).toBe(second);
      const owner = await first;
      expect(owner.body).toEqual({ model: 'é😀', content: 'hello' });
      expect(owner.bytes).toBe(bytes.length); expect(owner.lease.bytes).toBe(bytes.length);
      expect(parse).toHaveBeenCalledTimes(1); expect(pool.stats.acquisitions).toBe(1);
      owner.release(); owner.release();
      expect(owner.retainedHolders).toBe(0); expect(pool.stats.releases).toBe(1);
    } finally { parse.mockRestore(); }
  });
  it.each(['{broken', ''])('restores capacity on invalid JSON %j', async text => {
    const pool = new GatewayBodyBytePool(32);
    await expect(ensureCheckedGatewayBody(bodyRequest([utf8(text)]).raw, { pool, limitBytes: 32 }))
      .rejects.toMatchObject({ kind: 'bad-request' });
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
  });
  it('shares a checked result across both middleware orders and releases JSON once', async () => {
    for (const order of ['product', 'standalone']) {
      const h = nativeHarness(); const pool = new GatewayBodyBytePool(4096); const owners: CheckedGatewayBody[] = [];
      const response = await limitedRouter(h, { pool, limitBytes: 4096 }, order, owners)
        .request(bodyRequest([utf8(JSON.stringify(h.request.body))]).raw);
      expect(response.status).toBe(200); expect(h.execute).toHaveBeenCalledTimes(1);
      expect(owners[0]!.body).toBeUndefined(); expect(owners[0]!.retainedHolders).toBe(0);
      expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
    }
  });
});

describe('shared ingress capacity', () => {
  it.each(PATHS)('refuses only unavailable byte extensions on %s across router instances', async path => {
    const h = nativeHarness(); const bytes = utf8(JSON.stringify(h.request.body));
    const pool = new GatewayBodyBytePool(bytes.length * 2); const options = { pool, limitBytes: bytes.length };
    const left = await ensureCheckedGatewayBody(bodyRequest([bytes], PATHS[0]).raw, options);
    const right = await ensureCheckedGatewayBody(bodyRequest([bytes], PATHS[2]).raw, options);
    expect(pool.stats.reservedBytes).toBe(pool.capacityBytes);
    const auth = vi.fn(h.deps.config.callerAuth.verify);
    const build = () => createGatewayRouter({ config: { ...h.deps.config, callerAuth: { verify: auth } },
      routePlanner: h.deps.routePlanner, routeMetering: h.deps.metering, budget: h.deps.budget, requestBody: options });
    const apps = [build(), build()];
    const parse = vi.spyOn(JSON, 'parse');
    try {
      for (const app of apps) {
        const { raw, cancel } = bodyRequest([utf8('!')], path);
        const before = parse.mock.calls.length;
        const response = await app.request(raw);
        expect(parse.mock.calls.length).toBe(before);
        expect(response.status).toBe(503); expect(cancel).toHaveBeenCalledTimes(1);
        expect(response.headers.get('retry-after')).toBe('1');
        expect(response.headers.get('x-should-retry')).toBe('true');
        expect(response.headers.has('x-sentropic-relay')).toBe(false);
        expect(response.headers.has('x-sentropic-served')).toBe(false);
        const message = 'Gateway request body capacity is temporarily exhausted; retry later.';
        expect(await response.json()).toEqual(path.includes('chat')
          ? { error: { type: 'api_error', code: 'request_body_capacity', message } }
          : { type: 'error', error: { type: 'api_error', message } });
        expect(pool.stats.reservedBytes).toBe(pool.capacityBytes);
      }
    } finally { parse.mockRestore(); left.release(); right.release(); }
    expect(auth).not.toHaveBeenCalled(); expect(h.calls.quote).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.finalize).not.toHaveBeenCalled();
    expect(h.recorder.events).toEqual([]); expect(h.recorder.settlements).toEqual([]);
    const following = await limitedRouter(h, options).request(bodyRequest([bytes]).raw);
    expect(following.status).toBe(200); expect(h.execute).toHaveBeenCalledTimes(1);
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 5, releases: 5 });
  });
  it('restores partially reserved ingress after an unavailable extension without parsing', async () => {
    const pool = new GatewayBodyBytePool(16); const held = pool.acquire(); held.extend(14);
    const storage = vi.fn((size: number) => new Uint8Array(size));
    const { raw, cancel } = bodyRequest([utf8('{'), utf8('"a')]);
    await expect(ensureCheckedGatewayBody(raw, { pool, limitBytes: 16, storage }))
      .rejects.toMatchObject({ kind: 'request-body-capacity' });
    expect(storage.mock.calls).toEqual([[1]]); expect(cancel).toHaveBeenCalledTimes(1);
    expect(pool.stats).toMatchObject({ reservedBytes: 14, liveLeases: 1, releases: 1 });
    held.release(); expect(pool.stats.reservedBytes).toBe(0);
  });
});

describe('request reference lifetimes', () => {
  it.each(['product', 'standalone'])('native_commit_releases_N_after_host_detach (%s)', async order => {
    const uploadEntered = deferred(); const uploadDone = deferred(); const responseDone = deferred();
    let hostBody: unknown; let hostBytes: Uint8Array | undefined; let reads = 0;
    const close = vi.fn(async () => { responseDone.resolve(); return { done: true as const, value: undefined }; });
    const h = nativeHarness({ execute: async request => {
      hostBody = request.body; hostBytes = utf8(JSON.stringify(request.body)); uploadEntered.resolve();
      await uploadDone.promise; hostBody = undefined; hostBytes = undefined;
      return { kind: 'stream', status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({
        next: async () => ++reads === 1 ? { done: false, value: nativeStart(h.model) }
          : (await responseDone.promise, { done: true, value: undefined }), return: close,
      }) } };
    } });
    const incoming = utf8(JSON.stringify({ ...h.request.body, stream: true }));
    const pool = new GatewayBodyBytePool(incoming.length); const owners: CheckedGatewayBody[] = [];
    const options = { pool, limitBytes: incoming.length };
    const pending = limitedRouter(h, options, order, owners).request(bodyRequest([incoming]).raw);
    await uploadEntered.promise;
    expect(hostBody).toBeDefined(); expect(hostBytes).toBeDefined();
    expect(pool.stats.reservedBytes).toBe(incoming.length); expect(owners[0]!.retainedHolders).toBeGreaterThan(0);
    const following = nativeHarness({ body: { messages: [] } });
    const nextBody = utf8(JSON.stringify(following.request.body));
    const nextApp = limitedRouter(following, options);
    expect((await nextApp.request(bodyRequest([nextBody]).raw)).status).toBe(503);
    uploadDone.resolve(); const response = await pending;
    expect(response.status).toBe(200); h.execute.mockClear();
    expect(hostBody).toBeUndefined(); expect(hostBytes).toBeUndefined();
    expect(owners[0]!.body).toBeUndefined(); expect(owners[0]!.retainedHolders).toBe(0);
    expect(owners[0]!.lease.bytes).toBe(0); expect(pool.stats.reservedBytes).toBe(0);
    expect((await nextApp.request(bodyRequest([nextBody]).raw)).status).toBe(200);
    expect(close).not.toHaveBeenCalled();
    await response.body!.cancel();
    expect(close).toHaveBeenCalledTimes(1); expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.recorder.settlements).toHaveLength(1);
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 3, releases: 3 });
  });
  it.each(['product', 'standalone'])('canonical_commit_retains_N_until_terminal_cleanup (%s)', async order => {
    const done = deferred(); let sdkHolder: unknown; let reads = 0;
    const close = vi.fn(async () => { sdkHolder = undefined; done.resolve(); return { done: true as const, value: undefined }; });
    const h = nativeHarness();
    const { nativeMessages: _native, ...base } = h.attempt;
    const attempt: PreparedRouteAttempt = { ...base, stream: async request => {
      sdkHolder = request;
      return { [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<StreamEvent>> => ++reads === 1
          ? { done: false, value: { type: 'content_delta', data: { delta: 'answer' } } }
          : (await done.promise, { done: true, value: undefined }), return: close,
      }) };
    } };
    h.deps.routePlanner.prepareAttempt = async () => attempt;
    const incoming = utf8(JSON.stringify({ ...h.request.body, safeguards: undefined, stream: true }));
    const pool = new GatewayBodyBytePool(incoming.length); const owners: CheckedGatewayBody[] = [];
    const options = { pool, limitBytes: incoming.length };
    const response = await limitedRouter(h, options, order, owners).request(bodyRequest([incoming]).raw);
    expect(response.status).toBe(200); expect(sdkHolder).toBeDefined();
    expect(owners[0]!.lease.bytes).toBe(incoming.length); expect(pool.stats.reservedBytes).toBe(incoming.length);
    await expect(ensureCheckedGatewayBody(bodyRequest([utf8('{}')]).raw, options)).rejects.toMatchObject({ kind: 'request-body-capacity' });
    await response.body!.cancel();
    expect(close).toHaveBeenCalledTimes(1); expect(sdkHolder).toBeUndefined();
    expect(owners[0]!.body).toBeUndefined(); expect(owners[0]!.retainedHolders).toBe(0);
    expect(h.recorder.settlements).toHaveLength(1); expect(h.finalize).not.toHaveBeenCalled();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 2, releases: 2 });
    const following = await ensureCheckedGatewayBody(bodyRequest([utf8('{}')]).raw, options);
    expect(following.lease.bytes).toBe(2); following.release();
  });
});

describe('body terminal ownership', () => {
  it.each(['json', 'dispatch_error', 'serialization', 'timeout', 'pre_read_error', 'commit_error',
    'late_error', 'eof', 'unconsumed', 'abort', 'complete'])('releases once on %s', async mode => {
    const done = deferred(); let reads = 0;
    const closed = vi.fn(async () => { done.resolve(); return { done: true as const, value: undefined }; });
    const h = nativeHarness({ execute: async () => {
      if (mode === 'dispatch_error') throw Error('dispatch failed');
      if (mode === 'serialization') throw new NativeMessagesUpstreamError({ status: 413,
        requestSize: { requestBytes: 5000, limitBytes: 4096, source: 'gateway' } });
      if (mode === 'timeout') throw new NativeMessagesUpstreamError({ status: 503, code: 'timeout' });
      if (mode === 'json') return { kind: 'json', status: 200, headers: {}, body: { model: 'claude-sonnet-5',
        usage: { input_tokens: 1, output_tokens: 1 } } };
      return { kind: 'stream', status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (mode === 'pre_read_error') throw Error('reader failed');
          if (++reads === 1) return { done: false, value: nativeStart('claude-sonnet-5') };
          if (mode === 'unconsumed' || mode === 'abort') await done.promise;
          if (mode === 'late_error' && reads === 2) return { done: false,
            value: nativeFrame('error', { error: { type: 'overloaded_error', message: 'private' } }) };
          if (mode === 'complete' && reads === 2) return { done: false, value: nativeFrame('message_delta', { usage: { output_tokens: 2 } }) };
          if (mode === 'complete' && reads === 3) return { done: false, value: nativeFrame('message_stop') };
          return { done: true, value: undefined };
        }, return: closed,
      }) } };
    } });
    if (mode === 'commit_error') h.attempt.markCommitted.mockRejectedValue(Error('commit failed'));
    const pool = new GatewayBodyBytePool(4096); const owners: CheckedGatewayBody[] = [];
    const cancellation = new AbortController();
    const response = await limitedRouter(h, { pool, limitBytes: 4096 }, 'product', owners)
      .request(bodyRequest([utf8(JSON.stringify({ ...h.request.body, stream: mode !== 'json' }))], PATHS[0], {}, cancellation.signal).raw);
    const refusal = ['dispatch_error', 'serialization', 'timeout', 'pre_read_error', 'commit_error'].includes(mode);
    expect(response.status).toBe(refusal ? mode === 'serialization' ? 413 : 503 : 200);
    if (mode === 'abort') {
      cancellation.abort(); await Promise.allSettled([response.body!.cancel(), response.body!.cancel()]);
    } else if (mode === 'unconsumed') await response.body!.cancel();
    else await response.text();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
    expect(owners[0]!.body).toBeUndefined(); expect(owners[0]!.retainedHolders).toBe(0);
    expect(h.recorder.settlements).toHaveLength(1); expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(['json', 'dispatch_error', 'serialization', 'timeout'].includes(mode) ? 0 : 1);
    const following = await ensureCheckedGatewayBody(bodyRequest([utf8('{}')]).raw, { pool, limitBytes: 4096 });
    following.release(); expect(pool.stats.reservedBytes).toBe(0);
  });
  it.each(['rejecting', 'never_settling'])('cleanup never waits for a %s finalize hook', async hook => {
    vi.useFakeTimers();
    try {
      const h = nativeHarness({ finalize: async () => {
        if (hook === 'rejecting') throw Error('observation unavailable');
        await new Promise<void>(() => undefined);
      }, execute: async () => ({ kind: 'stream', status: 200, headers: {}, body: {
        async *[Symbol.asyncIterator]() { yield nativeStart('claude-sonnet-5'); yield nativeFrame('message_stop'); },
      } }) });
      const pool = new GatewayBodyBytePool(4096); const owners: CheckedGatewayBody[] = [];
      const response = await limitedRouter(h, { pool, limitBytes: 4096 }, 'standalone', owners)
        .request(bodyRequest([utf8(JSON.stringify({ ...h.request.body, stream: true }))]).raw);
      await response.text();
      expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
      expect(owners[0]!.retainedHolders).toBe(0); expect(h.recorder.settlements).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.finalize).toHaveBeenCalledTimes(1); expect(pool.stats.releases).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});

const generationRefusals = [
  { name: 'caller_auth', status: 401, type: 'authentication_error', message: 'authentication failed' },
  { name: 'partition', status: 401, type: 'authentication_error', message: 'authentication failed' },
  { name: 'safeguards_off', status: 400, type: 'invalid_request_error', message: 'safeguards is not supported by this gateway route; retry without safeguards.' },
  { name: 'native_required', status: 400, type: 'invalid_request_error', message: 'safeguards requires the Anthropic Messages endpoint.' },
  { name: 'native_max_tokens_required', status: 400, type: 'invalid_request_error', message: 'safeguards requires a positive integer max_tokens.' },
  { name: 'unknown_model', status: 404, type: 'not_found_error', message: 'Unknown model: "claude-sonnet-5"' },
  { name: 'native_unavailable', status: 400, type: 'invalid_request_error', message: 'safeguards is not supported by this gateway route; retry without safeguards.' },
  { name: 'quote_failure', status: 503, type: 'overloaded_error', message: 'service temporarily unavailable' },
  { name: 'no_route', status: 503, type: 'api_error', message: 'No route available for model: "claude-sonnet-5"' },
  { name: 'budget_admission', status: 429, type: 'rate_limit_error', message: 'rate limit exceeded' },
  { name: 'prepared_attempt', status: 400, type: 'invalid_request_error', message: 'safeguards is not supported by this gateway route; retry without safeguards.' },
  { name: 'dispatch_mark', status: 503, type: 'overloaded_error', message: 'service temporarily unavailable' },
];
describe('N2 pre-dispatch refusal matrix (count cases follow at row 49a)', () => {
  it.each(generationRefusals.map(row => [row.name, row] as const))('pre_dispatch_%s_restores_capacity_once', async (_name, row) => {
    for (const order of ['product', 'standalone']) for (const stream of [false, true]) for (const rejecting of [false, true]) {
      const h = nativeHarness(); const pool = new GatewayBodyBytePool(4096); const owners: CheckedGatewayBody[] = [];
      const generate = vi.fn(h.attempt.generate); const dispatchStream = vi.fn(h.attempt.stream);
      h.attempt.generate = generate; h.attempt.stream = dispatchStream;
      const overrides: { -readonly [K in keyof CreateGatewayRouterOptions]?: CreateGatewayRouterOptions[K] } = {};
      let controller = new AbortController(); const body: Record<string, unknown> = { ...h.request.body, stream };
      switch (row.name) {
        case 'caller_auth': case 'partition':
          overrides.config = { ...h.deps.config, callerAuth: { async verify() { return { ok: false, reason: row.name }; } } }; break;
        case 'safeguards_off': overrides.nativeMessagesEnabled = false; break;
        case 'native_max_tokens_required': overrides.budget = undefined; delete body.max_tokens; break;
        case 'unknown_model': case 'native_unavailable':
          h.deps.routePlanner.quote = () => { throw new RouteQuoteError('refused', row.name === 'unknown_model' ? 'unknown-model' : 'native-unavailable'); }; break;
        case 'quote_failure': h.deps.routePlanner.quote = () => { throw Error('quote failed'); }; break;
        case 'no_route': h.deps.routePlanner.quote = () => fixtureQuote({ requestedModel: h.model, candidates: [] }); break;
        case 'budget_admission': h.recorder.port.admit = async input => {
          h.recorder.events.push('admit'); h.recorder.admitted.push(input);
          return { kind: 'over-budget', resetAtMs: h.deps.budget.now!() + 1000 };
        }; break;
        case 'prepared_attempt': h.attempt.nativeMessages.apiVersions = []; break;
        case 'dispatch_mark': h.recorder.port.markDispatched = async () => { throw Error('mark failed'); }; break;
      }
      const originalSettle = h.recorder.metering.settleRoute;
      h.recorder.metering.settleRoute = async value => { await originalSettle(value); if (rejecting) throw Error('sink failed'); };
      const originalRelease = h.recorder.port.release;
      h.recorder.port.release = async hold => { await originalRelease(hold); if (rejecting) throw Error('release failed'); };
      if (rejecting) h.attempt.releaseCancelled.mockImplementation(async () => { controller.abort(); throw Error('cleanup failed'); });
      const path = row.name === 'native_required' ? PATHS[1]! : PATHS[0]!;
      const app = limitedRouter(h, { pool, limitBytes: 4096 }, order, owners, overrides);
      for (let repeat = 1; repeat <= 2; repeat += 1) {
        controller = new AbortController();
        const response = await app.request(bodyRequest([utf8(JSON.stringify(body))], path, {}, controller.signal).raw);
        expect(response.status).toBe(row.status);
        expect(await response.json()).toEqual(path.includes('chat')
          ? { error: { type: row.type, code: 'invalid_request', message: row.message } }
          : { type: 'error', error: { type: row.type, message: row.message } });
        expect(h.execute).not.toHaveBeenCalled(); expect(h.finalize).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled(); expect(dispatchStream).not.toHaveBeenCalled();
        expect(owners.at(-1)!.body).toBeUndefined(); expect(owners.at(-1)!.retainedHolders).toBe(0);
        expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: repeat * 2 - 1, releases: repeat * 2 - 1 });
        const settled = ['prepared_attempt', 'dispatch_mark'].includes(row.name);
        expect(h.recorder.settlements).toHaveLength(settled ? repeat : 0);
        expect(h.recorder.events.filter(event => event.startsWith('release:'))).toHaveLength(settled ? repeat : 0);
        expect(h.recorder.admitted).toHaveLength(settled || row.name === 'budget_admission' ? repeat : 0);
        if (settled) expect(h.recorder.settlements.at(-1)!.usage).toEqual({ inputTokens: 0, outputTokens: 0, estimated: false });
        // A distinct following generation proves returned capacity, without reusing refusal callbacks.
        const following = nativeHarness(); const next = await limitedRouter(following, { pool, limitBytes: 4096 })
          .request(bodyRequest([utf8(JSON.stringify(following.request.body))]).raw);
        expect(next.status).toBe(200); expect(following.execute).toHaveBeenCalledTimes(1);
        expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: repeat * 2, releases: repeat * 2 });
      }
    }
  });
  it('product session denial before the cap acquires and releases nothing', async () => {
    const pool = new GatewayBodyBytePool(4096); const storage = vi.fn(); const app = new Hono();
    app.use('*', async c => c.json({ error: 'session denied' }, 401));
    app.use('*', gatewayRequestBodyLimit({ pool, limitBytes: 4096, storage }));
    const response = await app.request(bodyRequest([utf8('{}')]).raw);
    expect(response.status).toBe(401); expect(storage).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ reservedBytes: 0, liveLeases: 0, acquisitions: 0, releases: 0 });
  });
});

const fourKiBBody = (h: ReturnType<typeof nativeHarness>, stream: boolean) => {
  const body = { ...h.request.body, safeguards: undefined, stream, padding: '' };
  body.padding = 'x'.repeat(4096 - utf8(JSON.stringify(body)).length);
  const bytes = utf8(JSON.stringify(body)); expect(bytes.length).toBe(4096); return bytes;
};
describe('default byte pool overlap on one replica', () => {
  it.each([['product', false], ['product', true], ['standalone', false], ['standalone', true]] as const)(
    'admits 64x4 KiB plus open native/canonical streams (%s, native=%s)', async (order, enabled) => {
      const baseline = defaultGatewayBodyBytePool.stats;
      expect(baseline.reservedBytes).toBe(0); expect(baseline.liveLeases).toBe(0);
      const nativeDone = deferred(); const nativeClosed = vi.fn();
      const open = nativeHarness({ execute: async () => {
        let reads = 0;
        return { kind: 'stream', status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({
          next: async () => ++reads === 1 ? { done: false, value: nativeStart('claude-sonnet-5') }
            : (await nativeDone.promise, { done: true, value: undefined }),
          return: async () => { nativeClosed(); nativeDone.resolve(); return { done: true, value: undefined }; },
        }) } };
      } });
      const sdkHolders = new Set<unknown>(); const canonicalClosed = vi.fn();
      open.attempt.stream = async request => {
        let holder: unknown = request;
        sdkHolders.add(holder); const done = deferred(); let reads = 0;
        return { [Symbol.asyncIterator]: () => ({
          next: async (): Promise<IteratorResult<StreamEvent>> => ++reads === 1
            ? { done: false, value: { type: 'content_delta', data: { delta: 'first' } } }
            : (await done.promise, { done: true, value: undefined }),
          return: async () => { sdkHolders.delete(holder); holder = undefined; canonicalClosed(); done.resolve(); return { done: true, value: undefined }; },
        }) };
      };
      const openOwners: CheckedGatewayBody[] = [];
      const openApp = limitedRouter(open, {}, order, openOwners, { nativeMessagesEnabled: enabled });
      const openBody = fourKiBBody(open, true);
      const messages = await openApp.request(bodyRequest([openBody], PATHS[0], { 'anthropic-beta': 'future-feature' }).raw);
      const chat = await openApp.request(bodyRequest([openBody], PATHS[1]).raw);
      expect(messages.status).toBe(200); expect(chat.status).toBe(200);
      const retained = enabled ? 4096 : 8192;
      expect(sdkHolders.size).toBe(enabled ? 1 : 2);
      expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(retained);
      expect(openOwners.map(owner => owner.lease.bytes)).toEqual(enabled ? [0, 4096] : [4096, 4096]);
      const allEntered = deferred(); const allow = deferred(); let entered = 0;
      const enter = async () => { if (++entered === 64) allEntered.resolve(); await allow.promise; };
      const h = nativeHarness(); h.attempt.generate = textResponse({ inputTokens: 2, outputTokens: 1 });
      const config = { ...h.deps.config, callerAuth: { async verify() { await enter(); return h.deps.config.callerAuth.verify(); } } };
      const apps = Array.from({ length: 4 }, () => {
        const app = limitedRouter(h, {}, order, [], { config, nativeMessagesEnabled: enabled });
        // Count handler is an ingress-only stub; row 49a owns the actual count refusal matrix.
        app.post(PATHS[2]!, async c => { await enter(); return c.json({ input_tokens: 1 }); });
        return app;
      });
      const body = fourKiBBody(h, false);
      const pending = Array.from({ length: 64 }, (_, index) => apps[index % apps.length]!
        .request(bodyRequest([body], PATHS[index % 3], { 'anthropic-beta': 'future-feature' }).raw));
      await allEntered.promise;
      expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(retained + 262144);
      expect(defaultGatewayBodyBytePool.stats.liveLeases).toBe(66);
      expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBeLessThan(defaultGatewayBodyBytePool.capacityBytes);
      expect(h.recorder.admitted).toEqual([]); expect(h.execute).not.toHaveBeenCalled();
      allow.resolve(); const responses = await Promise.all(pending);
      expect(responses.map(response => response.status)).toEqual(Array(64).fill(200));
      expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(retained);
      expect(nativeClosed).not.toHaveBeenCalled(); expect(canonicalClosed).not.toHaveBeenCalled();
      expect((await apps[0]!.request(bodyRequest([body], PATHS[0], { 'anthropic-beta': 'future-feature' }).raw)).status).toBe(200);
      expect((await apps[1]!.request(bodyRequest([body], PATHS[2]).raw)).status).toBe(200);
      await Promise.all([messages.body!.cancel(), chat.body!.cancel()]);
      expect(sdkHolders.size).toBe(0); expect(canonicalClosed).toHaveBeenCalledTimes(enabled ? 1 : 2);
      expect(nativeClosed).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(defaultGatewayBodyBytePool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0,
        acquisitions: baseline.acquisitions + 68, releases: baseline.releases + 68 });
    });
});
