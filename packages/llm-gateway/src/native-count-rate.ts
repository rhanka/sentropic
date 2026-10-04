import type { CostContext } from './ports/cost-context.js';
import { NativeCountTokensRefusal } from './native-count-tokens.js';
import { GatewayError, anthropicError } from './router/errors.js';

export interface NativeCountRateOptions {
  readonly capacity?: number; readonly refillPerSecond?: number; readonly maxInFlight?: number;
  readonly idleMs?: number; readonly maxKeys?: number; readonly now?: () => number;
}
type Bucket = { tokens: number; updated: number; touched: number; inFlight: number };

/** Process-local engineering limits, keyed exclusively by verified tenant/principal. */
export class NativeCountTokensRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limits: Required<NativeCountRateOptions>;
  constructor(options: NativeCountRateOptions = {}) {
    this.limits = { capacity: 10, refillPerSecond: 1, maxInFlight: 2, idleMs: 600_000,
      maxKeys: 10_000, now: Date.now, ...options };
    const { now, refillPerSecond, ...integers } = this.limits;
    if (typeof now !== 'function' || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0
      || Object.values(integers).some(value => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error('Invalid native count rate limits');
    }
  }
  acquire(cost: Pick<CostContext, 'tenantId' | 'principalId'>): () => void {
    const now = this.limits.now();
    if (!Number.isFinite(now) || [cost.tenantId, cost.principalId].some(id => typeof id !== 'string' || !id.trim())) {
      throw new GatewayError('caller-auth-unavailable', 'invalid verified count identity or clock');
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.inFlight === 0 && now - bucket.touched >= this.limits.idleMs) this.buckets.delete(key);
    }
    const key = JSON.stringify([cost.tenantId, cost.principalId]);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.limits.maxKeys) {
        throw new GatewayError('pooled-account-unavailable', 'count identity capacity exhausted');
      }
      bucket = { tokens: this.limits.capacity, updated: now, touched: now, inFlight: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(this.limits.capacity,
      bucket.tokens + Math.max(0, now - bucket.updated) * this.limits.refillPerSecond / 1000);
    bucket.updated = Math.max(now, bucket.updated); bucket.touched = Math.max(now, bucket.touched);
    const concurrent = bucket.inFlight >= this.limits.maxInFlight;
    if (concurrent || bucket.tokens < 1) {
      const retry = concurrent ? 1 : Math.ceil((1 - bucket.tokens) / this.limits.refillPerSecond);
      throw new NativeCountTokensRefusal(anthropicError(429, 'rate_limit_error',
        'Token counting request limit exceeded.', { 'Retry-After': String(retry) }));
    }
    bucket.tokens--; bucket.inFlight++;
    let released = false;
    return () => {
      if (!released) { released = true; bucket.inFlight--; bucket.touched = Math.max(bucket.touched, this.limits.now()); }
    };
  }
}

export const defaultNativeCountTokensRateLimiter = new NativeCountTokensRateLimiter();
