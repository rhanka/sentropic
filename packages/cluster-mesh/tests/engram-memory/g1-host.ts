// G1 host composition: binds the cluster-mesh neutral contract and the
// explicitly injected host SQLite driver to Engram's memory-substrate
// provisional constructor. Engram receives the neutral binding only: no
// driver, no raw connection, no cluster-mesh import crosses into Engram.
// Durable profiles stay S-gated: the host handle refuses every I/O entry
// with a typed StorageUnavailableError instead of selecting a fallback.

import {
  openModuleStorageCanonicalMemoryStoreV1,
  type ModuleStorageMemoryStoreOptionsV1,
} from '@sentropic/engram/memory-substrate';
import { MEMORY_DESCRIPTOR, MEMORY_PINNED_PROFILES } from '../../src/engram-memory/manifest.js';
import {
  checkMemorySqliteDriver,
  MemoryHostDriverRequiredError,
  type MemorySqliteDriverProvider,
} from '../../src/engram-memory/sqlite.js';
import { StorageUnavailableError } from '../../src/storage/errors.js';

export const G1_TENANT_ID = 'g1-qualification-tenant';
export const G1_WORKSPACE_ID = 'g1-qualification-workspace';
export const G1_STORE_ID = 'g1-qualification-canonical-store-01';
export const G1_INVOCATION_ID = 'g1-qualification-invocation-01';
export const G1_GRANT_TOKEN = 'g1-qualification-grant-token';

const sGated = (operation: string): never => {
  throw new StorageUnavailableError(
    `memory SQLite composition requires the G1d provider seam and qualified durable profiles (${operation})`,
  );
};

export interface G1HostComposition {
  readonly options: ModuleStorageMemoryStoreOptionsV1;
  readonly driver: MemorySqliteDriverProvider;
}

/** Host clock: the single time source sampled for receipts and deadlines. */
export const g1Clock = (): { now: () => string } => ({
  now: () => new Date().toISOString(),
});

export const g1Deadline = (fromNowMs = 3_600_000): string => new Date(Date.now() + fromNowMs).toISOString();

export const g1ScopeBinding = (): ModuleStorageMemoryStoreOptionsV1['scope_binding'] => {
  const scope = { tenantId: G1_TENANT_ID, workspaceId: G1_WORKSPACE_ID };
  return {
    scope,
    store_id: G1_STORE_ID,
    resolveScope: (scopeRef: unknown) => (scopeRef === G1_STORE_ID ? { ...scope } : null),
  };
};

export const g1Grant = (): ModuleStorageMemoryStoreOptionsV1['grant'] => ({
  token: G1_GRANT_TOKEN,
  moduleId: 'engram-memory',
  scope: { tenantId: G1_TENANT_ID, workspaceId: G1_WORKSPACE_ID },
  principalId: 'g1-qualification-principal',
  operations: ['read', 'write'],
  issuer: 'g1-qualification-host',
  authorityRevision: '1',
  policyRevision: '1',
  lifetime: { kind: 'invocation', invocationId: G1_INVOCATION_ID },
});

/**
 * S-gated neutral handle: carries the cluster-mesh descriptor, backend and
 * pinned profile claims, and refuses every storage entry with a typed
 * StorageUnavailableError. Structural match only: cluster-mesh never
 * imports Engram outside qualification, and Engram never sees the driver.
 */
export const g1HostHandle = (): ModuleStorageMemoryStoreOptionsV1['handle'] => ({
  moduleId: 'engram-memory',
  descriptor: MEMORY_DESCRIPTOR,
  backend: 'sqlite',
  profiles: [...MEMORY_PINNED_PROFILES],
  transact: async () => sGated('transact'),
  query: async () => sGated('query'),
  readAggregate: async () => sGated('readAggregate'),
  acquireFence: async () => sGated('acquireFence'),
  checkFence: async () => sGated('checkFence'),
  releaseFence: async () => sGated('releaseFence'),
});

/**
 * Compose the G1 store request: validate the explicit host driver first
 * (typed refusal, no fallback), then hand the neutral binding to the
 * installed Engram substrate. Returns the substrate Result unchanged.
 */
export const openG1MemoryStore = async (
  driver: unknown,
  overrides: Partial<ModuleStorageMemoryStoreOptionsV1> = {},
): Promise<{ ok: boolean; value?: unknown; error?: { code?: unknown; operation?: unknown; message?: unknown; retryable?: unknown } }> => {
  const provider = checkMemorySqliteDriver(driver);
  void provider;
  const options: ModuleStorageMemoryStoreOptionsV1 = {
    handle: g1HostHandle(),
    scope_binding: g1ScopeBinding(),
    grant: g1Grant(),
    clock: g1Clock(),
    deadline_at: g1Deadline(),
    ...overrides,
  };
  return openModuleStorageCanonicalMemoryStoreV1(options) as Promise<{
    ok: boolean;
    value?: unknown;
    error?: { code?: unknown; operation?: unknown; message?: unknown; retryable?: unknown };
  }>;
};

export { MemoryHostDriverRequiredError };
export type { MemorySqliteDriverProvider };
