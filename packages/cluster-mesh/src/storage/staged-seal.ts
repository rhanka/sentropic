import type { CommitReceipt } from './atomic.js';
import type { WorkLimits, WriterFence } from './contracts.js';
import { StorageInvalidCommandError } from './errors.js';
import { IndexedHistory } from './indexed-history.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { ownedCopy, type StagedCore } from './staged-core.js';
import { assertOperationFence, operationHandle, resolveOperation, stagedLimits } from './staged-operations.js';
import { EFFECT_SECTIONS, finishRootPreparation, hashNextFragment, prepareNextEffect, startRootPreparation, type SealStepWork } from './staged-preparation.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from './staged-state.js';
import type { StagedCommitRoot, StagedUnitStatus } from './staged-units.js';

export interface RootSealStepInput {
  readonly unit: AuthenticatedStagedHandle; readonly root: StagedCommitRoot; readonly fence: WriterFence; readonly limits?: WorkLimits;
}
export type RootSealOutcome =
  | { readonly state: 'validating'; readonly progress: { readonly checked: string; readonly total: string }; readonly work: SealStepWork }
  | { readonly state: 'sealed'; readonly seal: AuthenticatedStagedSeal; readonly work: SealStepWork };

export const sealOperationStep = (core: StagedCore, bound: ScopedRuntime, input: RootSealStepInput): RootSealOutcome => {
  const operation = resolveOperation(core, bound, input.unit);
  assertOperationFence(core, bound, operation, input.fence);
  const limits = stagedLimits(core, input.limits);
  if (Buffer.byteLength(JSON.stringify(input.root), 'utf8') > stagedLimits(core).maxEncodedBytes) throw new StorageInvalidCommandError('seal metadata exceeds configured limits');
  const work: SealStepWork = { items: 0, appends: 0, bytes: 0 };
  if (operation.seal && (operation.state === 'sealed' || operation.state === 'committed')) {
    if (JSON.stringify(input.root) !== JSON.stringify(operation.seal.commitRoot)) throw new StorageInvalidCommandError('sealed root cannot change');
    return { state: 'sealed', seal: ownedCopy(operation.seal), work };
  }
  if (operation.state !== 'staging' && operation.state !== 'sealing') throw new StorageInvalidCommandError('operation cannot seal');
  const progress = operation.progress ?? startRootPreparation(core, bound, operation, input.root);
  if (progress.failed || JSON.stringify(input.root) !== JSON.stringify(progress.root)) throw new StorageInvalidCommandError('sealing input is frozen');
  try {
    while (progress.fragment < operation.fragments.length && work.items < limits.maxRecords && work.bytes < limits.maxEncodedBytes) {
      if (prepareNextEffect(core, bound, progress, operation, work, limits.maxEncodedBytes, limits.maxAppends)) continue;
      if (progress.section < EFFECT_SECTIONS.length) break;
      if (!hashNextFragment(progress, operation, work, limits.maxEncodedBytes)) break;
    }
    if (progress.fragment === operation.fragments.length && work.items < limits.maxRecords && work.bytes + 4 <= limits.maxEncodedBytes) {
      finishRootPreparation(core, bound, operation, progress);
      work.items += 1; work.bytes += 4; progress.checked += 1;
    }
  } catch (error) {
    progress.failed = 'validation failed';
    throw error;
  }
  bound.requireOperation('write'); assertOperationFence(core, bound, operation, input.fence);
  progress.bytes += work.bytes;
  if (operation.seal) return { state: 'sealed', seal: ownedCopy(operation.seal), work };
  return { state: 'validating', progress: { checked: String(progress.checked), total: String(operation.totalEffects + operation.fragments.length + 1) }, work };
};

export const commitSealedOperation = async (core: StagedCore, bound: ScopedRuntime,
  input: { readonly seal: AuthenticatedStagedSeal; readonly fence: WriterFence }): Promise<CommitReceipt> => {
  bound.requireOperation('write');
  const operation = input.seal && core.control(bound.scope).byId.get(input.seal.unitId);
  if (!operation) throw new StorageInvalidCommandError('unknown sealed operation');
  resolveOperation(core, bound, operationHandle(core, operation));
  assertOperationFence(core, bound, operation, input.fence);
  if (!operation.seal || input.seal.capability !== operation.seal.capability || JSON.stringify(input.seal.commitRoot) !== JSON.stringify(operation.seal.commitRoot)) {
    throw new StorageInvalidCommandError('seal capability or root mismatch');
  }
  if (operation.state === 'committed' && operation.receipt) return ownedCopy(operation.receipt);
  if (operation.state !== 'sealed' || !operation.progress?.receipt) throw new StorageInvalidCommandError('operation has no prepared seal');
  await core.options.beforePublish?.(bound.scope, operation.unitId);
  bound.requireOperation('write'); assertOperationFence(core, bound, operation, input.fence);
  if (operation.state === 'committed' && operation.receipt) return ownedCopy(operation.receipt);
  core.consumeFailure(bound.scope, 'external');
  // The scheduling point can revoke authority, rotate a lane or publish a
  // rival root. All checks are repeated synchronously at the single switch.
  const progress = operation.progress;
  core.coordinator.publish(bound.scope, progress.base, progress.prepared, () => {
    bound.requireOperation('write');
    resolveOperation(core, bound, operationHandle(core, operation));
    assertOperationFence(core, bound, operation, input.fence);
    if (operation.state !== 'sealed') throw new StorageInvalidCommandError('operation changed before publication');
  });
  operation.receipt = progress.receipt!; operation.state = 'committed';
  operation.progress = null; operation.fragments = new IndexedHistory();
  return ownedCopy(operation.receipt);
};

export const abortOperation = (core: StagedCore, bound: ScopedRuntime,
  input: { readonly unit: AuthenticatedStagedHandle; readonly fence: WriterFence; readonly reason: string }): void => {
  const operation = resolveOperation(core, bound, input.unit);
  assertOperationFence(core, bound, operation, input.fence);
  if (operation.state === 'committed') throw new StorageInvalidCommandError('committed operation cannot abort');
  if (operation.state === 'aborted') return;
  if (typeof input.reason !== 'string' || !input.reason || input.reason.length > 4096) throw new StorageInvalidCommandError('abort requires a bounded reason');
  operation.state = 'aborted'; operation.reason = input.reason; operation.progress = null;
  operation.fragments = new IndexedHistory();
};
export const inspectOperation = (core: StagedCore, bound: ScopedRuntime, operationKey: string): StagedUnitStatus => {
  bound.requireOperation('write');
  const operation = core.control(bound.scope).units.get(operationKey);
  if (!operation) throw new StorageInvalidCommandError('unknown staged operation');
  resolveOperation(core, bound, operationHandle(core, operation));
  if (operation.state === 'staging' || operation.state === 'sealing') return { state: operation.state, acceptedFragments: String(operation.fragments.length) };
  if (operation.state === 'sealed') return { state: 'sealed', seal: ownedCopy(operation.seal!) };
  if (operation.state === 'committed') return { state: 'committed', commitId: operation.receipt!.commitId };
  return { state: 'aborted', reason: operation.reason! };
};
