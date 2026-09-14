import { duration } from './local-support.js';
import { LocalMessagingState } from './local-state.js';
import type {
  NativeDrainAcquireResult,
  NativeDrainCoordinatorPort,
  NativeDrainFence,
} from './native-drain-contracts.js';

export const sameFence = (left: NativeDrainFence, right: NativeDrainFence): boolean =>
  left.sourceId === right.sourceId
  && left.workerId === right.workerId
  && left.generation === right.generation
  && left.leaseId === right.leaseId
  && left.acquiredAt === right.acquiredAt
  && left.expiresAt === right.expiresAt;

export class DrainFenceOperation {
  constructor(private readonly state: LocalMessagingState) {}

  async acquire(
    input: Parameters<NativeDrainCoordinatorPort['acquire']>[0],
  ): Promise<NativeDrainAcquireResult> {
    const leaseMs = duration(input.leaseMs, input.leaseMs, this.state.options.maxDrainLeaseMs);
    if (!input.sourceId || !input.workerId || leaseMs === null) {
      return { ok: false, reason: 'unavailable' };
    }
    return this.state.mutex.run(() => {
      const nowMs = this.state.nowMs();
      if (nowMs === null) return { ok: false, reason: 'unavailable' } as const;
      const drain = this.state.drains.get(input.sourceId)
        ?? { generation: 0, cursor: null };
      if (drain.fence && Date.parse(drain.fence.expiresAt) > nowMs) {
        return { ok: false, reason: 'lease_held' } as const;
      }
      const generation = drain.generation + 1;
      if (!Number.isSafeInteger(generation)) return { ok: false, reason: 'unavailable' } as const;
      const leaseId = this.state.options.id('drain-lease');
      if (!leaseId || this.leaseExists(leaseId)) {
        return { ok: false, reason: 'unavailable' } as const;
      }
      const fence: NativeDrainFence = {
        sourceId: input.sourceId, workerId: input.workerId, generation, leaseId,
        acquiredAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + leaseMs).toISOString(),
      };
      drain.generation = generation;
      drain.fence = fence;
      this.state.drains.set(input.sourceId, drain);
      return { ok: true, fence, cursor: drain.cursor } as const;
    });
  }

  async renew(
    input: Parameters<NativeDrainCoordinatorPort['renew']>[0],
  ): Promise<NativeDrainFence | null> {
    const leaseMs = duration(input.leaseMs, input.leaseMs, this.state.options.maxDrainLeaseMs);
    if (leaseMs === null) return null;
    return this.state.mutex.run(() => {
      const nowMs = this.state.nowMs();
      const drain = this.state.drains.get(input.fence.sourceId);
      if (nowMs === null || !drain?.fence || !sameFence(drain.fence, input.fence)
        || Date.parse(drain.fence.expiresAt) <= nowMs) return null;
      const renewed: NativeDrainFence = {
        ...drain.fence, expiresAt: new Date(nowMs + leaseMs).toISOString(),
      };
      drain.fence = renewed;
      return renewed;
    });
  }

  async release(
    input: Parameters<NativeDrainCoordinatorPort['release']>[0],
  ): Promise<boolean> {
    return this.state.mutex.run(() => {
      const drain = this.state.drains.get(input.fence.sourceId);
      if (!drain?.fence || !sameFence(drain.fence, input.fence)) return false;
      delete drain.fence;
      return true;
    });
  }

  private leaseExists(leaseId: string): boolean {
    for (const drain of this.state.drains.values()) {
      if (drain.fence?.leaseId === leaseId) return true;
    }
    return false;
  }
}
