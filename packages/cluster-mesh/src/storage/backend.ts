// K3 neutral in-memory backend state (L3a v4.1 frozen §5, §17.1 K3).
// Data-only: plain maps scoped by module/tenant/workspace. No pg, no
// drizzle, no engram imports. Semantics live in record-runtime.ts; binding
// lives in scope-runtime.ts. Public types documented for S1/P1 adapters.

import type { CommitReceipt } from './atomic.js';
import { IndexedMap, forkIndexedMap } from './indexed-map.js';
import type { IndexedHistory } from './indexed-history.js';
import { StorageInvalidCommandError } from './errors.js';
import type { StorageScope } from './contracts.js';

export interface BackendChainRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface BackendChainState {
  allocation: string;
  head: string | null;
  /** Memory representation only: dense append order, records.at(i).seq === i.
   * Restoring adapters must preserve positions, including retained disposed bytes.
   * This is unrelated to DAG topological order or another backend's layout. */
  records: BackendChainRecord[] | IndexedHistory<BackendChainRecord>;
  disposed: boolean;
}

export interface BackendGenesisState {
  readonly hash: string;
  readonly value: unknown;
}

export interface BackendIndexEntry {
  readonly digest: string;
  readonly resultIds: readonly string[];
  readonly resultHash: string | null;
}

export interface BackendAtomicRecord {
  readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string };
  readonly contentHash: string;
}

export interface BackendAggregate {
  readonly version: number;
  readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string };
}

export interface BackendIdempotencyEntry {
  readonly receipt: CommitReceipt;
  readonly unitHash: string;
}

export interface BackendScopeState {
  chains: Map<string, BackendChainState>;
  genesis: Map<string, BackendGenesisState>;
  index: Map<string, BackendIndexEntry>;
  records: Map<string, BackendAtomicRecord>;
  aggregates: Map<string, BackendAggregate>;
  commits: Map<string, BackendIdempotencyEntry>;
  readonly indexed?: boolean;
  readonly version?: string;
  readonly attachment?: unknown;
}

export const backendScopeKey = (scope: { readonly tenantId: string; readonly workspaceId: string }): string =>
  JSON.stringify(['scope', scope.tenantId, scope.workspaceId]);

export const createBackendScopeState = (): BackendScopeState => ({
  chains: new Map(),
  genesis: new Map(),
  index: new Map(),
  records: new Map(),
  aggregates: new Map(),
  commits: new Map(),
});

export const createIndexedBackendScopeState = (): BackendScopeState => ({
  chains: new IndexedMap(), genesis: new IndexedMap(), index: new IndexedMap(),
  records: new IndexedMap(), aggregates: new IndexedMap(), commits: new IndexedMap(),
  indexed: true, version: '0',
});

export const forkBackendScope = (base: BackendScopeState): BackendScopeState => ({
  ...base, chains: forkIndexedMap(base.chains), genesis: forkIndexedMap(base.genesis),
  index: forkIndexedMap(base.index), records: forkIndexedMap(base.records),
  aggregates: forkIndexedMap(base.aggregates), commits: forkIndexedMap(base.commits),
});

export const lockBackendScope = (state: BackendScopeState): BackendScopeState => {
  for (const map of [state.chains, state.genesis, state.index, state.records, state.aggregates, state.commits]) {
    if (map instanceof IndexedMap) map.lock();
  }
  return Object.freeze(state);
};

const validateBackendSequences = (state: BackendScopeState): void => {
  for (const chain of state.chains.values()) {
    for (let index = 0; index < chain.records.length; index++) {
      if (chain.records.at(index)?.seq !== index) {
        throw new StorageInvalidCommandError('memory records require a dense zero-based sequence');
      }
    }
  }
};

/** Neutral per-kernel store: one map of scopes, no durability claim. */
export class MemoryBackend {
  readonly scopes = new Map<string, BackendScopeState>();
  private identity: { readonly moduleId: string; readonly incarnation: string } | null = null;
  private readonly controls = new Map<string, unknown>();

  constructor(private readonly createScope: () => BackendScopeState = createBackendScopeState) {}

  bindIdentity(moduleId: string, incarnation: string | undefined, create: () => string): string {
    // Validate restored state at composition, never during bounded publication.
    for (const state of this.scopes.values()) validateBackendSequences(state);
    if (this.identity && (this.identity.moduleId !== moduleId || (incarnation !== undefined && incarnation !== this.identity.incarnation))) {
      throw new StorageInvalidCommandError('backend already belongs to another module or incarnation');
    }
    if (!this.identity) this.identity = { moduleId, incarnation: incarnation ?? create() };
    return this.identity.incarnation;
  }

  controlState<T>(scope: StorageScope, namespace: string, create: () => T): T {
    if (!this.identity) throw new StorageInvalidCommandError('backend identity is not bound');
    const key = JSON.stringify([this.identity.moduleId, this.identity.incarnation, namespace, scope.tenantId, scope.workspaceId]);
    if (!this.controls.has(key)) this.controls.set(key, create());
    return this.controls.get(key) as T;
  }

  scopeState(scope: { readonly tenantId: string; readonly workspaceId: string }): BackendScopeState {
    const key = backendScopeKey(scope);
    const existing = this.scopes.get(key);
    if (existing) return existing;
    const created = this.createScope();
    validateBackendSequences(created);
    this.scopes.set(key, created);
    return created;
  }
}

export const incrementBackendAllocation = (allocation: string): string => {
  const parsed = Number(allocation);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid allocation: ${allocation}`);
  return String(parsed + 1);
};

// The backend addresses every handle of every kernel in this realm:
// freezing the shared prototype closes the cross-module channel (O1, same
// realm limit as Sol-1), so replacing scopeState throws instead of
// redirecting all handles to another tenant.
Object.freeze(MemoryBackend.prototype);
