import { describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/build-queue.js';

describe('global publish admission', () => {
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
