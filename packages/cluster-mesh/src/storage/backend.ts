// K3 neutral in-memory backend state (L3a v4.1 frozen §5, §17.1 K3).
// Data-only: plain maps scoped by module/tenant/workspace. No pg, no
// drizzle, no engram imports. Semantics live in record-runtime.ts; binding
// lives in scope-runtime.ts. Public types documented for S1/P1 adapters.

import type { CommitReceipt } from './atomic.js';

export interface BackendChainRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface BackendChainState {
  allocation: string;
  head: string | null;
  records: BackendChainRecord[];
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
  readonly chains: Map<string, BackendChainState>;
  readonly genesis: Map<string, BackendGenesisState>;
  readonly index: Map<string, BackendIndexEntry>;
  readonly records: Map<string, BackendAtomicRecord>;
  readonly aggregates: Map<string, BackendAggregate>;
  readonly commits: Map<string, BackendIdempotencyEntry>;
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

/** Neutral per-kernel store: one map of scopes, no durability claim. */
export class MemoryBackend {
  readonly scopes = new Map<string, BackendScopeState>();

  scopeState(scope: { readonly tenantId: string; readonly workspaceId: string }): BackendScopeState {
    const key = backendScopeKey(scope);
    const existing = this.scopes.get(key);
    if (existing) return existing;
    const created = createBackendScopeState();
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
