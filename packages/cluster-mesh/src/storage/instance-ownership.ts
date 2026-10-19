// Canonical instance ownership, G3 composition boundary (lot 1).
// Neutral contract: no sqlite, no pg, no engram imports. Versioned and
// digest-carrying, distinct from task fencing: the epoch is allocated by
// the registry, never supplied by the caller.

import { createHash, randomUUID } from 'node:crypto';

const CONTRACT_NAME = 'CanonicalInstanceOwnershipV1';
const CONTRACT_VERSION = '1';
const CONTRACT_MEANING = [
  'single live holder per store',
  'fail-fast second-holder refusal without queue',
  'registry-allocated durable instance id and monotonic storage epoch',
  'possession verified at the commit validation point',
  'loss is terminal and revokes dependent readers',
  'unknown-outcome commit reconciles by durable identity, never as rollback',
].join(';');

export const CANONICAL_INSTANCE_OWNERSHIP_CONTRACT = Object.freeze({
  name: CONTRACT_NAME,
  version: CONTRACT_VERSION,
  meaning: CONTRACT_MEANING,
  digest: createHash('sha256')
    .update(JSON.stringify(['canonical-instance-ownership', 'v1', CONTRACT_NAME, CONTRACT_MEANING]), 'utf8')
    .digest('hex'),
});

export interface CanonicalInstanceHandle {
  readonly instanceId: string;
  readonly storageEpoch: string;
  readonly storeKey: string;
}

export type CanonicalOwnershipCode = 'instance-busy' | 'stale-epoch' | 'terminal-loss' | 'open-refused';

export class CanonicalOwnershipError extends Error {
  readonly code: CanonicalOwnershipCode;
  constructor(code: CanonicalOwnershipCode, message: string) {
    super(message);
    this.name = 'CanonicalOwnershipError';
    this.code = code;
  }
}

interface RegistryEntry {
  instanceId: string;
  epoch: number;
  live: boolean;
  terminal: boolean;
}

const epochOf = (epoch: string): number => {
  const parsed = Number(epoch);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CanonicalOwnershipError('stale-epoch', `invalid storage epoch: ${epoch}`);
  return parsed;
};

/** Single-process holder registry. Durable backends persist the winning
 * pair and re-enter it through acquire with an explicit epoch. */
export class CanonicalInstanceRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  acquire(storeKey: string, epoch?: string): CanonicalInstanceHandle {
    const current = this.entries.get(storeKey);
    if (current?.live) throw new CanonicalOwnershipError('instance-busy', `store ${storeKey} already has a live holder`);
    const next = epoch === undefined ? (current?.epoch ?? 0) + 1 : epochOf(epoch);
    if (current && next <= current.epoch) {
      throw new CanonicalOwnershipError('stale-epoch', `epoch ${next} does not supersede ${current.epoch}`);
    }
    const entry: RegistryEntry = { instanceId: current?.instanceId ?? `instance-${randomUUID()}`, epoch: next, live: true, terminal: false };
    this.entries.set(storeKey, entry);
    return Object.freeze({ instanceId: entry.instanceId, storageEpoch: String(entry.epoch), storeKey });
  }

  verify(handle: CanonicalInstanceHandle): void {
    const current = this.entries.get(handle.storeKey);
    if (!current || current.instanceId !== handle.instanceId) {
      throw new CanonicalOwnershipError('stale-epoch', `unknown holder for store ${handle.storeKey}`);
    }
    if (current.terminal) throw new CanonicalOwnershipError('terminal-loss', `instance ${handle.instanceId} is terminal`);
    if (!current.live || current.epoch !== epochOf(handle.storageEpoch)) {
      throw new CanonicalOwnershipError('stale-epoch', `instance ${handle.instanceId} no longer holds epoch ${handle.storageEpoch}`);
    }
  }

  release(handle: CanonicalInstanceHandle): void {
    const current = this.entries.get(handle.storeKey);
    if (current && current.instanceId === handle.instanceId && current.epoch === epochOf(handle.storageEpoch)) {
      current.live = false;
    }
  }

  markTerminal(handle: CanonicalInstanceHandle): void {
    const current = this.entries.get(handle.storeKey);
    if (current && current.instanceId === handle.instanceId) {
      current.live = false;
      current.terminal = true;
    }
  }

  current(storeKey: string): CanonicalInstanceHandle | null {
    const current = this.entries.get(storeKey);
    if (!current || !current.live || current.terminal) return null;
    return Object.freeze({ instanceId: current.instanceId, storageEpoch: String(current.epoch), storeKey });
  }
}

/** Storage-carried commit fence: invoke the returned guard after the last
 * callback and before the commit decision; a refusal rolls everything back. */
export const commitPossessionGuard = (
  registry: CanonicalInstanceRegistry,
  handle: CanonicalInstanceHandle,
): (() => void) => () => {
  registry.verify(handle);
};
