// Durable SQLite state backend (lot 1).
// A MemoryBackend whose scope snapshots persist in node:sqlite. One
// SQLite transaction carries each persist: ownership is re-verified
// inside that transaction before COMMIT, so a superseded instance rolls
// back instead of deciding. Lot 1 persists committed ordinary state
// (records, chains, index, aggregates, genesis, idempotency commits);
// staged attachment, journal lanes, consumers and grant issuance stay
// session-local and are documented in index.ts.

import { BackendScopeState, MemoryBackend, backendScopeKey, createIndexedBackendScopeState } from '../backend.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { StorageScope } from '../contracts.js';
import { IndexedHistory } from '../indexed-history.js';
import { IndexedMap } from '../indexed-map.js';
import { CanonicalOwnershipError } from '../instance-ownership.js';
import type { SqliteEngine } from './engine.js';

export const SQLITE_SCOPE_SNAPSHOT_VERSION = '1';

interface ChainSnapshot {
  readonly allocation: string;
  readonly head: string | null;
  readonly disposed: boolean;
  readonly records: readonly { id: string; seq: number; hash: string; bytes: string }[];
}

interface ScopeSnapshot {
  readonly version: string;
  readonly chains: readonly (readonly [string, ChainSnapshot])[];
  readonly genesis: readonly (readonly [string, unknown])[];
  readonly index: readonly (readonly [string, unknown])[];
  readonly records: readonly (readonly [string, unknown])[];
  readonly aggregates: readonly (readonly [string, unknown])[];
  readonly commits: readonly (readonly [string, unknown])[];
}

export const encodeScopeState = (state: BackendScopeState): string => {
  const snapshot: ScopeSnapshot = {
    version: SQLITE_SCOPE_SNAPSHOT_VERSION,
    chains: [...state.chains].map(([key, chain]) => [
      key,
      { allocation: chain.allocation, head: chain.head, disposed: chain.disposed, records: [...chain.records] },
    ]),
    genesis: [...state.genesis],
    index: [...state.index],
    records: [...state.records],
    aggregates: [...state.aggregates],
    commits: [...state.commits],
  };
  return JSON.stringify(snapshot);
};

export const decodeScopeState = (json: string): BackendScopeState => {
  let snapshot: ScopeSnapshot;
  try {
    snapshot = JSON.parse(json) as ScopeSnapshot;
  } catch {
    throw new CanonicalOwnershipError('open-refused', 'SQLite scope snapshot is not valid JSON');
  }
  if (snapshot?.version !== SQLITE_SCOPE_SNAPSHOT_VERSION || !Array.isArray(snapshot.chains)) {
    throw new CanonicalOwnershipError('open-refused', 'SQLite scope snapshot has an unknown version');
  }
  const state = createIndexedBackendScopeState();
  for (const [key, chain] of snapshot.chains) {
    const history = new IndexedHistory<{ id: string; seq: number; hash: string; bytes: string }>();
    history.push(...chain.records);
    state.chains.set(key, { allocation: chain.allocation, head: chain.head, disposed: chain.disposed, records: history });
  }
  const restore = (target: IndexedMap<never>, entries: readonly (readonly [string, unknown])[]): void => {
    for (const [key, value] of entries) target.set(key, value as never);
  };
  restore(state.genesis as IndexedMap<never>, snapshot.genesis);
  restore(state.index as IndexedMap<never>, snapshot.index);
  restore(state.records as IndexedMap<never>, snapshot.records);
  restore(state.aggregates as IndexedMap<never>, snapshot.aggregates);
  restore(state.commits as IndexedMap<never>, snapshot.commits);
  return state;
};

export class SqliteStateBackend extends MemoryBackend {
  private readonly knownScopes = new Map<string, StorageScope>();
  private admitted = false;
  private readonly transactions = new AsyncLocalStorage<{ key: string; active: boolean }>();

  joinsTransaction(scope: StorageScope): boolean {
    const context = this.transactions.getStore();
    return context?.active === true && context.key === backendScopeKey(scope);
  }

  async withTransaction<T>(scope: StorageScope, operation: () => Promise<T>): Promise<T> {
    const context = { key: backendScopeKey(scope), active: true };
    return this.transactions.run(context, async () => {
      try { return await operation(); }
      finally { context.active = false; }
    });
  }

  assertIdle(): void {
    if (this.admitted) throw new CanonicalOwnershipError('instance-busy', 'SQLite operation is still active');
  }

  admit(): () => void {
    this.assertIdle();
    this.admitted = true;
    return () => { this.admitted = false; };
  }

  constructor(private readonly engine: SqliteEngine) {
    super(createIndexedBackendScopeState);
    engine.db.exec('CREATE TABLE IF NOT EXISTS cm_scopes(key TEXT PRIMARY KEY, state TEXT NOT NULL)');
  }

  override scopeState(scope: { readonly tenantId: string; readonly workspaceId: string }): BackendScopeState {
    const key = backendScopeKey(scope);
    const live = this.scopes.get(key);
    if (live) return live;
    this.knownScopes.set(key, { tenantId: scope.tenantId, workspaceId: scope.workspaceId });
    const row = this.engine.db.prepare('SELECT state FROM cm_scopes WHERE key = ?').get(key) as
      | { state: string }
      | undefined;
    const state = row === undefined ? createIndexedBackendScopeState() : decodeScopeState(row.state);
    this.scopes.set(key, state);
    return state;
  }

  /** Pre-mutation snapshot for atomic rollback: a rejected persist must
   * not leave the in-memory root, receipts or related state published.
   * Null when the scope has no loaded state yet. */
  snapshotScope(scope: StorageScope): string | null {
    const state = this.scopes.get(backendScopeKey(scope));
    if (!state) return null;
    return encodeScopeState(state);
  }

  restoreScope(scope: StorageScope, snapshot: string | null): void {
    const key = backendScopeKey(scope);
    if (snapshot === null) {
      this.scopes.delete(key);
      this.knownScopes.delete(key);
      return;
    }
    const live = this.scopes.get(key);
    const restored = decodeScopeState(snapshot);
    if (live?.attachment !== undefined) Object.assign(restored, { attachment: live.attachment });
    this.scopes.set(key, restored);
  }

  flushScope(scope: StorageScope): void {
    const key = backendScopeKey(scope);
    const state = this.scopes.get(key);
    if (!state) return;
    const snapshot = encodeScopeState(state);
    const db = this.engine.db;
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (!/busy|locked/i.test((error as Error)?.message ?? '')) throw error;
      throw new CanonicalOwnershipError('instance-busy', `SQLite persist could not start: ${(error as Error).message}`);
    }
    try {
      this.engine.assertOwnership();
      db.prepare('INSERT INTO cm_scopes(key, state) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state').run(
        key,
        snapshot,
      );
      this.engine.assertOwnership();
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
  }

  flushAll(): void {
    for (const scope of this.knownScopes.values()) this.flushScope(scope);
  }
}
