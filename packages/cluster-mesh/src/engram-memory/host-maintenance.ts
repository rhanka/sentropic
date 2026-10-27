// Host-only maintenance ports (lot E7). The host composition opens these
// from an assembled binding plus a runner bound to the binding's maintain
// grant: the ports delegate fence/checkpoint/poison/retry/resync/snapshot
// to the kernel, which enforces the maintain authority on every call. A
// runner bound to any other grant (including the neutral handle) is
// refused by grant identity — the ports never run on another authority.

import { StorageDeniedError } from '../storage/errors.js';
import type { ScopeGrant } from '../storage/authority.js';
import type { PgPosition } from '../storage/postgres/journal.js';
import type { JournalFence } from '../storage/staged-core.js';
import { assertMaintainGrantLive, type MemoryHostBinding } from './binding.js';
import { checkMemoryPostgresDriver } from './postgres.js';

/** Kernel calls behind the ports, already bound to the maintain grant. */
export interface MemoryMaintenanceRunner {
  readonly grant: ScopeGrant<unknown>;
  readonly currentFence: () => Promise<JournalFence>;
  readonly checkpoint: (
    consumer: string,
    expected: PgPosition,
    next: PgPosition,
    fence: JournalFence,
  ) => Promise<void>;
  readonly poison: (consumer: string, event: string, reason: string) => Promise<void>;
  readonly retry: (
    consumer: string,
    expected: string | null,
    fence: JournalFence,
  ) => Promise<void>;
  readonly resync: (
    consumer: string,
    fence: JournalFence,
  ) => Promise<{ snapshotRoot: string; journalSeq: string }>;
  readonly snapshot: (
    token: string,
    after: number,
    limit: number,
  ) => Promise<{ rows: readonly unknown[] }>;
}

export interface MemoryMaintenancePorts {
  readonly checkFence: (fence: JournalFence) => Promise<JournalFence>;
  readonly checkpoint: (
    consumer: string,
    expected: PgPosition,
    next: PgPosition,
    fence: JournalFence,
  ) => Promise<void>;
  readonly poison: (consumer: string, event: string, reason: string) => Promise<void>;
  readonly retry: (
    consumer: string,
    expected: string | null,
    fence: JournalFence,
  ) => Promise<void>;
  readonly resync: (
    consumer: string,
    fence: JournalFence,
  ) => Promise<{ snapshotRoot: string; journalSeq: string }>;
  readonly snapshot: (
    token: string,
    after: number,
    limit: number,
  ) => Promise<{ rows: readonly unknown[] }>;
}

/**
 * Open the host-only maintenance ports. The binding is re-validated
 * (checked provider plus live maintain grant) and the runner must carry
 * the binding's exact grant object — an ad-hoc runner, or one bound to
 * the neutral handle, cannot open ports.
 */
export const openMemoryMaintenance = (
  binding: MemoryHostBinding,
  runner: MemoryMaintenanceRunner,
): MemoryMaintenancePorts => {
  if (typeof binding !== 'object' || binding === null) {
    throw new StorageDeniedError('memory maintenance requires an assembled binding');
  }
  checkMemoryPostgresDriver((binding as { readonly provider?: unknown }).provider);
  assertMaintainGrantLive(binding.maintainGrant);
  if (typeof runner !== 'object' || runner === null || runner.grant !== binding.maintainGrant) {
    throw new StorageDeniedError('memory maintenance requires a runner bound to this binding');
  }
  const ports: MemoryMaintenancePorts = {
    checkFence: async (fence) => {
      const current = await runner.currentFence();
      if (
        current.fenceId !== fence.fenceId ||
        current.epoch !== fence.epoch ||
        current.incarnation !== fence.incarnation ||
        current.ownerId !== fence.ownerId
      ) {
        throw new StorageDeniedError('maintenance fence is not current');
      }
      return current;
    },
    checkpoint: (consumer, expected, next, fence) => runner.checkpoint(consumer, expected, next, fence),
    poison: (consumer, event, reason) => runner.poison(consumer, event, reason),
    retry: (consumer, expected, fence) => runner.retry(consumer, expected, fence),
    resync: (consumer, fence) => runner.resync(consumer, fence),
    snapshot: (token, after, limit) => runner.snapshot(token, after, limit),
  };
  return Object.freeze(ports);
};
