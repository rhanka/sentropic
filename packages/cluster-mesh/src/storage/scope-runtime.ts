// K3 scope binding and ordinary transactions (L3a v4.1 frozen §4, §5).
// Grants are JSON DTOs: bind keeps a deeply frozen copy, so caller-side
// mutation can never escalate authority or switch scope. Every operation
// revalidates expiry, revocation and the required storage operation.
// transact() gives immediate CAS on read state plus pending writes,
// read-your-writes, complete rollback, isolation between contexts,
// closed-context refusal and nested-join rollback-only semantics.

import { canOperate, validateScopeGrant, type ScopeGrant } from './authority.js';
import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from './errors.js';
import type { AtomicUnit, CommitOptions, CommitReceipt } from './atomic.js';
import { isProfileId, type ProfileId } from './profiles.js';
import type { MemoryBackend } from './backend.js';
import {
  appendChainToScope,
  commitAtomicToScope,
  disposeChainInScope,
  genesisToScope,
  readPageFromScope,
  type ChainRecordInput,
  type ReadPageResult,
} from './record-runtime.js';
import type { ChainBoundaryProvider } from './tokens.js';
import type { StorageScope } from './contracts.js';

export interface OrdinaryProfileClaim {
  readonly profile: ProfileId;
  readonly version: string;
  readonly digest: string;
}

export const ORDINARY_PROFILES: readonly OrdinaryProfileClaim[] = [
  { profile: 'atomic-units-v1', version: '1', digest: 'k3-ordinary-v1' },
  { profile: 'immutable-chains-v1', version: '1', digest: 'k3-ordinary-v1' },
  { profile: 'immutable-boundaries-v1', version: '1', digest: 'k3-ordinary-v1' },
];

const deepCopyGrant = (grant: ScopeGrant<unknown>): ScopeGrant<unknown> =>
  JSON.parse(JSON.stringify(grant)) as ScopeGrant<unknown>;

const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) deepFreeze(entry);
  Object.freeze(value);
};

interface TxOverlay {
  readonly units: AtomicUnit[];
  readonly heads: Map<string, string | null>;
  readonly created: Set<string>;
  rollbackOnly: boolean;
  savedError: unknown;
  closed: boolean;
}

export interface KernelTransaction {
  apply(unit: AtomicUnit): Promise<void>;
  readHead(chainId: string): Promise<string | null>;
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
}

export class ScopedRuntime {
  readonly grant: ScopeGrant<unknown>;
  private readonly boundScope: StorageScope;
  private activeTx: { readonly tx: KernelTransaction; readonly overlay: TxOverlay } | null = null;

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

  get profiles(): readonly OrdinaryProfileClaim[] {
    return ORDINARY_PROFILES;
  }

  capability(profile: ProfileId): object {
    if (!isProfileId(profile) || !ORDINARY_PROFILES.some((entry) => entry.profile === profile)) {
      throw new UnsupportedProfileError(String(profile));
    }
    return {};
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
    return this.deps.backend.scopeState(this.boundScope).index.get(key) ?? null;
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
    return this.deps.backend.scopeState(this.boundScope).chains.get(chainId)?.head ?? null;
  }

  async readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> {
    this.requireOperation('read');
    return this.deps.backend.scopeState(this.boundScope).records.get(key) ?? null;
  }

  async readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> {
    this.requireOperation('read');
    return this.deps.backend.scopeState(this.boundScope).aggregates.get(key) ?? null;
  }

  async readChain(chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]> {
    this.requireOperation('read');
    return this.deps.backend.scopeState(this.boundScope).chains.get(chainId)?.records ?? [];
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
    });
  }

  async transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>): Promise<{ readonly value: T; readonly receipt: CommitReceipt }> {
    this.requireOperation('write');
    if (this.activeTx) {
      return { value: await operation(this.activeTx.tx), receipt: this.emptyReceipt() };
    }
    const overlay: TxOverlay = { units: [], heads: new Map(), created: new Set(), rollbackOnly: false, savedError: null, closed: false };
    const tx = this.makeTx(overlay);
    this.activeTx = { tx, overlay };
    try {
      const value = await operation(tx).catch((error) => {
        overlay.rollbackOnly = true;
        overlay.savedError = error;
        throw error;
      });
      if (overlay.rollbackOnly) throw overlay.savedError;
      this.requireOperation('write');
      const merged = this.mergeUnits(overlay.units);
      if (merged === null) return { value, receipt: this.emptyReceipt() };
      const receipt = commitAtomicToScope(this.deps.backend.scopeState(this.boundScope), merged, options, {
        moduleId: this.moduleId,
        scope: this.boundScope,
        clock: this.deps.clock,
        commitId: this.deps.nextCommitId(),
      });
      return { value, receipt };
    } finally {
      overlay.closed = true;
      this.activeTx = null;
    }
  }

  private emptyReceipt(): CommitReceipt {
    const commitId = this.deps.nextCommitId();
    return { commitId, moduleId: this.moduleId, scope: { ...this.boundScope }, committedAt: this.deps.clock(), effectiveRecords: 0, effectiveAppends: 0, journalCursor: `cursor-${commitId}` };
  }

  private mergeUnits(units: readonly AtomicUnit[]): AtomicUnit | null {
    if (units.length === 0) return null;
    return {
      guards: units.flatMap((unit) => unit.guards),
      records: units.flatMap((unit) => unit.records),
      appends: units.flatMap((unit) => unit.appends),
      updates: units.flatMap((unit) => unit.updates),
      relationships: units.flatMap((unit) => unit.relationships),
      barriers: units.flatMap((unit) => unit.barriers),
      purgeIntents: units.flatMap((unit) => unit.purgeIntents),
      indexWrites: units.flatMap((unit) => unit.indexWrites),
      ...(units.some((unit) => unit.moduleResult) ? { moduleResult: units.find((unit) => unit.moduleResult)?.moduleResult } : {}),
    };
  }

  private makeTx(overlay: TxOverlay): KernelTransaction {
    const backendState = () => this.deps.backend.scopeState(this.boundScope);
    const effectiveHead = (chainId: string): string | null => {
      if (overlay.heads.has(chainId)) return overlay.heads.get(chainId) ?? null;
      return backendState().chains.get(chainId)?.head ?? null;
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
            if (guard.kind === 'aggregate-version' && backendState().aggregates.get(guard.key)?.version !== guard.version) {
              throw new StorageCasConflictError('guard aggregate version mismatch');
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
        overlay.units.push(unit);
        for (const append of unit.appends) {
          if (append.expectation.kind === 'absent') overlay.created.add(append.chainId);
          overlay.heads.set(append.chainId, append.record.hash);
        }
      },
      readHead: async (chainId: string): Promise<string | null> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        return effectiveHead(chainId);
      },
    };
  }
}
