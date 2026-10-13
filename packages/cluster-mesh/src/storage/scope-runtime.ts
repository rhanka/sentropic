// K3 scope binding and ordinary transactions (L3a v4.1 frozen §4, §5).
// Grants are JSON DTOs: bind keeps a deeply frozen copy, so caller-side
// mutation can never escalate authority or switch scope. Every operation
// revalidates expiry, revocation and the required storage operation.
// transact() runs in a request-local asynchronous context: independent calls
// stay isolated while a nested call on the same handle joins the outer
// overlay and can only mark it rollback-only. The commit id is reserved
// upfront so joined calls share one honest receipt; an empty transaction
// commits nothing and is refused.Physically disposed chains deny full
// getters and leak no continuation. Reads return copies, never canonical
// state.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { canOperate, validateScopeGrant, type ScopeGrant } from './authority.js';
import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from './errors.js';
import type { AtomicUnit, CommitOptions, CommitReceipt } from './atomic.js';
import { requireProfile, type ProfileClaim, type ProfileId } from './profiles.js';
import type { MemoryBackend } from './backend.js';
import {
  appendChainToScope,
  commitAtomicToScope,
  commitUnitsToScope,
  disposeChainInScope,
  genesisToScope,
  readPageFromScope,
  type ChainRecordInput,
  type PredicateEvaluator,
  type ReadPageResult,
} from './record-runtime.js';
import type { ChainBoundaryProvider } from './tokens.js';
import type { StorageScope } from './contracts.js';

const profileDigest = (profile: ProfileId): string =>
  createHash('sha256').update(`k3-ordinary-v1:${profile}:1`, 'utf8').digest('hex');

export const ORDINARY_PROFILES: readonly ProfileClaim[] = [
  { profile: 'atomic-units-v1', version: '1', digest: profileDigest('atomic-units-v1') },
  { profile: 'immutable-chains-v1', version: '1', digest: profileDigest('immutable-chains-v1') },
  { profile: 'immutable-boundaries-v1', version: '1', digest: profileDigest('immutable-boundaries-v1') },
];

const deepCopyGrant = (grant: ScopeGrant<unknown>): ScopeGrant<unknown> =>
  JSON.parse(JSON.stringify(grant)) as ScopeGrant<unknown>;

const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) deepFreeze(entry);
  Object.freeze(value);
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

interface TxOverlay {
  readonly units: AtomicUnit[];
  readonly heads: Map<string, string | null>;
  readonly created: Set<string>;
  readonly aggregateVersions: Map<string, number>;
  readonly aggregateWrites: Map<string, { version: number; value: { format: 'utf8' | 'base64'; data: string } }>;
  readonly recordWrites: Map<string, { bytes: { format: 'utf8' | 'base64'; data: string }; contentHash: string }>;
  readonly chainAppends: Map<string, ChainRecordInput[]>;
  rollbackOnly: boolean;
  savedError: unknown;
  closed: boolean;
  readonly receipt: CommitReceipt;
}

export interface KernelTransaction {
  apply(unit: AtomicUnit): Promise<void>;
  readHead(chainId: string): Promise<string | null>;
  readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null>;
  readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  readChain(chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]>;
  findIdempotency(key: string): Promise<CommitReceipt | null>;
}

export interface ScopedRuntimeDeps {
  readonly moduleId: string;
  readonly backend: MemoryBackend;
  readonly provider: ChainBoundaryProvider;
  readonly incarnation: string;
  readonly clock: () => string;
  readonly revoked: Set<string>;
  readonly issued: Map<string, string>;
  readonly nextCommitId: () => string;
  readonly predicates?: Readonly<Record<string, PredicateEvaluator>>;
}

// Request-local transaction contexts (§5.5 isolation between concurrent
// contexts): one overlay per handle per asynchronous call chain.
const txScope = new AsyncLocalStorage<Map<ScopedRuntime, TxOverlay>>();

export class ScopedRuntime {
  readonly grant: ScopeGrant<unknown>;
  private readonly boundScope: StorageScope;

  constructor(
    grant: ScopeGrant<unknown>,
    readonly moduleId: string,
    private readonly deps: ScopedRuntimeDeps,
  ) {
    const copy = deepCopyGrant(grant);
    deepFreeze(copy);
    this.grant = copy;
    this.boundScope = { tenantId: copy.scope.tenantId, workspaceId: copy.scope.workspaceId };
  }

  get scope(): StorageScope {
    return this.boundScope;
  }

  get profiles(): readonly ProfileClaim[] {
    return ORDINARY_PROFILES;
  }

  capability(profile: ProfileId): ProfileClaim {
    requireProfile(
      ORDINARY_PROFILES.map((entry) => entry.profile),
      profile,
    );
    const claim = ORDINARY_PROFILES.find((entry) => entry.profile === profile);
    if (!claim) throw new UnsupportedProfileError(String(profile));
    return { profile: claim.profile, version: claim.version, digest: claim.digest };
  }

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    const validity = validateScopeGrant(this.grant, { nowIso: this.deps.clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (this.deps.revoked.has(this.grant.token)) throw new StorageDeniedError('grant revoked');
    if (!canOperate(this.grant, op)) throw new StorageDeniedError(`grant lacks ${op}`);
    if (this.grant.scope.tenantId !== this.boundScope.tenantId || this.grant.scope.workspaceId !== this.boundScope.workspaceId) {
      throw new StorageDeniedError('cross-scope handle');
    }
  }

  async appendChain(chainId: string, record: ChainRecordInput, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Promise<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    return appendChainToScope(this.deps.backend.scopeState(this.boundScope), chainId, record, expectation);
  }

  async genesis(kind: string, id: string, hash: string, value: unknown): Promise<{ readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    return genesisToScope(this.deps.backend.scopeState(this.boundScope), kind, id, hash, value);
  }

  async indexGet(key: string): Promise<{ readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null> {
    this.requireOperation('read');
    const stored = this.deps.backend.scopeState(this.boundScope).index.get(key);
    if (!stored) return null;
    return { digest: stored.digest, resultIds: [...stored.resultIds], resultHash: stored.resultHash };
  }

  async indexPut(key: string, entry: { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null }): Promise<'insert' | 'replace'> {
    this.requireOperation('write');
    const state = this.deps.backend.scopeState(this.boundScope);
    const stored = state.index.get(key);
    if (!stored) {
      state.index.set(key, entry);
      return 'insert';
    }
    if (stored.digest === entry.digest) {
      state.index.set(key, entry);
      return 'replace';
    }
    throw new StorageIdempotencyConflictError('index digest conflict');
  }

  async readHead(chainId: string): Promise<string | null> {
    this.requireOperation('read');
    const chain = this.deps.backend.scopeState(this.boundScope).chains.get(chainId);
    if (chain?.disposed) throw new StorageDeniedError('chain disposed');
    return chain?.head ?? null;
  }

  async readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> {
    this.requireOperation('read');
    const stored = this.deps.backend.scopeState(this.boundScope).records.get(key);
    if (!stored) return null;
    return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
  }

  async readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> {
    this.requireOperation('read');
    const stored = this.deps.backend.scopeState(this.boundScope).aggregates.get(key);
    if (!stored) return null;
    return { version: stored.version, value: { ...stored.value } };
  }

  async readChain(chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]> {
    this.requireOperation('read');
    const chain = this.deps.backend.scopeState(this.boundScope).chains.get(chainId);
    if (chain?.disposed) throw new StorageDeniedError('chain disposed');
    return (chain?.records ?? []).map((entry) => ({ ...entry }));
  }

  async readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<ReadPageResult> {
    this.requireOperation('read');
    return readPageFromScope(this.deps.backend.scopeState(this.boundScope), chainId, limit, cursor, maxEncodedBytes, {
      moduleId: this.moduleId,
      scope: this.boundScope,
      incarnation: this.deps.incarnation,
      provider: this.deps.provider,
    });
  }

  async disposeChain(chainId: string): Promise<void> {
    this.requireOperation('maintain');
    disposeChainInScope(this.deps.backend.scopeState(this.boundScope), chainId);
  }

  async commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): Promise<CommitReceipt> {
    this.requireOperation('write');
    return commitAtomicToScope(this.deps.backend.scopeState(this.boundScope), unit, options, {
      moduleId: this.moduleId,
      scope: this.boundScope,
      clock: this.deps.clock,
      commitId: this.deps.nextCommitId(),
      predicates: this.deps.predicates,
    });
  }

  async transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>): Promise<{ readonly value: T; readonly receipt: CommitReceipt }> {
    this.requireOperation('write');
    const ambient = txScope.getStore();
    const joined = ambient?.get(this);
    if (joined && !joined.closed) {
      try {
        const value = await operation(this.makeTx(joined));
        return { value, receipt: joined.receipt };
      } catch (error) {
        joined.rollbackOnly = true;
        joined.savedError = error;
        throw error;
      }
    }
    // The commit id is reserved before the operation runs so every joined
    // call shares the single receipt of the one commit that follows.
    const commitId = this.deps.nextCommitId();
    const receipt: CommitReceipt = { commitId, moduleId: this.moduleId, scope: { ...this.boundScope }, committedAt: this.deps.clock(), effectiveRecords: 0, effectiveAppends: 0, journalCursor: `cursor-${commitId}` };
    const overlay: TxOverlay = { units: [], heads: new Map(), created: new Set(), aggregateVersions: new Map(), aggregateWrites: new Map(), recordWrites: new Map(), chainAppends: new Map(), rollbackOnly: false, savedError: null, closed: false, receipt };
    const nested = new Map(ambient);
    nested.set(this, overlay);
    try {
      const value = await txScope.run(nested, () => operation(this.makeTx(overlay)));
      if (overlay.rollbackOnly) throw overlay.savedError ?? new StorageInvalidCommandError('transaction rolled back');
      this.requireOperation('write');
      if (overlay.units.length === 0) throw new StorageInvalidCommandError('empty transaction commits nothing');
      const committed = commitUnitsToScope(this.deps.backend.scopeState(this.boundScope), overlay.units, options, {
        moduleId: this.moduleId,
        scope: this.boundScope,
        clock: this.deps.clock,
        commitId,
        predicates: this.deps.predicates,
      });
      Object.assign(overlay.receipt, committed);
      return { value, receipt: overlay.receipt };
    } catch (error) {
      if (!overlay.rollbackOnly) {
        overlay.rollbackOnly = true;
        overlay.savedError = error;
        throw error;
      }
      throw overlay.savedError ?? error;
    } finally {
      overlay.closed = true;
    }
  }

  private makeTx(overlay: TxOverlay): KernelTransaction {
    const backendState = () => this.deps.backend.scopeState(this.boundScope);
    const effectiveHead = (chainId: string): string | null => {
      if (overlay.heads.has(chainId)) return overlay.heads.get(chainId) ?? null;
      return backendState().chains.get(chainId)?.head ?? null;
    };
    const effectiveAggregateVersion = (key: string): number | undefined => {
      if (overlay.aggregateVersions.has(key)) return overlay.aggregateVersions.get(key);
      return backendState().aggregates.get(key)?.version;
    };
    const markFailed = (error: unknown): never => {
      overlay.rollbackOnly = true;
      overlay.savedError = error;
      throw error;
    };
    return {
      apply: async (unit: AtomicUnit): Promise<void> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        try {
          for (const guard of unit.guards) {
            if (guard.kind === 'head' && effectiveHead(guard.chainId) !== guard.hash) throw new StorageCasConflictError('guard head mismatch');
            if (guard.kind === 'absent' && (overlay.created.has(guard.chainId) || backendState().chains.has(guard.chainId))) {
              throw new StorageIdempotencyConflictError('guard absent violated');
            }
            if (guard.kind === 'aggregate-version' && effectiveAggregateVersion(guard.key) !== guard.version) {
              throw new StorageCasConflictError('guard aggregate version mismatch');
            }
            if (guard.kind === 'predicate') {
              if (!nonEmpty(guard.predicateId) || !nonEmpty(guard.dependency)) {
                throw new StorageInvalidCommandError('predicate guard requires an id and dependency');
              }
              const evaluator = this.deps.predicates?.[guard.predicateId];
              if (!evaluator) throw new UnsupportedProfileError(`predicate:${guard.predicateId}`);
              if (!evaluator(guard.dependency)) throw new StorageCasConflictError('predicate guard mismatch');
            }
          }
          for (const append of unit.appends) {
            if (append.expectation.kind === 'absent') {
              if (overlay.created.has(append.chainId) || backendState().chains.has(append.chainId)) {
                throw new StorageIdempotencyConflictError('stale creation expectation');
              }
            } else if (effectiveHead(append.chainId) !== append.expectation.hash) {
              throw new StorageCasConflictError('stale head at commit');
            }
          }
        } catch (error) {
          markFailed(error);
        }
        // The flush plan is frozen: later caller-side mutation of the unit
        // cannot change what the commit stages.
        const frozen = JSON.parse(JSON.stringify(unit)) as AtomicUnit;
        overlay.units.push(frozen);
        for (const append of frozen.appends) {
          if (append.expectation.kind === 'absent') overlay.created.add(append.chainId);
          overlay.heads.set(append.chainId, append.record.hash);
          const pending = overlay.chainAppends.get(append.chainId) ?? [];
          pending.push({ ...append.record });
          overlay.chainAppends.set(append.chainId, pending);
        }
        for (const update of frozen.updates) {
          overlay.aggregateVersions.set(update.key, update.version);
          overlay.aggregateWrites.set(update.key, { version: update.version, value: { ...update.value } });
        }
        for (const record of frozen.records) {
          overlay.recordWrites.set(record.key, { bytes: { ...record.bytes }, contentHash: record.contentHash });
        }
      },
      readHead: async (chainId: string): Promise<string | null> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        if (backendState().chains.get(chainId)?.disposed) throw new StorageDeniedError('chain disposed');
        return effectiveHead(chainId);
      },
      readAggregate: async (key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        const pending = overlay.aggregateWrites.get(key);
        if (pending) return { version: pending.version, value: { ...pending.value } };
        const stored = backendState().aggregates.get(key);
        if (!stored) return null;
        return { version: stored.version, value: { ...stored.value } };
      },
      readRecord: async (key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        const pending = overlay.recordWrites.get(key);
        if (pending) return { bytes: { ...pending.bytes }, contentHash: pending.contentHash };
        const stored = backendState().records.get(key);
        if (!stored) return null;
        return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
      },
      readChain: async (chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        const chain = backendState().chains.get(chainId);
        if (chain?.disposed) throw new StorageDeniedError('chain disposed');
        const combined = (chain?.records ?? []).map((entry) => ({ ...entry }));
        for (const record of overlay.chainAppends.get(chainId) ?? []) {
          combined.push({ id: record.id, seq: combined.length, hash: record.hash, bytes: record.bytes });
        }
        return combined;
      },
      findIdempotency: async (key: string): Promise<CommitReceipt | null> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        const stored = backendState().commits.get(key);
        if (!stored) return null;
        return { ...stored.receipt, scope: { ...stored.receipt.scope } };
      },
    };
  }
}
