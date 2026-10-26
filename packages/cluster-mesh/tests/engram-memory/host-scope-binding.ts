import type {
  CanonicalMemoryStorePort, CryptoPort, ModuleStorageMemoryStoreOptionsV1,
} from '@sentropic/engram/memory-substrate';

export interface HostInvocation {
  readonly invocationId: string;
  readonly storeId: string;
  readonly scopeRef: string;
}

export interface HostScopeOptions {
  readonly store: CanonicalMemoryStorePort;
  readonly crypto: CryptoPort;
  readonly binding: ModuleStorageMemoryStoreOptionsV1['scope_binding'];
  readonly currentInvocation: () => HostInvocation | null;
}

// Baseline for the tests-first C7 probe: no liaison is installed yet.
export const bindHostCandidateScope = (options: HostScopeOptions) => ({
  store: options.store,
  crypto: options.crypto,
});
