import { createHash } from 'node:crypto';
import type { AtomicUnit, CommitReceipt } from './atomic.js';
import { StorageCapacityExceededError, StorageInvalidCommandError } from './errors.js';
import { prepareUnitsInScope } from './record-runtime.js';
import { opaqueId, ownedCopy, type StagedCore } from './staged-core.js';
import { applyRootModuleEffects, appendRootEvent, validateRootPolicy } from './staged-effects.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { forkStagedRootData, lockStagedRootData, type RootSealProgress, type StagedOperation } from './staged-state.js';
import { validateCommitRoot, type StagedCommitRoot } from './staged-units.js';

export const EFFECT_SECTIONS = ['guards', 'records', 'appends', 'updates', 'relationships', 'barriers', 'purgeIntents', 'indexWrites'] as const;
export const emptyEffects = (): AtomicUnit => ({ guards: [], records: [], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });
export interface SealStepWork { items: number; appends: number; bytes: number; }

export const startRootPreparation = (core: StagedCore, bound: ScopedRuntime, operation: StagedOperation, root: StagedCommitRoot): RootSealProgress => {
  const valid = validateCommitRoot(root);
  if (!valid.ok || root.operationId !== operation.begin.operationKey || root.contractDigest !== operation.begin.contractDigest ||
    root.sourceBoundary !== operation.begin.sourceBoundary || root.fragmentCount !== String(operation.fragments.length) ||
    root.finalFragmentHash !== operation.fragments.at(-1)?.fragmentDigest) throw new StorageInvalidCommandError('seal does not bind the accepted frontier');
  const base = core.current(bound.scope);
  const data = forkStagedRootData(core.data(base));
  validateRootPolicy(core, data, bound.grant, operation.barrierCount, operation.purgeCount);
  const prepared = core.coordinator.prepare(base);
  Object.assign(prepared, { attachment: data });
  const progress: RootSealProgress = {
    base, prepared, data, root: Object.freeze(ownedCopy(root)),
    dependencyHash: createHash('sha256').update('["staged-dependency-root","v1",['),
    effectHash: createHash('sha256').update('["staged-effect-root","v1",['),
    fragment: 0, section: 0, item: 0, dependencyOffset: 0, effectOffset: 0,
    checked: 0, bytes: 0, effectiveRecords: 0, effectiveAppends: 0,
  };
  operation.state = 'sealing'; operation.progress = progress;
  return progress;
};

/** Costs are measured once while accepting each bounded fragment. Preparation
 * never serializes prior fragments just to discover the next step's size. */
export const prepareNextEffect = (core: StagedCore, bound: ScopedRuntime, progress: RootSealProgress,
  operation: StagedOperation, work: SealStepWork, byteBudget: number, appendBudget: number): boolean => {
  const fragment = operation.fragments.at(progress.fragment)!;
  while (progress.section < EFFECT_SECTIONS.length) {
    const section = EFFECT_SECTIONS[progress.section];
    const values = fragment.effects[section];
    if (progress.item >= values.length) { progress.section += 1; progress.item = 0; continue; }
    if (section === 'appends' && work.appends >= appendBudget) return false;
    const cost = fragment.itemCosts[progress.section][progress.item];
    if (cost > byteBudget) throw new StorageCapacityExceededError('a seal item requires a larger declared byte budget');
    if (work.bytes + cost > byteBudget) return false;
    const effect = { ...emptyEffects(), [section]: [values[progress.item]] };
    prepareUnitsInScope(progress.prepared, [effect], core.context(bound.grant, operation.commitId));
    applyRootModuleEffects(core, core.data(progress.base), progress.data, bound.grant, effect);
    if (section !== 'guards') progress.data.projections.emitDelta({ cause: 'staged-publication',
      records: section === 'records' ? [effect.records[0].key] : section === 'appends' ? [effect.appends[0].chainId] : [],
      aggregates: section === 'updates' ? [effect.updates[0].key] : [],
      relationships: section === 'relationships' ? [effect.relationships[0].relation] : [],
      barriers: section === 'barriers' ? [effect.barriers[0].boundary] : [],
    });
    if (section === 'appends') { work.appends += 1; progress.effectiveAppends += 1; }
    if (section === 'records' || section === 'appends' || section === 'updates') progress.effectiveRecords += 1;
    work.items += 1; work.bytes += cost; progress.checked += 1; progress.item += 1;
    return true;
  }
  return false;
};

export const hashNextFragment = (progress: RootSealProgress, operation: StagedOperation, work: SealStepWork, byteBudget: number): boolean => {
  const fragment = operation.fragments.at(progress.fragment)!;
  for (const kind of ['dependency', 'effect'] as const) {
    const offset = kind === 'dependency' ? 'dependencyOffset' : 'effectOffset';
    const hash = kind === 'dependency' ? progress.dependencyHash : progress.effectHash;
    const bytes = kind === 'dependency' ? fragment.dependencyPart : fragment.effectPart;
    if (progress[offset] === 0 && progress.fragment > 0) {
      if (work.bytes >= byteBudget) return false;
      hash.update(','); work.bytes += 1;
      // Negative offset distinguishes an emitted comma from fragment bytes.
      progress[offset] = -1;
    }
    const start = Math.max(0, progress[offset]);
    const length = Math.min(bytes.length - start, byteBudget - work.bytes);
    if (length > 0) { hash.update(bytes.subarray(start, start + length)); work.bytes += length; progress[offset] = start + length; }
    if (start + length < bytes.length) return false;
  }
  progress.fragment += 1; progress.checked += 1; work.items += 1;
  progress.section = 0; progress.item = 0; progress.dependencyOffset = 0; progress.effectOffset = 0;
  return true;
};

export const finishRootPreparation = (core: StagedCore, bound: ScopedRuntime, operation: StagedOperation, progress: RootSealProgress): void => {
  const dependencyRoot = progress.dependencyHash.update(']]').digest('hex');
  const effectRoot = progress.effectHash.update(']]').digest('hex');
  if (dependencyRoot !== progress.root.dependencyRoot || effectRoot !== progress.root.effectRoot) throw new StorageInvalidCommandError('seal roots do not match accepted effects and dependencies');
  const receipt: CommitReceipt = { commitId: operation.commitId, moduleId: core.kernel.moduleId, scope: { ...bound.scope },
    committedAt: core.clock(), effectiveRecords: progress.effectiveRecords, effectiveAppends: progress.effectiveAppends,
    journalCursor: `cursor-${operation.commitId}`, ...(operation.moduleResult === undefined ? {} : { moduleResult: operation.moduleResult }),
  };
  progress.data.unitRoots.set(operation.begin.operationKey, progress.root);
  appendRootEvent(core, progress.base, progress.data, bound.grant, receipt, operation.begin.operationKey, true);
  Object.assign(progress.prepared, { attachment: lockStagedRootData(progress.data) });
  progress.receipt = receipt;
  operation.seal = Object.freeze({ unitId: operation.unitId, commitRoot: progress.root, capability: opaqueId('seal') });
  operation.state = 'sealed';
};
