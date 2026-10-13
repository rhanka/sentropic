// Test-only reference state for the K2a shared corpus (L3a v4.1 frozen,
// §16.1, §17.1). No durability claim: plain in-memory maps scoped by
// module/tenant/workspace.

import type { CommitReceipt } from '../../src/storage/atomic.js';

export interface TestRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface TestChainState {
  allocation: string;
  head: string | null;
  records: TestRecord[];
  disposed: boolean;
}

export interface TestGenesisState {
  readonly hash: string;
  readonly value: unknown;
}

export interface TestIndexEntry {
  readonly digest: string;
  readonly resultIds: readonly string[];
  readonly resultHash: string | null;
}

export interface TestAtomicRecord {
  readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string };
  readonly contentHash: string;
}

export interface TestAggregate {
  readonly version: number;
  readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string };
}

export interface TestIdempotencyEntry {
  readonly receipt: CommitReceipt;
  readonly unitHash: string;
}

export interface TestScopeState {
  readonly chains: Map<string, TestChainState>;
  readonly genesis: Map<string, TestGenesisState>;
  readonly index: Map<string, TestIndexEntry>;
  readonly records: Map<string, TestAtomicRecord>;
  readonly aggregates: Map<string, TestAggregate>;
  readonly receipts: Map<string, unknown>;
  readonly commits: Map<string, TestIdempotencyEntry>;
}

export interface ReferenceState {
  readonly scopes: Map<string, TestScopeState>;
}

export const createReferenceState = (): ReferenceState => ({ scopes: new Map() });

export const scopeKey = (scope: { readonly tenantId: string; readonly workspaceId: string }): string =>
  JSON.stringify(['scope', scope.tenantId, scope.workspaceId]);

export const getScopeState = (state: ReferenceState, scope: { readonly tenantId: string; readonly workspaceId: string }): TestScopeState => {
  const key = scopeKey(scope);
  const existing = state.scopes.get(key);
  if (existing) return existing;
  const created: TestScopeState = {
    chains: new Map(),
    genesis: new Map(),
    index: new Map(),
    records: new Map(),
    aggregates: new Map(),
    receipts: new Map(),
    commits: new Map(),
  };
  state.scopes.set(key, created);
  return created;
};

export const incrementAllocation = (allocation: string): string => {
  const parsed = Number(allocation);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid allocation: ${allocation}`);
  return String(parsed + 1);
};
