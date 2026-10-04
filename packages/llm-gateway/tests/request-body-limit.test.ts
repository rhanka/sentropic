import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckedGatewayBody, GatewayBodyBytePool, createGatewayRouter, defaultGatewayBodyBytePool,
  ensureCheckedGatewayBody, gatewayRequestBodyLimit, type RequestBodyLimitOptions,
} from '../src/index.js';
import { nativeHarness, nativeFrame, nativeStart } from './fixtures/native-flow.js';
import type { PreparedRouteAttempt, StreamEvent } from '@sentropic/llm-mesh';

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
  order = 'product', owners: CheckedGatewayBody[] = []) => {
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
    requestBody: options, requestId: () => 'req-native' }));
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
