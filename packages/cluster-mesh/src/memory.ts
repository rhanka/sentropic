import { CapabilityGatedError } from './errors.js';
import type { SignedProjectionReference } from './projection.js';

/** Future W-C cache seam. V1 never copies or purges a remote memory snapshot. */
export interface MemoryReplicationPort {
  replicate(reference: SignedProjectionReference): Promise<void>;
  purge(reference: SignedProjectionReference): Promise<void>;
}

export function createGatedMemoryReplication(): MemoryReplicationPort {
  const gated = async () => {
    throw new CapabilityGatedError('memory_replication');
  };
  return { replicate: gated, purge: gated };
}
