import { describe, expect, it, vi } from 'vitest';
import { BuildQueue } from '../src/build-queue.js';

describe('global publish admission', () => {
  it('should invoke timeout cleanup before allowing the opposite tenant to start', async () => {
    vi.useFakeTimers();
    try {
      const queue = new BuildQueue();
      const cleanup = vi.fn(async () => { queue.release('sentropic'); });
      await (queue.acquire as (...args: unknown[]) => Promise<void>)('sentropic', 'artifact-build', cleanup);
      const next = queue.acquire('immo');
      await vi.advanceTimersByTimeAsync(59_999);
      expect(cleanup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(cleanup).toHaveBeenCalledOnce();
      await next; queue.release('immo');
    } finally { vi.useRealTimers(); }
  });
  it('should count the active job within the two outstanding jobs per tenant', async () => {
    const queue = new BuildQueue();
    await queue.acquire('immo');
    const waiting = queue.acquire('immo');
    await expect(queue.acquire('immo')).rejects.toMatchObject({ status: 429 });
    queue.release('immo'); await waiting; queue.release('immo');
  });
  it('should alternate tenants without preemption or a five second build deadline', async () => {
    const queue = new BuildQueue();
    const order: string[] = [];
    await queue.acquire('sentropic');
    const a = queue.acquire('sentropic').then(() => order.push('a'));
    const b = queue.acquire('immo').then(() => order.push('b'));
    expect(queue.snapshot()).toEqual({ maxConcurrentBuildsGlobal: 1, holderTenantId: 'sentropic', queueDepth: 2 });
    queue.release('sentropic');
    await b;
    expect(order).toEqual(['b']);
    queue.release('immo');
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  it('should reject a full tenant queue before starting another build', async () => {
    const queue = new BuildQueue(1);
    await queue.acquire('immo');
    const waiting = queue.acquire('sentropic');
    await expect(queue.acquire('sentropic')).rejects.toMatchObject({ status: 429 });
    expect(queue.snapshot().holderTenantId).toBe('immo');
    queue.release('immo');
    await waiting;
  });
});
