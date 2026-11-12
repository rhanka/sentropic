import type { ExecutionNodeTenantId } from './contract.js';
import { ExecutionNodeError } from './errors.js';

/** One non-preemptible publish slot; the opposite tenant gets the next turn. */
export class BuildQueue {
  private holder?: ExecutionNodeTenantId;
  private last?: ExecutionNodeTenantId;
  private readonly pending = new Map<ExecutionNodeTenantId, Array<() => void>>([
    ['sentropic', []], ['immo', []],
  ]);

  constructor(private readonly maxPendingPerTenant = 8) {}

  snapshot(): { maxConcurrentBuildsGlobal: 1; holderTenantId?: ExecutionNodeTenantId; queueDepth: number } {
    return { maxConcurrentBuildsGlobal: 1, holderTenantId: this.holder,
      queueDepth: [...this.pending.values()].reduce((n, queue) => n + queue.length, 0) };
  }

  acquire(tenantId: ExecutionNodeTenantId): Promise<void> {
    const queue = this.pending.get(tenantId)!;
    if (queue.length >= this.maxPendingPerTenant) {
      return Promise.reject(new ExecutionNodeError('tenant_quota_exceeded', 'publish queue full', 250));
    }
    return new Promise(resolve => {
      queue.push(resolve);
      this.drain();
    });
  }

  release(tenantId: ExecutionNodeTenantId): void {
    if (this.holder !== tenantId) throw new Error('publish slot ownership mismatch');
    this.holder = undefined;
    this.drain();
  }

  private drain(): void {
    if (this.holder) return;
    const order: ExecutionNodeTenantId[] = this.last === 'sentropic'
      ? ['immo', 'sentropic'] : ['sentropic', 'immo'];
    for (const tenantId of order) {
      const next = this.pending.get(tenantId)!.shift();
      if (!next) continue;
      this.holder = this.last = tenantId;
      next();
      return;
    }
  }
}
