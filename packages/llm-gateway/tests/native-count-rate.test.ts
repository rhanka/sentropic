/**
 * Native count_tokens rate limiter (Lot 3 round 2): process-local engineering
 * limits keyed by verified tenant/principal. Ported from the native relay
 * draft (#633) so the two branches converge on the same limiter contract.
 */

import { describe, expect, it } from 'vitest';
import { GatewayError, NativeCountTokensRateLimiter, NativeCountTokensRefusal } from '../src/index.js';

const identity = (principalId = 'principal-a') =>
  ({ tenantId: 'tenant-1', principalId });

const refusalResponse = (call: () => unknown) => {
  try {
    call();
  } catch (error) {
    if (!(error instanceof NativeCountTokensRefusal)) throw error;
    return error.response;
  }
  throw new Error('expected count refusal');
};
const refusalStatus = (call: () => unknown) => refusalResponse(call).status;

describe('NativeCountTokensRateLimiter', () => {
  it('gives distinct principals independent limits', () => {
    const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, now: () => 0 });
    expect(rate.acquire(identity('a'))).toBeTypeOf('function');
    expect(() => rate.acquire(identity('a'))).toThrow(NativeCountTokensRefusal);
    const blocked = (() => {
      try { rate.acquire(identity('a')); } catch (error) { return error as NativeCountTokensRefusal; }
    })()!;
    expect(blocked.response.status).toBe(429);
    expect(blocked.response.headers?.['Retry-After']).toBe('1');
    expect(rate.acquire(identity('b'))).toBeTypeOf('function');
  });

  it('shares one bucket across sessions of the same principal', () => {
    const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, now: () => 0 });
    rate.acquire(identity('a'));
    expect(() => rate.acquire(identity('a'))).toThrow(NativeCountTokensRefusal);
  });

  it('prefers Retry-After 1 for concurrency and larger windows for starvation', () => {
    const concurrent = new NativeCountTokensRateLimiter({ capacity: 5, maxInFlight: 1, now: () => 0 });
    concurrent.acquire(identity());
    try {
      concurrent.acquire(identity());
      expect.unreachable('second concurrent call must refuse');
    } catch (error) {
      expect((error as NativeCountTokensRefusal).response.headers?.['Retry-After']).toBe('1');
    }
    const starved = new NativeCountTokensRateLimiter({ capacity: 1, refillPerSecond: 0.5, now: () => 0 });
    starved.acquire(identity());
    try {
      starved.acquire(identity());
      expect.unreachable('starved call must refuse');
    } catch (error) {
      expect((error as NativeCountTokensRefusal).response.headers?.['Retry-After']).toBe('2');
    }
  });

  it('releases in-flight slots exactly once and refills over time', () => {
    let now = 0;
    const rate = new NativeCountTokensRateLimiter({ capacity: 2, maxInFlight: 1, now: () => now });
    const release = rate.acquire(identity());
    expect(() => rate.acquire(identity())).toThrow(NativeCountTokensRefusal); // concurrency
    release();
    release(); // idempotent
    rate.acquire(identity())(); // slot freed, one token left, returned and released
    expect(() => rate.acquire(identity())).toThrow(NativeCountTokensRefusal); // starved
    now = 1000;
    expect(rate.acquire(identity())).toBeTypeOf('function'); // refilled
  });

  it('drops idle buckets and fails closed at key capacity', () => {
    let now = 0;
    const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, idleMs: 1000, maxKeys: 1, now: () => now });
    rate.acquire(identity('a'))();
    now = 2000; // bucket a is idle and removable
    rate.acquire(identity('b'))();
    const capped = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, maxKeys: 1, now: () => 0 });
    capped.acquire(identity('a'))();
    try {
      capped.acquire(identity('b'));
      expect.unreachable('key capacity must fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).kind).toBe('pooled-account-unavailable');
    }
  });

  it('allows the default ten-call burst and one refill per second without refund on release', () => {
    let now = 0;
    const rate = new NativeCountTokensRateLimiter({ now: () => now });
    for (let index = 0; index < 10; index++) {
      const done = rate.acquire(identity());
      done();
      done();
    }
    expect(refusalResponse(() => rate.acquire(identity()))).toEqual({ status: 429,
      headers: { 'Retry-After': '1' },
      body: { type: 'error', error: { type: 'rate_limit_error',
        message: 'Token counting request limit exceeded.' } } });
    now = 999;
    expect(refusalStatus(() => rate.acquire(identity()))).toBe(429);
    now = 1000;
    rate.acquire(identity())();
    expect(refusalStatus(() => rate.acquire(identity()))).toBe(429);
  });

  it('uses integer Retry-After from fractional refill and never mints tokens on clock reversal', () => {
    let now = 1000;
    const rate = new NativeCountTokensRateLimiter({ capacity: 1, refillPerSecond: 0.25, now: () => now });
    rate.acquire(identity())();
    now = 1500;
    expect(refusalResponse(() => rate.acquire(identity())).headers).toEqual({ 'Retry-After': '4' });
    now = 0;
    expect(refusalStatus(() => rate.acquire(identity()))).toBe(429);
    now = 4999;
    expect(refusalStatus(() => rate.acquire(identity()))).toBe(429);
    now = 5000;
    rate.acquire(identity())();
  });

  it('bounds default concurrency at two and releases each call once', () => {
    const rate = new NativeCountTokensRateLimiter({ now: () => 0 });
    const first = rate.acquire(identity());
    const second = rate.acquire(identity());
    expect(refusalResponse(() => rate.acquire(identity())).headers).toEqual({ 'Retry-After': '1' });
    first();
    first();
    const third = rate.acquire(identity());
    expect(refusalStatus(() => rate.acquire(identity()))).toBe(429);
    third();
    second();
    rate.acquire(identity())();
  });

  it('partitions by both tenant and principal, using an unambiguous tuple', () => {
    const rate = new NativeCountTokensRateLimiter({ capacity: 1, now: () => 0 });
    for (const cost of [{ tenantId: 'a:b', principalId: 'c' }, { tenantId: 'a', principalId: 'b:c' },
      { tenantId: 'a:b', principalId: 'd' }, { tenantId: 'z', principalId: 'c' }]) {
      rate.acquire(cost)();
      expect(refusalStatus(() => rate.acquire(cost))).toBe(429);
    }
  });

  it('fails closed for new identities at map capacity and evicts only at ten idle minutes', () => {
    let now = 0;
    const rate = new NativeCountTokensRateLimiter({ maxKeys: 2, now: () => now });
    rate.acquire(identity())();
    rate.acquire(identity('second'))();
    const third = identity('third');
    expect(() => rate.acquire(third)).toThrowError(expect.objectContaining({ kind: 'pooled-account-unavailable' }));
    now = 599_999;
    expect(() => rate.acquire(third)).toThrow(GatewayError);
    now = 600_000;
    rate.acquire(third)();
  });

  it('never evicts live calls, and idle time starts again when their cleanup completes', () => {
    let now = 0;
    const rate = new NativeCountTokensRateLimiter({ maxKeys: 1, now: () => now });
    const release = rate.acquire(identity());
    const other = identity('other');
    now = 600_000;
    expect(() => rate.acquire(other)).toThrow(GatewayError);
    release();
    now = 1_199_999;
    expect(() => rate.acquire(other)).toThrow(GatewayError);
    now = 1_200_000;
    rate.acquire(other)();
  });

  it('refuses invalid limits and invalid verified identities', () => {
    for (const options of [{ capacity: 0 }, { refillPerSecond: 0 }, { maxInFlight: 0 }, { idleMs: 0 },
      { maxKeys: 0 }, { now: 'x' as never }, { capacity: 1.5 }]) {
      expect(() => new NativeCountTokensRateLimiter(options)).toThrow('Invalid native count rate limits');
    }
    const rate = new NativeCountTokensRateLimiter({ now: () => 0 });
    for (const cost of [{ tenantId: '', principalId: 'p' }, { tenantId: 't', principalId: '' }]) {
      try {
        rate.acquire(cost as never);
        expect.unreachable('invalid identity must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(GatewayError);
        expect((error as GatewayError).kind).toBe('caller-auth-unavailable');
      }
    }
    const frozen = new NativeCountTokensRateLimiter({ now: () => Number.NaN });
    expect(() => frozen.acquire(identity())).toThrow(GatewayError);
  });
});
