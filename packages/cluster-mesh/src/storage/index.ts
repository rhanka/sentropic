// K3 neutral kernel public surface (L3a v4.1 frozen §17.1 K3).
// Entry point for the engram adapter: factory, scope runtime, tokens,
// backend state and ordinary record machinery. Neutral: no pg, no
// drizzle, no engram imports.

export { createKernel, createStaticAuthorityPort, type KernelHandle, type KernelOptions, type KernelRoot, type ScopeAuthorityPort } from './kernel.js';
export { ScopedRuntime, ORDINARY_PROFILES, type KernelTransaction, type ScopedRuntimeDeps } from './scope-runtime.js';
export { HmacExactHeadBoundaryProvider, createOpaqueIssuer, type ChainBoundaryProvider, type ChainBoundaryRecord, type ChainCursor } from './tokens.js';
export { MemoryBackend, backendScopeKey, createBackendScopeState, incrementBackendAllocation } from './backend.js';
export type { BackendAggregate, BackendAtomicRecord, BackendChainRecord, BackendChainState, BackendGenesisState, BackendIdempotencyEntry, BackendIndexEntry, BackendScopeState } from './backend.js';
export { appendChainToScope, commitAtomicToScope, commitUnitsToScope, disposeChainInScope, genesisToScope, mergeAtomicUnits, readPageFromScope } from './record-runtime.js';
export type { ChainRecordInput, CommitContext, PredicateEvaluator, ReadPageResult } from './record-runtime.js';
