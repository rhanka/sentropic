import { EXECUTION_NODE_CAPACITY as capacity, EXECUTION_NODE_TENANT_SLICE_DEFAULTS, type ExecutionNodeTenantId } from './contract.js';
import { ExecutionNodeError } from './errors.js';
import { BuildQueue, type HeavyProfile } from './build-queue.js';

export interface TenantSlotQuota {
  readonly maxLive: number;
  readonly maxStandby: number;
}

export interface AdmissionSnapshot {
  readonly tenantId: ExecutionNodeTenantId;
  readonly live: number;
  readonly standby: number;
  readonly pending: number;
}

/**
 * One warm session per tenant (live OR standby), plus one global build.
 * Excess live requests are rejected before allocating memory.
 */
export class ExecutionNodeAdmission {
  private readonly quotas: Record<ExecutionNodeTenantId, TenantSlotQuota>;
  private readonly globalMaxLive: number;
  private readonly retryAfterMs: number;
  private live = 0;
  private readonly used: Record<ExecutionNodeTenantId, { live: number; standby: number }>;
  readonly builds = new BuildQueue();

  constructor(
    quotas: Record<ExecutionNodeTenantId, TenantSlotQuota>,
    private readonly options: { globalMaxLive?: number; retryAfterMs?: number; reservableMiB?: number;
      memorySwapCurrentMiB?: (tenantId: ExecutionNodeTenantId) => number;
      memoryCurrentMiB?: (tenantId: ExecutionNodeTenantId) => number } = {},
  ) {
    this.quotas = quotas;
    this.globalMaxLive = options.globalMaxLive ?? Number.POSITIVE_INFINITY;
    this.retryAfterMs = options.retryAfterMs ?? 250;
    this.used = {
      sentropic: { live: 0, standby: 0 },
      immo: { live: 0, standby: 0 },
    };
  }

  reservedMiB(tenantId: ExecutionNodeTenantId): number {
    const slots = this.used[tenantId];
    return (slots.live + slots.standby) * capacity.sessionMiB
      + (this.builds.snapshot().holderTenantId === tenantId ? capacity.buildMiB : 0);
  }

  private checkMemory(tenantId: ExecutionNodeTenantId, additionalMiB: number): void {
    const tenants = ['sentropic', 'immo'] as const;
    const usage = (id: ExecutionNodeTenantId) => Math.max(this.reservedMiB(id), this.options.memoryCurrentMiB?.(id) ?? 0);
    if (usage(tenantId) + additionalMiB > 2304
      || tenants.reduce((sum, id) => sum + usage(id), 0) + additionalMiB > Math.min(capacity.reservableMiB, this.options.reservableMiB ?? capacity.reservableMiB)) {
      throw new ExecutionNodeError('tenant_quota_exceeded', 'memory reservation exhausted', 250);
    }
  }

  async admitBuild(tenantId: ExecutionNodeTenantId, profile?: HeavyProfile, onTimeout?: () => Promise<void>): Promise<void> {
    await this.builds.acquire(tenantId, profile, onTimeout, () => this.checkMemory(tenantId, capacity.buildMiB));
  }

  quotaSnapshot(tenantId: ExecutionNodeTenantId, controlGroup: string) {
    return { tenantId, limits: EXECUTION_NODE_TENANT_SLICE_DEFAULTS[tenantId], controlGroup,
      usage: { memoryCurrentBytes: (this.options.memoryCurrentMiB?.(tenantId) ?? 0) * 1048576,
        memorySwapCurrentBytes: (this.options.memorySwapCurrentMiB?.(tenantId) ?? 0) * 1048576,
        reservedMemoryBytes: this.reservedMiB(tenantId) * 1048576 }, globalBuildSlot: this.builds.snapshot() };
  }

  snapshot(tenantId: ExecutionNodeTenantId): AdmissionSnapshot {
    return { tenantId, live: this.used[tenantId].live,
      standby: this.used[tenantId].standby, pending: 0 };
  }

  private tenantFull(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby'): boolean {
    const quota = this.quotas[tenantId];
    const limit = slot === 'live' ? quota.maxLive : quota.maxStandby;
    if (this.used[tenantId][slot] >= limit) return true;
    if (this.used[tenantId].live + this.used[tenantId].standby >= 1) return true;
    if (slot === 'live' && this.live >= this.globalMaxLive) return true;
    return false;
  }

  admit(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby', _requestId: string): void {
    if (this.tenantFull(tenantId, slot)) {
      throw new ExecutionNodeError(
        'tenant_quota_exceeded',
        `${tenantId} ${slot} quota exhausted`,
        this.retryAfterMs,
      );
    }
    this.checkMemory(tenantId, capacity.sessionMiB);
    this.used[tenantId][slot] += 1;
    if (slot === 'live') this.live += 1;
  }

  release(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby'): void {
    if (this.used[tenantId][slot] > 0) {
      this.used[tenantId][slot] -= 1;
      if (slot === 'live') this.live -= 1;
    }
  }

  /** Transfer the existing 704 MiB reservation without double accounting. */
  claim(tenantId: ExecutionNodeTenantId): void {
    if (this.used[tenantId].standby !== 1) {
      throw new ExecutionNodeError('tenant_quota_exceeded', 'no standby reservation', 250);
    }
    this.used[tenantId].standby -= 1;
    this.used[tenantId].live += 1;
    this.live += 1;
  }
}
