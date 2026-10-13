// K3 neutral kernel public surface (L3a v4.1 frozen §17.1 K3).
// Entry point for the engram adapter: factory, scope runtime, tokens,
// backend state and ordinary record machinery. Neutral: no pg, no
// drizzle, no engram imports.

export { createKernel, type KernelHandle, type KernelOptions } from './kernel.js';
export { ScopedRuntime, ORDINARY_PROFILES, type KernelTransaction, type OrdinaryProfileClaim, type ScopedRuntimeDeps } from './scope-runtime.js';
export { RetainedExactHeadBoundaryProvider, createOpaqueIssuer, type ChainBoundaryProvider, type ChainBoundaryRecord, type ChainCursor } from './tokens.js';
export { MemoryBackend, backendScopeKey, createBackendScopeState, incrementBackendAllocation } from './backend.js';
export type { BackendAggregate, BackendAtomicRecord, BackendChainRecord, BackendChainState, BackendGenesisState, BackendIdempotencyEntry, BackendIndexEntry, BackendScopeState } from './backend.js';
export { appendChainToScope, commitAtomicToScope, disposeChainInScope, genesisToScope, readPageFromScope } from './record-runtime.js';
export type { ChainRecordInput, ReadPageResult } from './record-runtime.js';
