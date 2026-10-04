import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckedGatewayBody, GatewayBodyBytePool, createGatewayRouter, defaultGatewayBodyBytePool,
  ensureCheckedGatewayBody, gatewayRequestBodyLimit, type RequestBodyLimitOptions,
} from '../src/index.js';
import { nativeHarness, nativeFrame, nativeStart } from './fixtures/native-flow.js';

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
  if (order === 'standalone') app.use('*', inspect);
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
    const { raw, cancel } = bodyRequest([utf8('not JSON at all!!!')], path);
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
