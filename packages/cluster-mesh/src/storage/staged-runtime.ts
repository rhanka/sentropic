export { createRootStagedKernel as createStagedKernel, type StagedKernelRoot } from './staged-factory.js';
export type { RootScopedRuntime as StagedScopedRuntime } from './root-facade.js';
// K4 staged-unit runtime (L3a v4.1 frozen §7, §10, §13, §17.1 K4). Neutral
// staged coherent units over the K3 kernel: hidden staging, bounded seal
// validation, single-point publication with visibility-root versions,
// journal segments, coverage/barrier denial (G1), purge jobs, shared blobs,
// relationship positives and projection deltas. G5: a unit may publish
// covered content together with its own barrier, so an imported tombstoned
// payload is never ordinarily readable between publication and barrier
// application. Ordinary multi-operation transactions stay on the K3 handle,
// keeping every mutation under the same root/version discipline. No pg, no
// drizzle, no engram imports. Public types documented for S2a/P2u adapters.

import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from './errors.js';
import {
  validateAtomicUnit,
  validateCommitOptions,
  type AtomicUnit,
  type CommitOptions,
  type CommitReceipt,
} from './atomic.js';
import { type ScopeGrant } from './authority.js';
import { backendScopeKey } from './backend.js';
import {
  validateWorkLimits,
  validateWriterFence,
  type StorageScope,
  type WorkLimits,
  type WriterFence,
} from './contracts.js';
import { isProfileId, type ProfileId } from './profiles.js';
import { createKernel, type KernelRoot } from './kernel.js';
import { ORDINARY_PROFILES, type ScopedRuntime } from './scope-runtime.js';
import {
  validateBeginInput,
  validateCommitRoot,
  validateFragmentInput,
  validateFragmentSequence,
  type FragmentReceipt,
  type StagedCommitRoot,
  type StagedUnitSeal,
  type StagedUnitStatus,
} from './staged-units.js';
import { ScopeVisibilityRoot, type VisibilityBase } from './visibility-root.js';
import { StagedSealValidation, type SealValidationOutcome } from './stage-validation.js';
import { ProjectionRuntime } from './projection-runtime.js';
import type { ChainRecordInput, ReadPageResult } from './record-runtime.js';

export const STAGED_PROFILES: readonly K4ProfileClaim[] = [
  ...ORDINARY_PROFILES,
  { profile: 'scope-outbox-v1', version: '1', digest: 'k4-staged-v1' },
  { profile: 'visibility-barriers-v1', version: '1', digest: 'k4-staged-v1' },
  { profile: 'staged-units-v1', version: '1', digest: 'k4-staged-v1' },
  { profile: 'purge-jobs-v1', version: '1', digest: 'k4-staged-v1' },
  { profile: 'fenced-writers-v1', version: '1', digest: 'k4-staged-v1' },
];

const createK4ScopeState = (scope: StorageScope): K4ScopeState => ({
  scope: { ...scope },
  root: new ScopeVisibilityRoot(),
  units: new Map(),
  journal: [],
  consumers: new Map(),
  barriers: new Map(),
  coverage: new Map(),
  jobs: new Map(),
  holds: new Map(),
  blobs: new Map(),
  commits: new Map(),
  knownChains: new Set(),
  disposed: new Set(),
  projections: new ProjectionRuntime(),
  journalSeq: 0,
  unitSeq: 0,
  policy: 'optional',
});

export interface StagedSealStepInput {
  readonly unit: StagedHandle;
  readonly root: StagedCommitRoot;
  readonly limits: WorkLimits;
  readonly fence: WriterFence;
}
