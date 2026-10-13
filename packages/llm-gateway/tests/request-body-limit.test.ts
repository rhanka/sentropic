import { describe, expect, it } from 'vitest';
import {
  CheckedGatewayBody, defaultGatewayBodyBytePool, GatewayBodyBytePool, GATEWAY_INFLIGHT_BODY_BYTES,
  REQUEST_BODY_CAPACITY_MESSAGE, retainGatewayStreamBody,
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
