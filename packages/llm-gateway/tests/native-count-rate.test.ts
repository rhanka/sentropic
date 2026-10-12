/**
 * Native count_tokens rate limiter (Lot 3 round 2): process-local engineering
 * limits keyed by verified tenant/principal. Ported from the native relay
 * draft (#633) so the two branches converge on the same limiter contract.
 */

import { describe, expect, it } from 'vitest';
import { GatewayError, NativeCountTokensRateLimiter, NativeCountTokensRefusal } from '../src/index.js';

const identity = (principalId = 'principal-a') =>
  ({ tenantId: 'tenant-1', principalId });

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
