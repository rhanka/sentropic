import type { AtomicUnit } from './atomic.js';
import { DEFAULT_WORK_LIMITS, validateWorkLimits, type StorageModuleId, type WorkLimits, type WriterFence } from './contracts.js';
import { StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from './errors.js';
import { IndexedHistory } from './indexed-history.js';
import { IndexedMap } from './indexed-map.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { deriveStagedDependencies, stagedEffectDigest, stagedFragmentDigest } from './staged-codec.js';
import { opaqueId, ownedCopy, type StagedCore } from './staged-core.js';
import type { AuthenticatedStagedHandle, StagedOperation } from './staged-state.js';
import { validateBeginInput, validateFragmentInput, type StagedBeginInput, type FragmentReceipt } from './staged-units.js';
import { EFFECT_SECTIONS } from './staged-preparation.js';

const freeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
};
export const stagedLimits = (core: StagedCore, requested?: WorkLimits): WorkLimits => {
  const maximum = core.options.limits ?? DEFAULT_WORK_LIMITS;
  const limits = requested ?? maximum;
  if (!validateWorkLimits(limits).ok || Object.keys(maximum).some((key) => limits[key as keyof WorkLimits] > maximum[key as keyof WorkLimits])) {
    throw new StorageInvalidCommandError('requested work limits exceed configured staging limits');
  }
  return { ...limits };
};
export const operationHandle = (core: StagedCore, operation: StagedOperation): AuthenticatedStagedHandle => ({
  unitId: operation.unitId, operationKey: operation.begin.operationKey, moduleId: core.kernel.moduleId as StorageModuleId,
  scope: { ...operation.scope }, state: operation.state, capability: operation.capability,
});
export const resolveOperation = (core: StagedCore, bound: ScopedRuntime, handle: AuthenticatedStagedHandle): StagedOperation => {
  bound.requireOperation('write');
  const operation = handle && core.control(bound.scope).byId.get(handle.unitId);
  if (!operation || handle.capability !== operation.capability || handle.operationKey !== operation.begin.operationKey ||
    handle.moduleId !== core.kernel.moduleId || handle.scope?.tenantId !== bound.scope.tenantId || handle.scope.workspaceId !== bound.scope.workspaceId ||
    operation.incarnation !== core.kernel.incarnation) throw new StorageInvalidCommandError('unknown staged capability');
  if (operation.ownerId !== bound.grant.principalId) throw new StorageDeniedError('staged operation belongs to another principal');
  return operation;
};
export const assertOperationFence = (core: StagedCore, bound: ScopedRuntime, operation: StagedOperation, fence: WriterFence): void => {
  core.assertFence(bound.grant, fence);
  if (fence.fenceId !== operation.fence.fenceId || fence.epoch !== operation.fence.epoch) throw new StorageInvalidCommandError('operation fence binding changed');
};
export const beginOperation = (core: StagedCore, bound: ScopedRuntime, input: StagedBeginInput): AuthenticatedStagedHandle => {
  bound.requireOperation('write');
  const valid = validateBeginInput(input);
  if (!valid.ok) throw new StorageInvalidCommandError(valid.errors.join('; '));
  const begin = ownedCopy(input);
  if (Buffer.byteLength(JSON.stringify(begin), 'utf8') > stagedLimits(core).maxEncodedBytes) throw new StorageInvalidCommandError('begin metadata exceeds work limits');
  core.assertFence(bound.grant, begin.fence);
  core.current(bound.scope);
  const control = core.control(bound.scope);
  const previous = control.units.get(begin.operationKey);
  if (previous) {
    if (previous.ownerId !== bound.grant.principalId) throw new StorageDeniedError('staged operation belongs to another principal');
    if (previous.begin.inputDigest !== begin.inputDigest || previous.begin.contractDigest !== begin.contractDigest || previous.begin.sourceBoundary !== begin.sourceBoundary) {
      throw new StorageIdempotencyConflictError('divergent staged begin');
    }
    assertOperationFence(core, bound, previous, begin.fence);
    return operationHandle(core, previous);
  }
  freeze(begin);
  const operation: StagedOperation = {
    unitId: opaqueId('unit'), capability: opaqueId('staged-capability'), ownerId: bound.grant.principalId,
    incarnation: core.kernel.incarnation, begin, fence: { ...begin.fence }, scope: Object.freeze({ ...bound.scope }),
    fragments: new IndexedHistory(), receipts: new IndexedMap(), commitId: opaqueId('staged-commit'),
    state: 'staging', progress: null, seal: null, receipt: null, totalEffects: 0, barrierCount: 0, purgeCount: 0,
  };
  control.units.set(begin.operationKey, operation);
  control.byId.set(operation.unitId, operation);
  return operationHandle(core, operation);
};

export interface RootStageInput {
  readonly unit: AuthenticatedStagedHandle; readonly ordinal: string; readonly predecessorHash: string | null;
  readonly fragmentDigest: string; readonly effects: AtomicUnit; readonly fence: WriterFence; readonly limits?: WorkLimits;
}
export const stageOperationFragment = (core: StagedCore, bound: ScopedRuntime, input: RootStageInput): FragmentReceipt => {
  const operation = resolveOperation(core, bound, input.unit);
  assertOperationFence(core, bound, operation, input.fence);
  const limits = stagedLimits(core, input.limits);
  const valid = validateFragmentInput({ ...input, unitId: operation.unitId }, limits);
  if (!valid.ok) throw new StorageInvalidCommandError(valid.errors.join('; '));
  const items = EFFECT_SECTIONS.reduce((sum, section) => sum + input.effects[section].length, 0);
  if (items > limits.maxRecords) throw new StorageInvalidCommandError('fragment exceeds its total item budget');
  if (input.effects.purgeIntents.length > 0) {
    core.requireMaintain(bound.grant);
    if (input.effects.purgeIntents.some((intent) => intent.authorizedBy !== bound.grant.principalId)) throw new StorageDeniedError('purge intent authorizer mismatch');
  }
  const effects = ownedCopy(input.effects);
  if (Buffer.byteLength(JSON.stringify(effects), 'utf8') > limits.maxEncodedBytes) throw new StorageInvalidCommandError('fragment exceeds encoded work limits');
  const digest = stagedFragmentDigest({ moduleId: core.kernel.moduleId as StorageModuleId, scope: bound.scope,
    operationId: operation.begin.operationKey, contractDigest: operation.begin.contractDigest, sourceBoundary: operation.begin.sourceBoundary,
    ordinal: input.ordinal, predecessorHash: input.predecessorHash }, effects);
  const previous = operation.receipts.get(input.ordinal);
  if (previous && operation.state !== 'aborted') {
    if (digest !== previous.fragmentDigest || input.fragmentDigest !== previous.fragmentDigest) throw new StorageIdempotencyConflictError('changed bytes at an accepted ordinal');
    return ownedCopy(previous);
  }
  if (operation.state !== 'staging') throw new StorageInvalidCommandError('staging is frozen');
  if (input.ordinal !== String(operation.fragments.length) || input.predecessorHash !== (operation.fragments.at(-1)?.fragmentDigest ?? null) || digest !== input.fragmentDigest) {
    throw new StorageInvalidCommandError('fragment digest or frontier mismatch');
  }
  bound.requireOperation('write');
  assertOperationFence(core, bound, operation, input.fence);
  freeze(effects);
  operation.fragments.push(Object.freeze({ ordinal: input.ordinal, predecessorHash: input.predecessorHash, fragmentDigest: digest, effects,
    itemCosts: EFFECT_SECTIONS.map((section) => Object.freeze(effects[section].map((item) => Buffer.byteLength(JSON.stringify(item), 'utf8')))),
    dependencyPart: Buffer.from(JSON.stringify([input.ordinal, deriveStagedDependencies(effects)]), 'utf8'),
    effectPart: Buffer.from(JSON.stringify([input.ordinal, stagedEffectDigest(effects)]), 'utf8'),
  }));
  operation.totalEffects += effects.guards.length + effects.records.length + effects.appends.length + effects.updates.length + effects.relationships.length + effects.barriers.length + effects.purgeIntents.length + effects.indexWrites.length;
  operation.barrierCount += effects.barriers.length; operation.purgeCount += effects.purgeIntents.length;
  if (effects.moduleResult !== undefined) operation.moduleResult = effects.moduleResult;
  const receipt = Object.freeze({ unitId: operation.unitId, ordinal: input.ordinal, fragmentDigest: digest });
  operation.receipts.set(input.ordinal, receipt);
  core.consumeFailure(bound.scope, 'stage-response');
  return ownedCopy(receipt);
};
