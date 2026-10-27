// Host-only maintenance ports (lot E7). The host composition opens these
// from an assembled host binding; Engram's neutral handle never sees them.
// Each port FAILS CLOSED in this increment: fence/checkpoint/poison/retry,
// resync and snapshot maintenance need the G1b stateful projection with
// backend reads. Refusals are typed (never a silent stub success), and the
// maintain grant is re-checked at open so a copied binding without
// maintain authority cannot produce live ports.

import { StorageDeniedError, StorageUnavailableError } from '../storage/errors.js';
import type { MemoryHostBinding } from './binding.js';

export interface MemoryMaintenancePorts {
  readonly checkFence: (fenceId: string, epoch: string) => Promise<never>;
  readonly checkpoint: (consumer: string, cursor: string) => Promise<never>;
  readonly poison: (consumer: string, reason: string) => Promise<never>;
  readonly resync: (scopeKey: string) => Promise<never>;
  readonly snapshot: (scopeKey: string) => Promise<never>;
}

const closed = (port: string): (() => Promise<never>) => async () => {
  throw new StorageUnavailableError(`memory maintenance ${port} requires the G1b stateful projection`);
};

/** Open the host-only maintenance ports from an assembled host binding. */
export const openMemoryMaintenance = (binding: MemoryHostBinding): MemoryMaintenancePorts => {
  if (typeof binding !== 'object' || binding === null) {
    throw new StorageDeniedError('memory maintenance requires an assembled host binding');
  }
  if (!binding.maintainGrant.operations.includes('maintain')) {
    throw new StorageDeniedError('memory maintenance requires a grant carrying the maintain operation');
  }
  return Object.freeze({
    checkFence: closed('checkFence'),
    checkpoint: closed('checkpoint'),
    poison: closed('poison'),
    resync: closed('resync'),
    snapshot: closed('snapshot'),
  });
};
