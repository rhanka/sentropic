import type { ExecutionNodeTenantId } from './contract.js';
import { ExecutionNodeError } from './errors.js';

export const SERVICE_TIMEOUT_MS = { 'artifact-build': 60_000, prebundle: 120_000, 'cold-materialize': 120_000 } as const;
export type HeavyProfile = keyof typeof SERVICE_TIMEOUT_MS;

/** One non-preemptible publish slot; the opposite tenant gets the next turn. */
export class BuildQueue {
  readonly waitMs = { sentropic: 0, immo: 0 };
  private holder?: ExecutionNodeTenantId;
  private last?: ExecutionNodeTenantId;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<ExecutionNodeTenantId, Array<() => boolean>>([
    ['sentropic', []], ['immo', []],
  ]);

  constructor(private readonly maxOutstandingPerTenant = 2) {}

  snapshot() {
    return { maxConcurrentBuildsGlobal: 1, holderTenantId: this.holder,
      quantumJobs: 1, maxOutstandingHeavyPerTenant: this.maxOutstandingPerTenant,
      serviceTimeoutMsByProfile: SERVICE_TIMEOUT_MS,
      queueDepthByTenant: { sentropic: this.pending.get('sentropic')!.length, immo: this.pending.get('immo')!.length },
      queueDepth: [...this.pending.values()].reduce((n, queue) => n + queue.length, 0) };
  }

  acquire(tenantId: ExecutionNodeTenantId, profile: HeavyProfile = 'artifact-build', onTimeout?: () => Promise<void>, validate?: () => void): Promise<void> {
    const enqueuedAt = Date.now();
    const queue = this.pending.get(tenantId)!;
    if (queue.length + Number(this.holder === tenantId) >= this.maxOutstandingPerTenant) {
      return Promise.reject(new ExecutionNodeError('tenant_quota_exceeded', 'publish queue full', 250));
    }
    return new Promise((resolve, reject) => {
      queue.push(() => {
        try { validate?.(); } catch (error) { reject(error); return false; }
        this.holder = this.last = tenantId;
        this.waitMs[tenantId] += Date.now() - enqueuedAt;
        this.timer = setTimeout(() => { void onTimeout?.().catch(() => { /* Keep capacity until cleanup succeeds. */ }); }, SERVICE_TIMEOUT_MS[profile]);
        this.timer.unref();
        resolve();
        return true;
      });
      this.drain();
    });
  }

  release(tenantId: ExecutionNodeTenantId): void {
    if (this.holder !== tenantId) throw new Error('publish slot ownership mismatch');
    clearTimeout(this.timer);
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
      if (!next()) this.drain();
      return;
    }
  }
}
