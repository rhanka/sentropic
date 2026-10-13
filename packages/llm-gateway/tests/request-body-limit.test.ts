import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  CheckedGatewayBody, defaultGatewayBodyBytePool, ensureCheckedGatewayBody, GatewayBodyBytePool,
  GATEWAY_INFLIGHT_BODY_BYTES, GATEWAY_MAX_REQUEST_BODY_BYTES, gatewayRequestBodyLimit,
  isGatewayBodyPath, REQUEST_BODY_CAPACITY_MESSAGE, resolveGatewayBodyLimit,
  resolveGatewayBodyRoute, retainGatewayStreamBody,
} from '../src/index.js';
import { GatewayError, mapGatewayError } from '../src/index.js';

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
});
