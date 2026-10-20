import type { BackendScopeState } from './backend.js';
import { StorageDeniedError, StorageInvalidCommandError, StorageIdempotencyConflictError } from './errors.js';
import { IndexedMap } from './indexed-map.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { opaqueId, ownedCopy, type StagedCore } from './staged-core.js';
import { appendRootEvent } from './staged-effects.js';
import { coveredBy, forkStagedRootData, lockStagedRootData, type PurgePolicy, type StagedRootData } from './staged-state.js';
import { stagedLimits } from './staged-operations.js';

export const changeModuleRoot = <T>(core: StagedCore, bound: ScopedRuntime, authority: 'write' | 'maintain',
  operation: (root: BackendScopeState, data: StagedRootData) => T): T => {
  bound.requireOperation(authority);
  const base = core.current(bound.scope);
  const root = core.coordinator.prepare(base);
  const data = forkStagedRootData(core.data(base));
  const result = operation(root, data);
  const commitId = opaqueId('maintenance');
  appendRootEvent(core, base, data, bound.grant, { commitId, moduleId: core.kernel.moduleId, scope: { ...bound.scope },
    committedAt: core.clock(), effectiveRecords: 0, effectiveAppends: 0, journalCursor: `cursor-${commitId}` });
  Object.assign(root, { attachment: lockStagedRootData(data) });
  core.coordinator.publish(bound.scope, base, root, () => bound.requireOperation(authority));
  return result;
};
const name = (value: string): void => {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new StorageInvalidCommandError('invalid lifecycle identity');
};
export const configureRootLifecycle = (core: StagedCore, bound: ScopedRuntime, policy: PurgePolicy): void => {
  if (!['unconfigured', 'optional', 'required'].includes(policy)) throw new StorageInvalidCommandError('unknown purge policy');
  changeModuleRoot(core, bound, 'maintain', (_root, data) => { data.policy = policy; });
};
export const declareRootCoverage = (core: StagedCore, bound: ScopedRuntime, parent: string, child: string): void => {
  name(parent); name(child);
  changeModuleRoot(core, bound, 'write', (_root, data) => {
    if (coveredBy(data, child) !== null && data.coverage.get(child) !== parent) throw new StorageInvalidCommandError('covered child cannot be reparented');
    let ancestor: string | undefined = parent;
    const seen = new Set<string>([child]);
    while (ancestor !== undefined) {
      if (seen.has(ancestor)) throw new StorageInvalidCommandError('coverage cycle');
      seen.add(ancestor); ancestor = data.coverage.get(ancestor);
    }
    data.coverage.set(child, parent);
  });
};
export const holdRootTarget = (core: StagedCore, bound: ScopedRuntime, target: string, reason: string | null): void => {
  name(target); if (reason !== null) name(reason);
  changeModuleRoot(core, bound, 'maintain', (_root, data) => { if (reason === null) data.holds.delete(target); else data.holds.set(target, reason); });
};
export const completeRootPurge = (core: StagedCore, bound: ScopedRuntime, intentId: string) => {
  bound.requireOperation('maintain');
  const current = core.data(core.current(bound.scope)).jobs.get(intentId);
  if (!current) throw new StorageInvalidCommandError('unknown purge intent');
  if (current.state === 'complete') return ownedCopy(current);
  const result = changeModuleRoot(core, bound, 'maintain', (root, data) => {
    const job = data.jobs.get(intentId)!;
    let held = false;
    let ancestor: string | undefined = job.target;
    const seen = new Set<string>();
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor); held ||= data.holds.has(ancestor); ancestor = data.coverage.get(ancestor);
    }
    const blob = data.blobs.get(job.target);
    held ||= (blob?.owners.size ?? 0) > 0;
    const exists = root.chains.has(job.target) || root.records.has(job.target) || root.aggregates.has(job.target) || blob !== undefined;
    if (held || !exists) {
      const pending = Object.freeze({ ...job, state: held ? 'held' as const : 'failed' as const });
      data.jobs.set(intentId, pending); return pending;
    }
    data.disposed.set(job.target, true);
    const chain = root.chains.get(job.target);
    if (chain) root.chains.set(job.target, Object.freeze({ ...chain, disposed: true }));
    // Immutable captured roots retain bytes. Memory disposal is availability
    // control and must never be reported as physical erasure.
    const completed = Object.freeze({ ...job, state: 'complete' as const, outcomeId: opaqueId('purge-outcome'), payloadDisposition: 'retained' as const });
    const evidence = Object.freeze({ intentId, outcomeId: completed.outcomeId });
    data.jobs.set(intentId, completed); data.outcomes.push(evidence); data.notifications.push(evidence);
    return completed;
  });
  return ownedCopy(result);
};
export const shareRootBlob = (core: StagedCore, bound: ScopedRuntime, blobId: string, owner: string, bytes?: string): void => {
  name(blobId); name(owner);
  if (bytes !== undefined && (typeof bytes !== 'string' || Buffer.byteLength(bytes, 'utf8') > stagedLimits(core).maxEncodedBytes)) throw new StorageInvalidCommandError('blob exceeds configured limits');
  changeModuleRoot(core, bound, 'write', (root, data) => {
    if (!core.accessible(root, blobId)) throw new StorageDeniedError('blob is inaccessible');
    const previous = data.blobs.get(blobId);
    if (bytes !== undefined && previous?.bytes !== null && previous?.bytes !== undefined && previous.bytes !== bytes) throw new StorageIdempotencyConflictError('shared blob bytes conflict');
    const owners = previous?.owners.fork() ?? new IndexedMap<true>();
    if (bytes === undefined) owners.delete(owner); else owners.set(owner, true);
    data.blobs.set(blobId, Object.freeze({ owners: owners.lock(), bytes: owners.size === 0 ? null : bytes ?? previous?.bytes ?? null }));
  });
};
