import type { ExecutionNodeTenantId } from './contract.js';
import { ExecutionNodeError } from './errors.js';
import { BuildQueue } from './build-queue.js';

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
    options: { globalMaxLive?: number; retryAfterMs?: number } = {},
  ) {
    this.quotas = quotas;
    this.globalMaxLive = options.globalMaxLive ?? Number.POSITIVE_INFINITY;
    this.retryAfterMs = options.retryAfterMs ?? 250;
    this.used = {
      sentropic: { live: 0, standby: 0 },
      immo: { live: 0, standby: 0 },
    };
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
    this.used[tenantId][slot] += 1;
    if (slot === 'live') this.live += 1;
  }

  release(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby'): void {
    if (this.used[tenantId][slot] > 0) {
      this.used[tenantId][slot] -= 1;
      if (slot === 'live') this.live -= 1;
    }
  }

  /** Transfer the existing 768 MiB reservation without double accounting. */
  claim(tenantId: ExecutionNodeTenantId): void {
    if (this.used[tenantId].standby !== 1) {
      throw new ExecutionNodeError('tenant_quota_exceeded', 'no standby reservation', 250);
    }
    this.used[tenantId].standby -= 1;
    this.used[tenantId].live += 1;
    this.live += 1;
  }
}
