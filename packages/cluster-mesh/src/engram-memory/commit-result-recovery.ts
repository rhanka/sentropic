import type { EncodedValue, WriterFence } from '../storage/contracts.js';
import type { NeutralBoundScope } from './neutral-contract.js';
import { StorageUnavailableError } from '../storage/errors.js';

/** A bound backend owns scope/grant checks and validates this fence in its lookup transaction. */
export interface MemoryCommitResultSource {
  readCommitResult(commitIdentity: string, fence: WriterFence): Promise<EncodedValue | null>;
}

/**
 * E7 supplies its current host-owned fence. This identity-only reader does
 * not classify retry intents: the adapter does that before effects (§5.3).
 */
export const createMemoryCommitResultRecovery = (
  source: MemoryCommitResultSource,
  currentFence: () => Promise<WriterFence>,
): NonNullable<NeutralBoundScope['readCommitResult']> => async (commitIdentity) => {
  const result = await source.readCommitResult(commitIdentity, await currentFence());
  if (result === null) return null;
  if (result.format !== 'utf8') throw new StorageUnavailableError('memory original result must be UTF-8');
  return { format: result.format, data: result.data };
};
