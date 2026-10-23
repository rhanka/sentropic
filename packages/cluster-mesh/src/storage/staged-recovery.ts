import type { ScopeGrant } from './authority.js';
import type { WriterFence } from './contracts.js';
import { StorageCasConflictError, StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import { IndexedHistory } from './indexed-history.js';
import { opaqueId, ownedCopy, type StagedCore } from './staged-core.js';
import { operationHandle, stagedLimits } from './staged-operations.js';

export interface OperationRecovery {
  readonly operationKey: string; readonly expectedOwnerId: string; readonly expectedUnitId: string;
  readonly newOwner: ScopeGrant<unknown>; readonly fence: WriterFence; readonly reason: string;
}
export interface RecoveryEvidence {
  readonly from: string; readonly to: string; readonly authorizedBy: string; readonly reason: string;
  readonly fence: WriterFence; readonly at: string;
}
const ledger = (core: StagedCore, grant: ScopeGrant<unknown>) => core.backend.controlState(grant.scope, 'operation-recoveries-v1', () => new Map<string, IndexedHistory<RecoveryEvidence>>());

/** Trusted composition only. Authority and compare-and-swap expectations are
 * explicit; recovery changes ownership/capabilities, never frozen input. */
export const recoverStagedOperation = (core: StagedCore, operator: ScopeGrant<unknown>, request: OperationRecovery) => {
  core.requireMaintain(operator);
  const owner = core.kernel.bind(request.newOwner);
  owner.requireOperation('write');
  if (owner.scope.tenantId !== operator.scope.tenantId || owner.scope.workspaceId !== operator.scope.workspaceId) throw new StorageDeniedError('recovery cannot transfer between scopes');
  if (typeof request.reason !== 'string' || !request.reason || request.reason.length > 4096) throw new StorageInvalidCommandError('recovery requires a bounded reason');
  const operation = core.control(operator.scope).units.get(request.operationKey);
  if (!operation || operation.unitId !== request.expectedUnitId || operation.ownerId !== request.expectedOwnerId) throw new StorageCasConflictError('recovery ownership expectation changed');
  if (operation.state === 'committed' || operation.state === 'aborted') throw new StorageInvalidCommandError('terminal operation cannot change ownership');
  core.assertFence(owner.grant, request.fence);
  if (operation.fence.fenceId === request.fence.fenceId && BigInt(request.fence.epoch) <= BigInt(operation.fence.epoch)) throw new StorageInvalidCommandError('recovery must advance the writer fence');
  const history = ledger(core, operator).get(operation.unitId) ?? new IndexedHistory<RecoveryEvidence>();
  history.push(Object.freeze({ from: operation.ownerId, to: owner.grant.principalId, authorizedBy: operator.principalId,
    reason: request.reason, fence: Object.freeze({ ...request.fence }), at: core.clock(),
  }));
  operation.ownerId = owner.grant.principalId;
  operation.fence = Object.freeze({ ...request.fence }); operation.capability = opaqueId('recovered-unit');
  if (operation.seal) operation.seal = Object.freeze({ ...operation.seal, capability: opaqueId('recovered-seal') });
  ledger(core, operator).set(operation.unitId, history);
  return { unit: operationHandle(core, operation), seal: operation.seal ? ownedCopy(operation.seal) : null };
};
export const readRecoveryEvidence = (core: StagedCore, operator: ScopeGrant<unknown>, operationKey: string, after = 0, limit = stagedLimits(core).maxRecords): readonly RecoveryEvidence[] => {
  core.requireMaintain(operator);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > stagedLimits(core).maxRecords) throw new StorageInvalidCommandError('invalid recovery evidence window');
  const operation = core.control(operator.scope).units.get(operationKey);
  if (!operation) throw new StorageInvalidCommandError('unknown recovered operation');
  const history = ledger(core, operator).get(operation.unitId);
  const result: RecoveryEvidence[] = [];
  for (let index = after; index < Math.min(history?.length ?? 0, after + limit); index += 1) result.push(history!.at(index)!);
  return ownedCopy(result);
};
