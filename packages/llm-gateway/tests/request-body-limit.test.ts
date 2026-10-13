import { describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import {
  CheckedGatewayBody, createGatewayRouter, defaultGatewayBodyBytePool, ensureCheckedGatewayBody, GatewayBodyBytePool,
  GATEWAY_INFLIGHT_BODY_BYTES, GATEWAY_MAX_REQUEST_BODY_BYTES, gatewayRequestBodyLimit,
  isGatewayBodyPath, REQUEST_BODY_CAPACITY_MESSAGE, resolveGatewayBodyLimit,
  resolveGatewayBodyRoute, retainGatewayStreamBody, type RequestBodyLimitOptions,
} from '../src/index.js';
import { GatewayError, mapGatewayError } from '../src/index.js';
import { nativeHarness, nativeFrame, nativeStart } from './fixtures/native-flow.js';
import { NativeMessagesUpstreamError, type PreparedRouteAttempt, type StreamEvent } from '@sentropic/llm-mesh';

// Fold lots N03-N07 grow this file: N03 covers the shared byte pool only.
// Reader, retention, middleware order and flow lifetimes follow per lot.
describe('shared byte pool (N03)', () => {
  it('reserves actual bytes incrementally with exact stats', () => {
    const pool = new GatewayBodyBytePool(16);
    const lease = pool.acquire();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 1, acquisitions: 1, releases: 0 });
    expect(lease.bytes).toBe(0);
    lease.extend(10); lease.extend(6);
    expect(lease.bytes).toBe(16);
    expect(pool.stats).toMatchObject({ reservedBytes: 16, liveLeases: 1 });
    lease.shrink(4);
    expect(lease.bytes).toBe(4);
    expect(pool.stats.reservedBytes).toBe(4);
    lease.release();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
    lease.release();
    expect(pool.stats.releases).toBe(1);
  });

  it('rejects invalid capacity and lease operations without reserving', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) {
      expect(() => new GatewayBodyBytePool(capacity)).toThrow('Invalid gateway body capacity');
    }
    const pool = new GatewayBodyBytePool(8);
    const lease = pool.acquire();
    for (const bytes of [-1, 0.5]) {
      expect(() => lease.extend(bytes)).toThrow('Invalid gateway body extension');
    }
    expect(() => lease.shrink(1)).toThrow('Invalid gateway body shrink');
    lease.extend(8);
    expect(() => lease.shrink(9)).toThrow('Invalid gateway body shrink');
    expect(pool.stats.reservedBytes).toBe(8);
    lease.release();
  });

  it('refuses unavailable extensions with a retryable capacity error and keeps held bytes', () => {
    const pool = new GatewayBodyBytePool(16);
    const lease = pool.acquire(); lease.extend(16);
    let failure: unknown;
    try { lease.extend(1); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(GatewayError);
    expect((failure as GatewayError).kind).toBe('request-body-capacity');
    expect(lease.bytes).toBe(16);
    expect(pool.stats).toMatchObject({ reservedBytes: 16, liveLeases: 1 });
    const anthropic = mapGatewayError('anthropic-messages', 'request-body-capacity');
    expect(anthropic.status).toBe(503);
    expect(anthropic.headers).toEqual({ 'Retry-After': '1', 'x-should-retry': 'true' });
    const openai = mapGatewayError('openai-chat-completions', 'request-body-capacity');
    expect(openai.status).toBe(503);
    expect(openai.headers).toEqual({ 'Retry-After': '1', 'x-should-retry': 'true' });
    lease.release();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0 });
  });

  it('shares one process-default 32 MB pool without reserving on acquire', () => {
    expect(defaultGatewayBodyBytePool).toBeInstanceOf(GatewayBodyBytePool);
    expect(defaultGatewayBodyBytePool.capacityBytes).toBe(GATEWAY_INFLIGHT_BODY_BYTES);
    expect(GATEWAY_INFLIGHT_BODY_BYTES).toBe(32_000_000);
    const first = defaultGatewayBodyBytePool.acquire();
    const second = defaultGatewayBodyBytePool.acquire();
    expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(0);
    first.extend(7); second.extend(9);
    expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(16);
    expect(REQUEST_BODY_CAPACITY_MESSAGE).toContain('retry later');
    first.release(); second.release();
    expect(defaultGatewayBodyBytePool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0 });
  });
});

describe('checked body owner (N04)', () => {
  const ownerFor = () => {
    const pool = new GatewayBodyBytePool(64);
    const lease = pool.acquire(); lease.extend(9);
    return { pool, owner: new CheckedGatewayBody({ model: 'm' }, 9, lease) };
  };

  it('counts holders and detaches before shrinking the lease', () => {
    const { pool, owner } = ownerFor();
    expect(owner.retainedHolders).toBe(1);
    const cleared: string[] = [];
    owner.trackDetach(() => { cleared.push('first'); });
    owner.trackDetach(() => { cleared.push('second'); });
    expect(owner.retainedHolders).toBe(3);
    owner.detach();
    expect(cleared).toEqual(['first', 'second']);
    expect(owner.body).toBeUndefined();
    expect(owner.retainedHolders).toBe(0);
    expect(owner.lease.bytes).toBe(0);
    expect(pool.stats.reservedBytes).toBe(0);
    owner.trackDetach(() => { cleared.push('late'); });
    expect(cleared).toEqual(['first', 'second', 'late']);
  });

  it('releases once across detach/release races', () => {
    const { pool, owner } = ownerFor();
    owner.detach(); owner.release(); owner.release();
    expect(owner.body).toBeUndefined();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
  });

  it('transfers stream ownership and cleans a started then abandoned iterator', async () => {
    const { pool, owner } = ownerFor();
    const returned: string[] = [];
    async function* source(): AsyncGenerator<string, void, unknown> {
      try { yield 'frame'; } finally { returned.push('upstream'); }
    }
    const wrapped = retainGatewayStreamBody(source(), owner);
    expect(owner.transferred).toBe(true);
    await expect(wrapped.next()).resolves.toEqual({ done: false, value: 'frame' });
    await wrapped.return(undefined);
    expect(returned).toEqual(['upstream']);
    expect(owner.body).toBeUndefined();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
  });

  it('releases the owner even when the downstream never starts the iterator', async () => {
    const { pool, owner } = ownerFor();
    async function* source(): AsyncGenerator<string, void, unknown> {
      yield 'never read';
    }
    const wrapped = retainGatewayStreamBody(source(), owner);
    await wrapped.return(undefined);
    expect(owner.body).toBeUndefined();
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
  });

  it('aborts a pending stream and preserves the original read failure', async () => {
    const { pool, owner } = ownerFor();
    const controller = new AbortController();
    const failure = Error('reader failed');
    async function* source(): AsyncGenerator<string, void, unknown> {
      yield 'frame';
      throw failure;
    }
    const wrapped = retainGatewayStreamBody(source(), owner, controller.signal);
    await expect(wrapped.next()).resolves.toEqual({ done: false, value: 'frame' });
    controller.abort();
    await expect(wrapped.next()).rejects.toBe(failure);
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
    expect(owner.body).toBeUndefined();
  });
});

describe('body path matrix (N05)', () => {
  const post = (path: string) => new Request(`https://gateway.test${path}`, { method: 'POST' });

  it.each([
    ['/v1/messages', 'anthropic-messages', false],
    ['/v1/chat/completions', 'openai-chat-completions', false],
    ['/responses', 'openai-responses', true],
    ['/v1/responses', 'openai-responses', true],
    ['/v1/messages/count_tokens', 'anthropic-messages', false],
  ] as const)('resolves bare %s to %s', (path, wire, responses) => {
    expect(resolveGatewayBodyRoute(post(path))).toEqual({ path, wire, responses });
    expect(isGatewayBodyPath(post(path))).toBe(true);
  });

  it.each([
    '/api/v1/gw/v1/messages', '/api/v1/gw/responses', '/api/v1/gw/v1/responses',
    '/api/v1/gw/v1/messages/count_tokens', '/gw/v1/messages', '/gw/v1/chat/completions',
  ])('resolves product-mounted %s after its trusted prefix', (path) => {
    const prefix = path.startsWith('/api/v1/gw') ? '/api/v1/gw' : '/gw';
    expect(isGatewayBodyPath(post(path), prefix)).toBe(true);
    expect(isGatewayBodyPath(post(path))).toBe(false);
  });

  it.each([
    ['GET', '/v1/messages', ''],
    ['POST', '/v1/messagesx', ''],
    ['POST', '/v1/messages/', ''],
    ['POST', '/api/v1/messages', ''],
    ['POST', '/v1/v1/messages', ''],
    ['POST', '/responses/count_tokens', ''],
    ['POST', '/v1/messages/count_tokens/extra', ''],
    ['POST', '/api/v1/gw/v1/messages', '/gw'],
    ['POST', '/gw/v1/messages', '/api/v1/gw'],
  ] as const)('rejects lookalike %s %s (prefix %s)', (method, path, prefix) => {
    const request = new Request(`https://gateway.test${path}`, { method });
    expect(resolveGatewayBodyRoute(request, prefix || undefined)).toBeUndefined();
    expect(isGatewayBodyPath(request, prefix || undefined)).toBe(false);
  });

  it('resolves effective limits per wire with the smaller validated host cap', () => {
    expect(resolveGatewayBodyLimit(false, {})).toBe(32_000_000);
    expect(resolveGatewayBodyLimit(false, { limitBytes: 8 })).toBe(8);
    expect(resolveGatewayBodyLimit(true, {})).toBe(16_777_216);
    expect(resolveGatewayBodyLimit(true, { responsesLimitBytes: 4096 })).toBe(4096);
    expect(resolveGatewayBodyLimit(true, { limitBytes: 1024 })).toBe(1024);
    expect(resolveGatewayBodyLimit(true, { limitBytes: 64_000_000, responsesLimitBytes: 64_000_000 }))
      .toBe(16_777_216);
    expect(GATEWAY_MAX_REQUEST_BODY_BYTES).toBe(32_000_000);
  });
});

describe('bounded checked read (N05)', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const bodyRequest = (chunks: readonly Uint8Array[], path = '/v1/messages',
    headers: Record<string, string> = {}, signal?: AbortSignal) => {
    let index = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); else controller.close(); },
      cancel,
    });
    const raw = new Request(`https://gateway.test${path}`, { method: 'POST', body, headers, signal,
      duplex: 'half' } as RequestInit & { duplex: 'half' });
    return { raw, cancel };
  };

  it.each([0, 1])('accepts exact/below cap and parses split multibyte input once (headroom=%s)', async headroom => {
    const bytes = utf8('{"model":"é😀","content":"hello"}');
    const text = new TextDecoder().decode(bytes);
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
      // The checked body parses its exact text once; the runner may parse
      // sourcemaps on a cold cache, so filter by parsed input, not by total.
      expect(parse.mock.calls.filter((call) => call[0] === text)).toHaveLength(1);
      expect(pool.stats.acquisitions).toBe(1);
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

  it.each([undefined, '0', '1', '32000000', '999999999'])('ignores Content-Length %s for grants and exact EOF size', async length => {
    const pool = new GatewayBodyBytePool(32); const granted: number[] = [];
    const bytes = utf8('{"text":"é😀"}');
    const storage = (size: number) => { granted.push(pool.stats.reservedBytes); return new Uint8Array(size); };
    const { raw } = bodyRequest([bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5)], '/v1/messages',
      length === undefined ? {} : { 'content-length': length });
    const owner = await ensureCheckedGatewayBody(raw, { pool, limitBytes: 32, storage });
    expect(granted).toEqual([2, 5, bytes.length]);
    expect(owner.bytes).toBe(bytes.length); expect(owner.lease.bytes).toBe(bytes.length);
    expect(owner.body).toEqual({ text: 'é😀' }); expect(raw.body!.locked).toBe(false);
    owner.release(); expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
  });

  it('actual oversize has 413 precedence over unavailable capacity on the returned chunk', async () => {
    const pool = new GatewayBodyBytePool(8); const held = pool.acquire(); held.extend(3);
    const storage = vi.fn((size: number) => new Uint8Array(size));
    const { raw, cancel } = bodyRequest([utf8('{} '), utf8('abcdef')], '/v1/chat/completions', { 'content-length': '1' });
    await expect(ensureCheckedGatewayBody(raw, { pool, limitBytes: 8, storage })).rejects.toMatchObject({
      kind: 'request-too-large', requestSize: { requestBytes: 9, limitBytes: 8, source: 'gateway', sizeIsLowerBound: true },
    });
    expect(storage.mock.calls).toEqual([[3]]); expect(cancel).toHaveBeenCalledTimes(1);
    expect(raw.body!.locked).toBe(false); expect(pool.stats.reservedBytes).toBe(3);
    held.release(); expect(pool.stats.reservedBytes).toBe(0);
  });

  it.each([false, true])('abort preserves its reason and restores partial bytes even if reader cancellation rejects (%s)', async rejecting => {
    const pool = new GatewayBodyBytePool(32);
    let markStored!: () => void;
    const stored = new Promise<void>((resolve) => { markStored = resolve; });
    const abort = new AbortController(); const reason = new DOMException('Ingress timeout', 'TimeoutError');
    const cancel = vi.fn(async () => { if (rejecting) throw Error('reader cancel failed'); });
    const raw = new Request('https://gateway.test/v1/messages', { method: 'POST', signal: abort.signal,
      body: new ReadableStream({ start(controller) { controller.enqueue(utf8('{')); }, cancel }), duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const pending = ensureCheckedGatewayBody(raw, { pool, limitBytes: 32,
      storage: size => { markStored(); return new Uint8Array(size); } });
    await stored; expect(pool.stats.reservedBytes).toBe(1);
    const refused = expect(pending).rejects.toBe(reason);
    abort.abort(reason); await refused;
    expect(cancel).toHaveBeenCalledTimes(1); expect(raw.body!.locked).toBe(false);
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, acquisitions: 1, releases: 1 });
  });

  it('read failure releases received chunks without fabricating a numeric 413', async () => {
    const pool = new GatewayBodyBytePool(32);
    let markStored!: () => void;
    const stored = new Promise<void>((resolve) => { markStored = resolve; });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const raw = new Request('https://gateway.test/v1/messages', { method: 'POST', duplex: 'half',
      body: new ReadableStream<Uint8Array>({ start(input) { controller = input; input.enqueue(utf8('{"')); } }),
    } as RequestInit & { duplex: 'half' });
    const pending = ensureCheckedGatewayBody(raw, { pool, limitBytes: 32,
      storage: size => { markStored(); return new Uint8Array(size); } });
    await stored; expect(pool.stats.reservedBytes).toBe(2);
    const failure = Error('transport read failed'); const refused = expect(pending).rejects.toBe(failure);
    controller.error(failure); await refused;
    expect(raw.body!.locked).toBe(false); expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
  });

  it('product session denial before the cap acquires and releases nothing', async () => {
    const pool = new GatewayBodyBytePool(4096); const storage = vi.fn(); const app = new Hono();
    app.use('*', async c => c.json({ error: 'session denied' }, 401));
    app.use('*', gatewayRequestBodyLimit({ pool, limitBytes: 4096, storage }));
    const response = await app.request(bodyRequest([utf8('{}')]).raw);
    expect(response.status).toBe(401); expect(storage).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ reservedBytes: 0, liveLeases: 0, acquisitions: 0, releases: 0 });
  });

  it.each(['/responses', '/v1/responses'])('reads %s under the smaller Responses cap', async path => {
    const pool = new GatewayBodyBytePool(96);
    const bytes = utf8(JSON.stringify({ model: 'm', input: 'x'.repeat(48) }));
    const over = utf8(`${JSON.stringify({ model: 'm', input: 'x'.repeat(48) })} `);
    const ok = await ensureCheckedGatewayBody(bodyRequest([bytes], path).raw,
      { pool, limitBytes: 96, responsesLimitBytes: bytes.length });
    expect(ok.bytes).toBe(bytes.length); ok.release();
    await expect(ensureCheckedGatewayBody(bodyRequest([over], path).raw,
      { pool, limitBytes: 96, responsesLimitBytes: bytes.length }))
      .rejects.toMatchObject({ kind: 'request-too-large' });
    expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0 });
  });
});

describe('shared ingress capacity (row 44a)', () => {
  const PATHS = ['/v1/messages', '/v1/chat/completions', '/v1/messages/count_tokens'];
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const bodyRequest = (chunks: readonly Uint8Array[], path = PATHS[0]!) => {
    let index = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); else controller.close(); }, cancel,
    });
    const raw = new Request(`https://gateway.test${path}`, { method: 'POST', body,
      duplex: 'half' } as RequestInit & { duplex: 'half' });
    return { raw, cancel };
  };
  const limitedRouter = (h: ReturnType<typeof nativeHarness>, options: RequestBodyLimitOptions,
    owners: CheckedGatewayBody[] = []) => {
    const app = new Hono();
    const inspect: MiddlewareHandler = async (c, next) => {
      owners.push(await ensureCheckedGatewayBody(c.req.raw, options)); await next();
    };
    app.use('*', gatewayRequestBodyLimit(options));
    app.use('*', inspect);
    app.route('/', createGatewayRouter({ config: h.deps.config, routePlanner: h.deps.routePlanner,
      routeMetering: h.deps.metering, budget: h.deps.budget, nativeMessagesEnabled: true,
      requestBody: options, requestId: () => 'req-native' }));
    return app;
  };

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

describe('request reference lifetimes (row 44b1a)', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };
  const bodyRequest = (chunks: readonly Uint8Array[], path = '/v1/messages') => {
    let index = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); else controller.close(); }, cancel,
    });
    const raw = new Request(`https://gateway.test${path}`, { method: 'POST', body,
      duplex: 'half' } as RequestInit & { duplex: 'half' });
    return { raw, cancel };
  };
  const limitedRouter = (h: ReturnType<typeof nativeHarness>, options: RequestBodyLimitOptions,
    order: 'product' | 'standalone' = 'product', owners: CheckedGatewayBody[] = []) => {
    const app = new Hono();
    const inspect: MiddlewareHandler = async (c, next) => {
      owners.push(await ensureCheckedGatewayBody(c.req.raw, options)); await next();
    };
    if (order === 'standalone') app.use('*', (c, next) => gatewayRequestBodyLimit(options)(c, async () => { await inspect(c, next); }));
    app.use('*', gatewayRequestBodyLimit(options));
    if (order === 'product') app.use('*', inspect);
    app.route('/', createGatewayRouter({ config: h.deps.config, routePlanner: h.deps.routePlanner,
      routeMetering: h.deps.metering, budget: h.deps.budget, nativeMessagesEnabled: true,
      requestBody: options, requestId: () => 'req-native' }));
    return app;
  };

  it.each(['product', 'standalone'] as const)('native_commit_releases_N_after_host_detach (%s)', async order => {
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
  it.each(['product', 'standalone'] as const)('canonical_commit_retains_N_until_terminal_cleanup (%s)', async order => {
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

describe('body terminal ownership (row 44b1b)', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };
  const bodyRequest = (chunks: readonly Uint8Array[], path = '/v1/messages',
    headers: Record<string, string> = {}, signal?: AbortSignal) => {
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
    owners: CheckedGatewayBody[] = []) => {
    const app = new Hono();
    const inspect: MiddlewareHandler = async (c, next) => {
      owners.push(await ensureCheckedGatewayBody(c.req.raw, options)); await next();
    };
    app.use('*', gatewayRequestBodyLimit(options));
    app.use('*', inspect);
    app.route('/', createGatewayRouter({ config: h.deps.config, routePlanner: h.deps.routePlanner,
      routeMetering: h.deps.metering, budget: h.deps.budget, nativeMessagesEnabled: true,
      requestBody: options, requestId: () => 'req-native' }));
    return app;
  };

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
    const response = await limitedRouter(h, { pool, limitBytes: 4096 }, owners)
      .request(bodyRequest([utf8(JSON.stringify({ ...h.request.body, stream: mode !== 'json' }))], '/v1/messages', {}, cancellation.signal).raw);
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
  it.each(['rejecting', 'never_settling'] as const)('cleanup never waits for a %s finalize hook', async hook => {
    vi.useFakeTimers();
    try {
      const h = nativeHarness({ finalize: async () => {
        if (hook === 'rejecting') throw Error('observation unavailable');
        await new Promise<void>(() => undefined);
      }, execute: async () => ({ kind: 'stream', status: 200, headers: {}, body: {
        async *[Symbol.asyncIterator]() { yield nativeStart('claude-sonnet-5'); yield nativeFrame('message_stop'); },
      } }) });
      const pool = new GatewayBodyBytePool(4096); const owners: CheckedGatewayBody[] = [];
      const response = await limitedRouter(h, { pool, limitBytes: 4096 }, owners)
        .request(bodyRequest([utf8(JSON.stringify({ ...h.request.body, stream: true }))]).raw);
      await response.text();
      expect(pool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0, releases: 1 });
      expect(owners[0]!.retainedHolders).toBe(0); expect(h.recorder.settlements).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.finalize).toHaveBeenCalledTimes(1); expect(pool.stats.releases).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
