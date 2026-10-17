import type { AtomicUnit, CommitReceipt } from './atomic.js';
import type { ScopeGrant } from './authority.js';
import type { BackendScopeState } from './backend.js';
import { StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from './errors.js';
import type { RootMutationNotice } from './mutation-coordinator.js';
import { ownedCopy, type StagedCore } from './staged-core.js';
import { coveredBy, forkStagedRootData, lockStagedRootData, type StagedRootData } from './staged-state.js';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export const validateRootPolicy = (core: StagedCore, data: StagedRootData, grant: ScopeGrant<unknown>, barriers: number, purges: number): void => {
  if (purges > 0) {
    core.requireMaintain(grant);
    if (data.policy === 'unconfigured') throw new StorageDeniedError('purge is not configured');
  }
  if (data.policy === 'required' && barriers > 0 && purges === 0) throw new StorageInvalidCommandError('an authorized purge intent is required');
};

/** Apply one bounded plan to owned module roots. A failed projection leaves
 * only this uncommitted successor changed; the captured root is untouched. */
export const applyRootModuleEffects = (core: StagedCore, base: StagedRootData, data: StagedRootData,
  grant: ScopeGrant<unknown>, unit: AtomicUnit): void => {
  const subjects = [
    ...unit.appends.map((entry) => entry.chainId), ...unit.records.map((entry) => entry.key),
    ...unit.updates.map((entry) => entry.key), ...unit.indexWrites.map((entry) => entry.key),
  ];
  for (const subject of subjects) {
    if (coveredBy(base, subject) !== null || base.disposed.has(subject)) throw new StorageInvalidCommandError('a covered subject cannot escape its boundary');
  }
  data.projections.applyRelationships(unit.relationships);
  for (const barrier of unit.barriers) {
    if (!nonEmpty(barrier.boundary) || !nonEmpty(barrier.reason)) throw new StorageInvalidCommandError('invalid barrier');
    data.barriers.set(barrier.boundary, Object.freeze({ reason: barrier.reason, createdAt: core.clock() }));
  }
  for (const intent of unit.purgeIntents) {
    core.requireMaintain(grant);
    if (data.policy === 'unconfigured') throw new StorageDeniedError('purge is not configured');
    if (intent.authorizedBy !== grant.principalId) throw new StorageDeniedError('purge intent does not name its verified authorizer');
    if (!nonEmpty(intent.intentId) || !nonEmpty(intent.target)) throw new StorageInvalidCommandError('invalid purge intent');
    const previous = data.jobs.get(intent.intentId);
    if (previous && (previous.target !== intent.target || previous.authorizedBy !== intent.authorizedBy)) {
      throw new StorageIdempotencyConflictError('purge intent reused with divergent authorization or target');
    }
    if (!previous) data.jobs.set(intent.intentId, Object.freeze({ ...intent, state: 'pending', outcomeId: null, payloadDisposition: null }));
  }
};

export const appendRootEvent = (core: StagedCore, base: BackendScopeState, data: StagedRootData,
  grant: ScopeGrant<unknown>, receipt: CommitReceipt, operationKey?: string, staged = false): void => {
  const seq = data.journal.length + 1;
  const eventId = JSON.stringify([core.kernel.moduleId, grant.scope.tenantId, grant.scope.workspaceId, core.kernel.incarnation, 'scope-journal', seq]);
  data.journal.push(Object.freeze({ seq, eventId, scope: Object.freeze({ ...grant.scope }), commitId: receipt.commitId,
    rootVersion: String(BigInt(base.version ?? '0') + 1n), ...(operationKey === undefined ? {} : { operationKey }),
    ...(staged && operationKey ? { segment: Object.freeze({ operationKey, from: seq, to: seq }) } : {}),
  }));
  data.audit.push(ownedCopy(receipt));
};

export const prepareStagedRootNotice = (core: StagedCore, base: BackendScopeState, prepared: BackendScopeState,
  grant: ScopeGrant<unknown>, notice: RootMutationNotice): void => {
  core.consumeFailure(grant.scope, 'external');
  const before = core.data(base);
  const data = prepared.attachment === base.attachment ? forkStagedRootData(before) : core.data(prepared);
  validateRootPolicy(core, data, grant,
    notice.units.reduce((sum, unit) => sum + unit.barriers.length, 0),
    notice.units.reduce((sum, unit) => sum + unit.purgeIntents.length, 0));
  if (notice.kind === 'append' || notice.kind === 'index' || notice.kind === 'genesis') {
    for (const key of notice.keys) if (coveredBy(before, key) !== null || before.disposed.has(key)) throw new StorageInvalidCommandError('covered mutation refused');
  }
  if (notice.kind === 'dispose') for (const key of notice.keys) data.disposed.set(key, true);
  const seenRecords = new Set<string>();
  for (const unit of notice.units) {
    applyRootModuleEffects(core, before, data, grant, unit);
    const created = unit.records.filter((entry) => {
      const fresh = !base.records.has(entry.key) && !seenRecords.has(entry.key);
      seenRecords.add(entry.key); return fresh;
    });
    if (created.length + unit.appends.length + unit.updates.length + unit.relationships.length + unit.barriers.length === 0) continue;
    data.projections.emitDelta({ cause: 'atomic', records: [...created.map((entry) => entry.key), ...unit.appends.map((entry) => entry.chainId)],
      aggregates: unit.updates.map((entry) => entry.key), relationships: unit.relationships.map((entry) => entry.relation),
      barriers: unit.barriers.map((entry) => entry.boundary),
    });
  }
  appendRootEvent(core, base, data, grant, notice.receipt, notice.options.idempotencyKey);
  Object.assign(prepared, { attachment: lockStagedRootData(data) });
};
