import type { EncodedValue, WriterFence } from '../storage/contracts.js';
import type { NeutralBoundScope } from './neutral-contract.js';

/** A bound backend owns scope/grant checks and validates this fence in its lookup transaction. */
export interface MemoryCommitResultSource {
  readCommitResult(commitIdentity: string, fence: WriterFence): Promise<EncodedValue | null>;
}

/** E7 supplies its current host-owned fence; no epoch/time/result is reconstructed here. */
export const createMemoryCommitResultRecovery = (
  source: MemoryCommitResultSource,
  currentFence: () => Promise<WriterFence>,
): NonNullable<NeutralBoundScope['readCommitResult']> => async (commitIdentity) =>
  source.readCommitResult(commitIdentity, await currentFence());
