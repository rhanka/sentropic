// K3 neutral kernel public surface (L3a v4.1 frozen §17.1 K3).
// Entry point for the engram adapter: factory, scope runtime, tokens,
// backend state and ordinary record machinery. Neutral: no pg, no
// drizzle, no engram imports.

export { createKernel, createStaticAuthorityPort, type KernelHandle, type KernelOptions, type KernelRoot, type ScopeAuthorityPort } from './kernel.js';
// The adapter surface exposes binding results by type only (R-MAJ-5): the
// ScopedRuntime constructor and ScopedRuntimeDeps stay internal to the
// package, so adapter code cannot mint handles or reach issuance state.
export { ORDINARY_PROFILES, type ChainReadRequest, type KernelTransaction, type RecordPage, type RecordRead, type ScopedRuntime } from './scope-runtime.js';
export { HmacExactHeadBoundaryProvider, createOpaqueIssuer, isUnknownCursorBoundary, type ChainBoundaryProvider, type ChainBoundaryRecord, type ChainCursor, type CursorVerification, type UnknownCursorBoundary } from './tokens.js';
export { MemoryBackend, backendScopeKey, createBackendScopeState, incrementBackendAllocation } from './backend.js';
export type { BackendAggregate, BackendAtomicRecord, BackendChainRecord, BackendChainState, BackendGenesisState, BackendIdempotencyEntry, BackendIndexEntry, BackendScopeState } from './backend.js';
export { appendChainToScope, commitAtomicToScope, commitUnitsToScope, disposeChainInScope, genesisToScope, mergeAtomicUnits, readPageFromScope } from './record-runtime.js';
export type { ChainRecordInput, CommitContext, PredicateContext, PredicateEvaluator, PredicateView, ReadPageResult } from './record-runtime.js';
export { createRootStagedKernel as createStagedKernel, type StagedKernelHandle, type StagedKernelOptions, type StagedKernelRoot } from './staged-factory.js';
export type { RootScopedRuntime as StagedScopedRuntime } from './root-facade.js';
export { STAGED_PROFILES } from './root-profiles.js';
export type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from './staged-state.js';
export type { RootSealStepInput, RootSealOutcome } from './staged-seal.js';
export type { JournalFence } from './staged-core.js';
export type { RootQueryView, RootQueryContext, RootQueryPage, RootQueryRequest, RegisteredRootQuery } from './root-query.js';
