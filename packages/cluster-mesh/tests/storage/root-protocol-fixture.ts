import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { StagedKernelRoot } from '../../src/storage/staged-factory.js';
import type { AuthenticatedStagedHandle } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';

export const FENCE = { fenceId: 'protocol-lane', epoch: '1' };
export const stagePublic = async (root: StagedKernelRoot, bound: RootScopedRuntime, key: string, effects: AtomicUnit, fence: WriterFence = FENCE) => {
  root.provisionFence(bound.scope, bound.grant.principalId, fence);
  const unit = await bound.beginStaged({ operationKey: key, inputDigest: `input-${key}`, contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
  await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
  return { unit, root: stagedSealRoot(unit, [effects]), fence };
};
export const sealPublic = async (bound: RootScopedRuntime, input: { unit: AuthenticatedStagedHandle; root: StagedCommitRoot; fence: WriterFence }) => {
  let outcome;
  do { outcome = await bound.sealStep(input); } while (outcome.state === 'validating');
  return outcome.seal;
};
