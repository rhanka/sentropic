// K4 composition of K3 ordinary transactions with indexed staged roots.
export { createRootStagedKernel as createStagedKernel, type StagedKernelRoot, type StagedKernelHandle, type StagedKernelOptions } from './staged-factory.js';
export type { RootScopedRuntime as StagedScopedRuntime } from './root-facade.js';
export type { AuthenticatedStagedHandle as StagedHandle, AuthenticatedStagedSeal, PurgePolicy, RootJournalEvent as StagedJournalEvent } from './staged-state.js';
export type { RootSealStepInput as StagedSealStepInput, RootSealOutcome } from './staged-seal.js';
export type { JournalFence } from './staged-core.js';
export { STAGED_PROFILES } from './root-profiles.js';
