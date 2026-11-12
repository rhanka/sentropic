import type { ExecutionNodeTenantId } from '../../../packages/contracts/src/execution-node-v1.js';
import { ExecutionNodeError } from './errors.js';

export interface TenantSlotQuota {
  readonly maxLive: number;
  readonly maxStandby: number;
}

export interface PendingRequest {
  readonly tenantId: ExecutionNodeTenantId;
  readonly requestId: string;
}

export interface AdmissionSnapshot {
  readonly tenantId: ExecutionNodeTenantId;
  readonly live: number;
  readonly standby: number;
  readonly pending: number;
}

/**
 * Per-tenant admission with reserved live/standby slots. Over-quota
 * requests queue per tenant and drain WFQ/DRR 1:1 across tenants when
 * capacity frees; exhausted callers get 429 tenant_quota_exceeded.
 */
export class ExecutionNodeAdmission {
  private readonly quotas: Record<ExecutionNodeTenantId, TenantSlotQuota>;
  private readonly globalMaxLive: number;
  private readonly retryAfterMs: number;
  private live = 0;
  private readonly used: Record<ExecutionNodeTenantId, { live: number; standby: number }>;
  private readonly pending: Record<ExecutionNodeTenantId, PendingRequest[]>;
  private roundRobin: ExecutionNodeTenantId[];

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
    this.pending = { sentropic: [], immo: [] };
    this.roundRobin = ['sentropic', 'immo'];
  }

  snapshot(tenantId: ExecutionNodeTenantId): AdmissionSnapshot {
    return { tenantId, live: this.used[tenantId].live,
      standby: this.used[tenantId].standby, pending: this.pending[tenantId].length };
  }

  private tenantFull(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby'): boolean {
    const quota = this.quotas[tenantId];
    const limit = slot === 'live' ? quota.maxLive : quota.maxStandby;
    if (this.used[tenantId][slot] >= limit) return true;
    if (slot === 'live' && this.live >= this.globalMaxLive) return true;
    return false;
  }

  admit(tenantId: ExecutionNodeTenantId, slot: 'live' | 'standby', requestId: string): void {
    if (this.tenantFull(tenantId, slot)) {
      this.pending[tenantId].push({ tenantId, requestId });
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

  /** WFQ 1:1 — serve one queued request per tenant in rotation. */
  drainPending(): PendingRequest[] {
    const served: PendingRequest[] = [];
    for (const tenantId of this.roundRobin) {
      const next = this.pending[tenantId][0];
      if (next && !this.tenantFull(tenantId, 'live')) {
        this.pending[tenantId].shift();
        this.used[tenantId].live += 1;
        this.live += 1;
        served.push(next);
      }
    }
    this.roundRobin = [this.roundRobin[1]!, this.roundRobin[0]!];
    return served;
  }

  pendingLength(tenantId: ExecutionNodeTenantId): number {
    return this.pending[tenantId].length;
  }
}
