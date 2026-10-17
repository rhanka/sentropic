import { randomUUID } from 'node:crypto';
import type { ScopeGrant } from './authority.js';
import type { BackendScopeState, MemoryBackend } from './backend.js';
import { isIsoDateString, validateWriterFence, type StorageScope, type WriterFence, type WorkLimits } from './contracts.js';
import type { ModuleDescriptor } from './descriptor.js';
import { StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import type { KernelOptions, KernelRoot } from './kernel.js';
import type { RootMutationCoordinator } from './mutation-coordinator.js';
import type { CommitContext } from './record-runtime.js';
import { coveredBy, createStagedControl, createStagedRootData, lockStagedRootData, type StagedControl, type StagedRootData } from './staged-state.js';

export interface StagedCoreOptions extends Omit<KernelOptions, 'coordinator'> {
  readonly limits?: WorkLimits;
  readonly descriptor?: ModuleDescriptor;
  readonly beforePublish?: (scope: StorageScope, unitId: string) => void | Promise<void>;
}
export interface JournalFence extends WriterFence { readonly incarnation: string; readonly ownerId: string; }
export const ownedCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const opaqueId = (kind: string): string => `${kind}-${randomUUID()}`;

// This core owns memory semantics. The backend retains hidden progress when
// a facade is recreated; no durable-storage claim follows from a rebind.
export class StagedCore {
  readonly clock: () => string;
  private readonly empty: StagedRootData;
  constructor(readonly kernel: KernelRoot, readonly backend: MemoryBackend,
    readonly coordinator: RootMutationCoordinator, readonly options: StagedCoreOptions) {
    this.clock = options.now ?? (() => new Date().toISOString());
    this.empty = lockStagedRootData(createStagedRootData(options.descriptor));
  }
  control(scope: StorageScope): StagedControl {
    return this.backend.controlState(scope, 'staged-runtime-v1', createStagedControl);
  }
  current(scope: StorageScope): BackendScopeState {
    const root = this.coordinator.capture(scope);
    if (!root.indexed) throw new StorageInvalidCommandError('staged storage requires indexed backend roots');
    if (root.attachment === undefined && [root.chains, root.genesis, root.index, root.records, root.aggregates, root.commits].some((map) => map.size > 0)) {
      throw new StorageInvalidCommandError('a populated ordinary backend requires explicit staged migration');
    }
    this.data(root);
    return root;
  }
  data(root: BackendScopeState): StagedRootData {
    if (root.attachment === undefined) return this.empty;
    if ((root.attachment as StagedRootData)?.kind !== 'staged-root-v1') throw new StorageInvalidCommandError('unknown module root attachment');
    return root.attachment as StagedRootData;
  }
  accessible(root: BackendScopeState, key: string): boolean {
    const data = this.data(root);
    return coveredBy(data, key) === null && !data.disposed.has(key);
  }
  context(grant: ScopeGrant<unknown>, commitId = opaqueId('commit')): CommitContext {
    return { moduleId: this.kernel.moduleId, scope: grant.scope, commitId, clock: this.clock, predicates: this.options.predicates };
  }
  provisionFence(scope: StorageScope, ownerId: string, fence: WriterFence, expiresAt: string | null = null): void {
    const valid = validateWriterFence(fence);
    if (!valid.ok || (expiresAt !== null && !isIsoDateString(expiresAt))) throw new StorageInvalidCommandError('invalid writer fence or lease');
    const fences = this.control(scope).fences;
    const current = fences.get(fence.fenceId);
    if (current && (current.ownerId !== ownerId || current.value.epoch !== fence.epoch)) throw new StorageInvalidCommandError('fence lane already has another owner or epoch');
    if (!current) fences.set(fence.fenceId, Object.freeze({ value: Object.freeze({ ...fence }), ownerId, expiresAt }));
  }
  rotateFence(scope: StorageScope, fence: WriterFence, ownerId?: string, expiresAt: string | null = null): void {
    const valid = validateWriterFence(fence);
    const fences = this.control(scope).fences;
    const previous = fences.get(fence.fenceId);
    if (!valid.ok || !previous || BigInt(fence.epoch) <= BigInt(previous.value.epoch) || (expiresAt !== null && !isIsoDateString(expiresAt))) {
      throw new StorageInvalidCommandError('fence rotation must advance an existing lane');
    }
    fences.set(fence.fenceId, Object.freeze({ value: Object.freeze({ ...fence }), ownerId: ownerId ?? previous.ownerId, expiresAt }));
  }
  assertFence(grant: ScopeGrant<unknown>, fence: WriterFence): void {
    this.kernel.bind(grant);
    const valid = validateWriterFence(fence);
    if (!valid.ok) throw new StorageInvalidCommandError(valid.errors.join('; '));
    const current = this.control(grant.scope).fences.get(fence.fenceId);
    if (!current || current.value.epoch !== fence.epoch || current.ownerId !== grant.principalId ||
      (current.expiresAt !== null && Date.parse(current.expiresAt) <= Date.parse(this.clock()))) {
      throw new StorageInvalidCommandError('writer fence is not current for this owner');
    }
  }
  journalFence(grant: ScopeGrant<unknown>): JournalFence {
    this.kernel.bind(grant).requireOperation('maintain');
    const control = this.control(grant.scope);
    let lane = control.journalLanes.get(grant.principalId);
    if (!lane) {
      lane = opaqueId('journal-fence');
      this.provisionFence(grant.scope, grant.principalId, { fenceId: lane, epoch: '1' }, grant.lifetime.kind === 'lease' ? grant.lifetime.expiresAt : null);
      control.journalLanes.set(grant.principalId, lane);
    }
    const fence = control.fences.get(lane)!.value;
    this.assertFence(grant, fence);
    return { ...fence, incarnation: this.kernel.incarnation, ownerId: grant.principalId };
  }
  assertJournalFence(grant: ScopeGrant<unknown>, fence: JournalFence): void {
    this.kernel.bind(grant).requireOperation('maintain');
    if (!fence || fence.incarnation !== this.kernel.incarnation || fence.ownerId !== grant.principalId) throw new StorageInvalidCommandError('journal fence binding mismatch');
    this.assertFence(grant, fence);
  }
  consumeFailure(scope: StorageScope, point: StagedControl['failures'] extends Set<infer T> ? T : never): void {
    if (this.control(scope).failures.delete(point)) throw new StorageInvalidCommandError(`injected ${point} interruption`);
  }
  requireMaintain(grant: ScopeGrant<unknown>): void { this.kernel.bind(grant).requireOperation('maintain'); }
}
