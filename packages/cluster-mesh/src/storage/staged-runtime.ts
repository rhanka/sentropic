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

export type PurgePolicy = 'unconfigured' | 'optional' | 'required';

export interface StagedHandle {
  readonly unitId: string;
  readonly operationKey: string;
}

export interface StagedJournalSegment {
  readonly operationKey: string;
  readonly from: number;
  readonly to: number;
}

export interface StagedJournalEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly scope: StorageScope;
  readonly commitId: string;
  readonly rootVersion: string;
  readonly operationKey?: string;
  readonly segment?: StagedJournalSegment;
}

export interface JournalReadResult {
  readonly events: readonly StagedJournalEvent[];
  readonly watermark: number;
}

export interface ConsumerView {
  readonly cursor: number;
  readonly status: 'running' | 'stalled';
  readonly failedEvent: string | null;
  readonly failedReason: string | null;
  readonly lag: number;
}

export interface PurgeJobView {
  readonly state: 'pending' | 'held' | 'complete' | 'failed';
  readonly outcomeId: string | null;
}

export interface StagedKernelOptions {
  /** Owning module id (for example 'comments'). */
  readonly moduleId: string;
  /** Stable store incarnation bound into every cursor. Defaults to 'store-1'. */
  readonly incarnation?: string;
  /** Clock for receipts and barrier timestamps. Defaults to live time. */
  readonly now?: () => string;
}

interface ConsumerRecord {
  cursor: number;
  status: 'running' | 'stalled';
  failedEvent: string | null;
  failedReason: string | null;
  failedSeq: number | null;
}

interface PurgeJob {
  readonly intentId: string;
  readonly target: string;
  readonly authorizedBy: string;
  state: 'pending' | 'held' | 'complete' | 'failed';
  outcomeId: string | null;
}

interface StagedFragment {
  readonly ordinal: string;
  readonly predecessorHash: string | null;
  readonly fragmentDigest: string;
  readonly effects: AtomicUnit;
}

interface StagedUnitRecord {
  readonly unitId: string;
  readonly operationKey: string;
  readonly fragments: StagedFragment[];
  state: 'staging' | 'sealing' | 'sealed' | 'committed' | 'aborted';
  validation: StagedSealValidation | null;
  validationRoot: StagedCommitRoot | null;
  seal: StagedUnitSeal | null;
  base: VisibilityBase | null;
  receipt: CommitReceipt | null;
  abortReason?: string;
}

interface K4ScopeState {
  readonly scope: StorageScope;
  readonly root: ScopeVisibilityRoot;
  readonly units: Map<string, StagedUnitRecord>;
  readonly journal: StagedJournalEvent[];
  readonly consumers: Map<string, ConsumerRecord>;
  readonly barriers: Map<string, { readonly reason: string; readonly createdAt: string }>;
  readonly coverage: Map<string, string>;
  readonly jobs: Map<string, PurgeJob>;
  readonly holds: Map<string, string>;
  readonly blobs: Map<string, { owners: Set<string>; bytes: string | null }>;
  readonly commits: Map<string, { readonly receipt: CommitReceipt; readonly unitHash: string }>;
  readonly knownChains: Set<string>;
  readonly disposed: Set<string>;
  readonly projections: ProjectionRuntime;
  journalSeq: number;
  unitSeq: number;
  policy: PurgePolicy;
}

interface ExternalLog {
  readonly events: StagedJournalEvent[];
  seq: number;
}

export interface K4ProfileClaim {
  readonly profile: ProfileId;
  readonly version: string;
  readonly digest: string;
}

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

class LegacyStagedScopedRuntime {
  constructor(
    private readonly inner: ScopedRuntime,
    private readonly staged: K4ScopeState,
    private readonly ctx: { readonly clock: () => string; readonly external: ExternalLog },
  ) {}

  get grant(): ScopeGrant<unknown> {
    return this.inner.grant;
  }

  get scope(): StorageScope {
    return this.inner.scope;
  }

  get profiles(): readonly K4ProfileClaim[] {
    return STAGED_PROFILES;
  }

  /** Projection index and emitted deltas for module adapters. */
  get projections(): ProjectionRuntime {
    return this.staged.projections;
  }

  capability(profile: ProfileId): object {
    if (!isProfileId(profile) || !STAGED_PROFILES.some((entry) => entry.profile === profile)) {
      throw new UnsupportedProfileError(String(profile));
    }
    return {};
  }

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    this.inner.requireOperation(op);
  }

  /**
   * Covering barrier for an id: walks coverage to the nearest active
   * barrier, admitting barriers published in the same unit (G5). Returns
   * null when the id is reachable.
   */
  coveringBarrier(id: string, extra?: ReadonlySet<string>): string | null {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !seen.has(current)) {
      if (this.staged.barriers.has(current)) return current;
      if (extra?.has(current)) return current;
      seen.add(current);
      current = this.staged.coverage.get(current);
    }
    return null;
  }

  isCovered(id: string): boolean {
    return this.coveringBarrier(id) !== null;
  }

  private async currentBase(chainIds: ReadonlySet<string>): Promise<Map<string, { head: string | null; disposed: boolean }>> {
    const base = new Map<string, { head: string | null; disposed: boolean }>();
    for (const chainId of chainIds) {
      base.set(chainId, { head: await this.inner.readHead(chainId), disposed: this.staged.disposed.has(chainId) });
    }
    return base;
  }

  private touchedChains(fragments: readonly { effects: AtomicUnit }[]): Set<string> {
    const touched = new Set<string>();
    for (const fragment of fragments) {
      for (const guard of fragment.effects.guards) {
        if (guard.kind === 'head' || guard.kind === 'absent') touched.add(guard.chainId);
      }
      for (const append of fragment.effects.appends) touched.add(append.chainId);
    }
    return touched;
  }

  private mergeEffects(fragments: readonly StagedFragment[]): AtomicUnit {
    const merged: AtomicUnit = {
      guards: fragments.flatMap((fragment) => [...fragment.effects.guards]),
      records: fragments.flatMap((fragment) => [...fragment.effects.records]),
      appends: fragments.flatMap((fragment) => [...fragment.effects.appends]),
      updates: fragments.flatMap((fragment) => [...fragment.effects.updates]),
      relationships: fragments.flatMap((fragment) => [...fragment.effects.relationships]),
      barriers: fragments.flatMap((fragment) => [...fragment.effects.barriers]),
      purgeIntents: fragments.flatMap((fragment) => [...fragment.effects.purgeIntents]),
      indexWrites: fragments.flatMap((fragment) => [...fragment.effects.indexWrites]),
    };
    const moduleResult = fragments.map((fragment) => fragment.effects.moduleResult).find((value) => value !== undefined);
    return moduleResult === undefined ? merged : { ...merged, moduleResult };
  }


}
