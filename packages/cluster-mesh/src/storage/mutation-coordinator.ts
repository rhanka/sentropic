import type { AtomicUnit, CommitOptions, CommitReceipt } from './atomic.js';
import { validateAtomicUnit, validateCommitOptions } from './atomic.js';
import type { ScopeGrant } from './authority.js';
import { backendScopeKey, forkBackendScope, lockBackendScope, type BackendScopeState, type MemoryBackend } from './backend.js';
import { DEFAULT_WORK_LIMITS, validateWorkLimits, type StorageScope, type WriterFence, type WorkLimits } from './contracts.js';
import { StorageCasConflictError, StorageIdempotencyConflictError, StorageInvalidCommandError, UnsupportedProfileError } from './errors.js';
import { mergeAtomicUnits, prepareUnitsInScope, type CommitContext } from './record-runtime.js';

export type RootReadKind = 'chain' | 'record' | 'aggregate' | 'index' | 'genesis';
export type RootMutationKind = 'append' | 'genesis' | 'index' | 'dispose' | 'commit' | 'coverage' | 'lifecycle' | 'maintenance';
export interface RootMutationNotice {
  readonly kind: RootMutationKind;
  readonly keys: readonly string[];
  readonly units: readonly AtomicUnit[];
  readonly options: CommitOptions;
  readonly receipt: CommitReceipt;
}
export interface RootMutationHooks {
  prepare?(base: BackendScopeState, prepared: BackendScopeState, grant: ScopeGrant<unknown>, notice: RootMutationNotice): void;
  accessible?(state: BackendScopeState, kind: RootReadKind, key: string, grant: ScopeGrant<unknown>): boolean;
  fence?(grant: ScopeGrant<unknown>, fence: WriterFence): void;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const freeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
};
const receiptFor = (ctx: CommitContext, records = 0, appends = 0): CommitReceipt => ({
  commitId: ctx.commitId, moduleId: ctx.moduleId, scope: { ...ctx.scope }, committedAt: ctx.clock(),
  effectiveRecords: records, effectiveAppends: appends, journalCursor: `cursor-${ctx.commitId}`,
});

/** Trusted composition machinery. Adapter handles never expose this object.
 * All data and module effects are prepared before one conditional root swap. */
export class RootMutationCoordinator {
  private readonly maximum: WorkLimits;
  constructor(readonly backend: MemoryBackend, readonly hooks: RootMutationHooks = {}, maximum: WorkLimits = DEFAULT_WORK_LIMITS) {
    if (!validateWorkLimits(maximum).ok) throw new StorageInvalidCommandError('invalid coordinator work ceiling');
    this.maximum = Object.freeze({ ...maximum });
  }

  capture(scope: StorageScope): BackendScopeState { return lockBackendScope(this.backend.scopeState(scope)); }
  prepare(base: BackendScopeState): BackendScopeState { return forkBackendScope(base); }
  accessible(grant: ScopeGrant<unknown>, kind: RootReadKind, key: string): boolean {
    return this.hooks.accessible?.(this.capture(grant.scope), kind, key, grant) ?? true;
  }
  private prepareEffects(base: BackendScopeState, prepared: BackendScopeState, grant: ScopeGrant<unknown>, notice: RootMutationNotice): void {
    const result = this.hooks.prepare?.(base, prepared, grant, notice) as unknown;
    if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
      void Promise.resolve(result as PromiseLike<unknown>).catch(() => undefined);
      throw new StorageInvalidCommandError('final preparation hooks must be synchronous');
    }
  }
  publish(scope: StorageScope, base: BackendScopeState, prepared: BackendScopeState, revalidate: () => void): void {
    revalidate();
    if (this.backend.scopeState(scope) !== base) throw new StorageCasConflictError('captured visibility root changed');
    Object.assign(prepared, { version: String(BigInt(base.version ?? '0') + 1n) });
    this.backend.scopes.set(backendScopeKey(scope), lockBackendScope(prepared));
  }

  mutate<T>(grant: ScopeGrant<unknown>, kind: RootMutationKind, keys: readonly string[], operation: (state: BackendScopeState) => T,
    ctx: CommitContext, revalidate: () => void): T {
    const base = this.capture(grant.scope);
    const prepared = this.prepare(base);
    const result = operation(prepared);
    const unchanged = () => {
      revalidate();
      if (this.backend.scopeState(grant.scope) !== base) throw new StorageCasConflictError('captured visibility root changed');
      return result;
    };
    if (typeof result === 'object' && result !== null && 'replayed' in result && result.replayed === true) return unchanged();
    if (kind === 'index' && JSON.stringify(base.index.get(keys[0])) === JSON.stringify(prepared.index.get(keys[0]))) return unchanged();
    if (kind === 'dispose' && base.chains.get(keys[0])?.disposed === prepared.chains.get(keys[0])?.disposed) return unchanged();
    this.prepareEffects(base, prepared, grant, { kind, keys, receipt: receiptFor(ctx), units: [], options: {} });
    this.publish(grant.scope, base, prepared, revalidate);
    return result;
  }

  commit(grant: ScopeGrant<unknown>, units: readonly AtomicUnit[], requestedOptions: CommitOptions, ctx: CommitContext,
    revalidate: () => void): CommitReceipt {
    const options = copy(requestedOptions);
    freeze(options);
    const limits = { ...(options.limits ?? this.maximum) };
    if (!validateWorkLimits(limits).ok || Object.keys(this.maximum).some((key) => limits[key as keyof WorkLimits] > this.maximum[key as keyof WorkLimits])) {
      throw new StorageInvalidCommandError('requested work limits exceed the configured ceiling');
    }
    const owned = copy(units);
    for (const unit of owned) {
      if (!unit || !['guards', 'records', 'appends', 'updates', 'relationships', 'barriers', 'purgeIntents', 'indexWrites']
        .every((key) => Array.isArray((unit as unknown as Record<string, unknown>)[key]))) {
        throw new StorageInvalidCommandError('invalid atomic unit shape');
      }
    }
    const merged = mergeAtomicUnits(owned);
    const validity = validateAtomicUnit(merged, limits);
    if (!validity.ok || !validateCommitOptions(options).ok || Buffer.byteLength(JSON.stringify(merged), 'utf8') > limits.maxEncodedBytes) {
      throw new StorageInvalidCommandError('invalid unit or exceeded atomic work limits');
    }
    freeze(owned);
    if (!this.hooks.prepare && (merged.relationships.length + merged.barriers.length + merged.purgeIntents.length > 0)) {
      throw new UnsupportedProfileError('registered-module-effects');
    }
    const verifyFence = () => {
      if (options.fence) {
        if (!this.hooks.fence) throw new UnsupportedProfileError('fenced-writers-v1');
        this.hooks.fence(grant, options.fence);
      }
    };
    verifyFence();
    const base = this.capture(grant.scope);
    const unitHash = JSON.stringify(owned);
    const previous = options.idempotencyKey ? base.commits.get(options.idempotencyKey) : undefined;
    if (previous) {
      if (previous.unitHash !== unitHash) throw new StorageIdempotencyConflictError('idempotency key reused with divergent input');
      revalidate();
      verifyFence();
      return copy(previous.receipt);
    }
    const prepared = this.prepare(base);
    prepareUnitsInScope(prepared, owned.map((unit) => ({ ...unit, relationships: [], barriers: [], purgeIntents: [] })), ctx);
    const receipt = receiptFor(ctx, merged.records.length + merged.appends.length + merged.updates.length, merged.appends.length);
    if (merged.moduleResult !== undefined) Object.assign(receipt, { moduleResult: copy(merged.moduleResult) });
    if (options.idempotencyKey) prepared.commits.set(options.idempotencyKey, { receipt: copy(receipt), unitHash });
    this.prepareEffects(base, prepared, grant, { kind: 'commit', keys: [], units: owned, options, receipt });
    this.publish(grant.scope, base, prepared, () => { revalidate(); verifyFence(); });
    return copy(receipt);
  }
}
