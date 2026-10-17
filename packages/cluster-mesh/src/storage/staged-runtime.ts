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

export interface StagedKernelHandle {
  readonly moduleId: string;
  readonly incarnation: string;
  bindNew(grant: ScopeGrant<unknown>): StagedScopedRuntime;
  bind(grant: ScopeGrant<unknown>): StagedScopedRuntime;
  revoke(token: string): void | Promise<void>;
}

export const createStagedKernel = (options: StagedKernelOptions): StagedKernelHandle => {
  const inner: KernelRoot = createKernel(options);
  const scopes = new Map<string, K4ScopeState>();
  const external: ExternalLog = { events: [], seq: 0 };
  const clock = options.now ?? (() => new Date().toISOString());

  const stateFor = (scope: StorageScope): K4ScopeState => {
    const key = backendScopeKey(scope);
    const existing = scopes.get(key);
    if (existing) return existing;
    const created = createK4ScopeState(scope);
    scopes.set(key, created);
    return created;
  };

  return {
    moduleId: inner.moduleId,
    incarnation: inner.incarnation,
    revoke: (token: string): void | Promise<void> => inner.revoke(token),
    bindNew: (grant: ScopeGrant<unknown>): StagedScopedRuntime => {
      const bound = inner.bindNew(grant);
      return new StagedScopedRuntime(bound, stateFor(bound.scope), { clock, external });
    },
    bind: (grant: ScopeGrant<unknown>): StagedScopedRuntime => {
      const bound = inner.bind(grant);
      return new StagedScopedRuntime(bound, stateFor(bound.scope), { clock, external });
    },
  };
};

export interface StagedSealStepInput {
  readonly unit: StagedHandle;
  readonly root: StagedCommitRoot;
  readonly limits: WorkLimits;
  readonly fence: WriterFence;
}

export class StagedScopedRuntime {
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

  async appendChain(
    chainId: string,
    record: ChainRecordInput,
    expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string },
  ): Promise<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    if (this.isCovered(chainId)) throw new StorageInvalidCommandError('covered chain cannot escape its barrier');
    const outcome = await this.inner.appendChain(chainId, record, expectation);
    this.staged.knownChains.add(chainId);
    this.staged.root.publish();
    return outcome;
  }

  async genesis(kind: string, id: string, hash: string, value: unknown): Promise<{ readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    const outcome = await this.inner.genesis(kind, id, hash, value);
    if (!outcome.replayed) this.staged.root.publish();
    return outcome;
  }

  async indexGet(key: string): Promise<{ readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    return this.inner.indexGet(key);
  }

  async indexPut(
    key: string,
    entry: { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null },
  ): Promise<'insert' | 'replace'> {
    this.requireOperation('write');
    const outcome = await this.inner.indexPut(key, entry);
    if (outcome === 'insert') this.staged.root.publish();
    return outcome;
  }

  async readHead(chainId: string): Promise<string | null> {
    this.requireOperation('read');
    if (this.isCovered(chainId)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(chainId)) throw new StorageDeniedError('chain disposed');
    return this.inner.readHead(chainId);
  }

  async readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    return this.inner.readRecord(key);
  }

  async readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    return this.inner.readAggregate(key);
  }

  async readChain(chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]> {
    this.requireOperation('read');
    if (this.isCovered(chainId)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(chainId)) throw new StorageDeniedError('chain disposed');
    return this.inner.readChain(chainId);
  }

  async readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<ReadPageResult> {
    this.requireOperation('read');
    // Denial carries no retained identity: an inaccessible page stops
    // traversal with a null continuation, never a retained cursor.
    if (this.isCovered(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
    if (this.staged.disposed.has(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
    return this.inner.readPage(chainId, limit, cursor, maxEncodedBytes);
  }

  async disposeChain(chainId: string): Promise<void> {
    this.requireOperation('maintain');
    await this.inner.disposeChain(chainId);
    this.staged.disposed.add(chainId);
    this.staged.root.publish();
  }

  /**
   * Single publication point (§7.5): guard the unit, delegate carriers to
   * the K3 backend, then apply barriers, jobs, relationships, deltas and
   * journal visibility with one root version. Covered content commits only
   * with its own barrier in the same unit (G5); it never escapes an
   * already-active barrier.
   */
  private async publishUnit(
    unit: AtomicUnit,
    opts: { readonly idempotencyKey?: string; readonly segment?: string; readonly limits?: WorkLimits; readonly fence?: WriterFence },
  ): Promise<CommitReceipt> {
    const unitHash = JSON.stringify(unit);
    if (opts.idempotencyKey) {
      const stored = this.staged.commits.get(opts.idempotencyKey);
      if (stored) {
        if (stored.unitHash === unitHash) return stored.receipt;
        throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
      }
    }
    if (unit.purgeIntents.length > 0 && this.staged.policy === 'unconfigured') {
      throw new StorageDeniedError('purge not configured');
    }
    if (this.staged.policy === 'required' && unit.barriers.length > 0 && unit.purgeIntents.length === 0) {
      throw new StorageInvalidCommandError('purge intent required with barriers');
    }
    // A divergent purge-intent reuse fails before any effect is published.
    for (const intent of unit.purgeIntents) {
      const existing = this.staged.jobs.get(intent.intentId);
      if (existing && existing.target !== intent.target) {
        throw new StorageIdempotencyConflictError('purge intent reused for a divergent target');
      }
    }
    const unitBarriers = new Set(unit.barriers.map((barrier) => barrier.boundary));
    for (const append of unit.appends) {
      const covering = this.coveringBarrier(append.chainId, unitBarriers);
      if (covering && !unitBarriers.has(covering)) {
        throw new StorageInvalidCommandError('covered chain cannot escape its barrier');
      }
    }
    for (const record of unit.records) {
      const covering = this.coveringBarrier(record.key, unitBarriers);
      if (covering && !unitBarriers.has(covering)) {
        throw new StorageInvalidCommandError('covered record cannot escape its barrier');
      }
    }
    for (const update of unit.updates) {
      const covering = this.coveringBarrier(update.key, unitBarriers);
      if (covering && !unitBarriers.has(covering)) {
        throw new StorageInvalidCommandError('covered state cannot escape its barrier');
      }
    }
    // Relationship positives are owned by K4: shapes and removals are
    // admitted before delegation so a malformed unit never half-publishes.
    for (const change of unit.relationships) {
      if (change.kind !== 'add' && change.kind !== 'remove') {
        throw new StorageInvalidCommandError('relationship kind must be add or remove');
      }
      if (typeof change.relation !== 'string' || change.relation.length === 0 ||
        typeof change.from !== 'string' || change.from.length === 0 ||
        typeof change.to !== 'string' || change.to.length === 0) {
        throw new StorageInvalidCommandError('relationships require a relation, from and to');
      }
      if (change.kind === 'remove' && !this.staged.projections.queryRelationships(change.relation, change.from).includes(change.to)) {
        throw new StorageInvalidCommandError('unknown relationship');
      }
    }
    const carrier: AtomicUnit = {
      guards: [...unit.guards],
      records: [...unit.records],
      appends: [...unit.appends],
      updates: [...unit.updates],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [...unit.indexWrites],
      ...(unit.moduleResult === undefined ? {} : { moduleResult: unit.moduleResult }),
    };
    const receipt = await this.inner.commitAtomic(carrier, {
      ...(opts.idempotencyKey === undefined ? {} : { idempotencyKey: opts.idempotencyKey }),
      ...(opts.limits === undefined ? {} : { limits: opts.limits }),
      ...(opts.fence === undefined ? {} : { fence: opts.fence }),
    });
    for (const append of unit.appends) this.staged.knownChains.add(append.chainId);
    this.staged.projections.applyRelationships(unit.relationships);
    for (const barrier of unit.barriers) {
      this.staged.barriers.set(barrier.boundary, { reason: barrier.reason, createdAt: this.ctx.clock() });
    }
    for (const intent of unit.purgeIntents) {
      if (!this.staged.jobs.has(intent.intentId)) {
        this.staged.jobs.set(intent.intentId, {
          intentId: intent.intentId,
          target: intent.target,
          state: 'pending',
          authorizedBy: intent.authorizedBy,
          outcomeId: null,
        });
      }
    }
    this.staged.projections.emitDelta({
      cause: opts.segment === undefined ? 'atomic' : 'staged-publication',
      records: [...unit.records.map((record) => record.key), ...unit.appends.map((append) => append.chainId)],
      aggregates: unit.updates.map((update) => update.key),
      relationships: unit.relationships.map((change) => `${change.relation}:${change.from}:${change.to}`),
      barriers: unit.barriers.map((barrier) => barrier.boundary),
      ...(opts.segment === undefined ? {} : { unitId: opts.segment }),
    });
    const version = this.staged.root.publish();
    this.staged.journalSeq += 1;
    const seq = this.staged.journalSeq;
    const segment = opts.segment === undefined ? undefined : { operationKey: opts.segment, from: seq, to: seq };
    this.staged.journal.push({
      seq,
      eventId: `evt-${seq}`,
      scope: { ...this.scope },
      commitId: receipt.commitId,
      rootVersion: version,
      ...(opts.idempotencyKey === undefined ? {} : { operationKey: opts.idempotencyKey }),
      ...(segment === undefined ? {} : { segment }),
    });
    this.ctx.external.seq += 1;
    const externalSeq = this.ctx.external.seq;
    this.ctx.external.events.push({
      seq: externalSeq,
      eventId: `xevt-${externalSeq}`,
      scope: { ...this.scope },
      commitId: receipt.commitId,
      rootVersion: version,
      ...(opts.idempotencyKey === undefined ? {} : { operationKey: opts.idempotencyKey }),
      ...(segment === undefined ? {} : { segment }),
    });
    if (opts.idempotencyKey) {
      this.staged.commits.set(opts.idempotencyKey, { receipt, unitHash });
    }
    return receipt;
  }

  async commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): Promise<CommitReceipt> {
    this.requireOperation('write');
    if (!validateAtomicUnit(unit, options.limits).ok || !validateCommitOptions(options).ok) {
      throw new StorageInvalidCommandError('invalid unit or options');
    }
    return this.publishUnit(unit, options);
  }

  private findUnit(operationKey: string, unitId: string): StagedUnitRecord {
    const op = this.staged.units.get(operationKey);
    if (!op || op.unitId !== unitId) throw new StorageInvalidCommandError('unknown staged unit');
    return op;
  }

  async beginStaged(input: {
    readonly operationKey: string;
    readonly inputDigest: string;
    readonly contractDigest: string;
    readonly sourceBoundary: string;
    readonly fence: WriterFence;
  }): Promise<StagedHandle> {
    this.requireOperation('write');
    const validity = validateBeginInput(input);
    if (!validity.ok) throw new StorageInvalidCommandError(validity.errors.join('; '));
    const existing = this.staged.units.get(input.operationKey);
    if (existing) return { unitId: existing.unitId, operationKey: input.operationKey };
    this.staged.unitSeq += 1;
    const op: StagedUnitRecord = {
      unitId: `unit-${this.staged.unitSeq}`,
      operationKey: input.operationKey,
      fragments: [],
      state: 'staging',
      validation: null,
      validationRoot: null,
      seal: null,
      base: null,
      receipt: null,
    };
    this.staged.units.set(input.operationKey, op);
    return { unitId: op.unitId, operationKey: op.operationKey };
  }

  async stageFragment(input: {
    readonly unit: StagedHandle;
    readonly ordinal: string;
    readonly predecessorHash: string | null;
    readonly fragmentDigest: string;
    readonly effects: AtomicUnit;
    readonly fence: WriterFence;
    readonly limits?: WorkLimits;
  }): Promise<FragmentReceipt> {
    this.requireOperation('write');
    const op = this.findUnit(input.unit.operationKey, input.unit.unitId);
    if (op.state !== 'staging') throw new StorageInvalidCommandError('fragments only while staging');
    const shape = validateFragmentInput(
      {
        unitId: op.unitId,
        ordinal: input.ordinal,
        predecessorHash: input.predecessorHash,
        fragmentDigest: input.fragmentDigest,
        effects: input.effects,
        fence: input.fence,
      },
      input.limits,
    );
    if (!shape.ok) throw new StorageInvalidCommandError(shape.errors.join('; '));
    const same = op.fragments.find((entry) => entry.ordinal === input.ordinal);
    if (same) {
      if (same.fragmentDigest === input.fragmentDigest) {
        return { unitId: op.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
      }
      throw new StorageIdempotencyConflictError('changed bytes at an accepted ordinal conflict');
    }
    const sequence = validateFragmentSequence(
      op.fragments.map((entry) => ({ ordinal: entry.ordinal, fragmentDigest: entry.fragmentDigest })),
      { ordinal: input.ordinal, predecessorHash: input.predecessorHash, fragmentDigest: input.fragmentDigest },
    );
    if (!sequence.ok) throw new StorageInvalidCommandError(sequence.errors.join('; '));
    op.fragments.push({
      ordinal: input.ordinal,
      predecessorHash: input.predecessorHash,
      fragmentDigest: input.fragmentDigest,
      effects: input.effects,
    });
    return { unitId: op.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
  }

  private sameRoot(left: StagedCommitRoot, right: StagedCommitRoot): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async sealStep(input: StagedSealStepInput): Promise<SealValidationOutcome> {
    this.requireOperation('write');
    const limits = validateWorkLimits(input.limits);
    if (!limits.ok) throw new StorageInvalidCommandError(limits.errors.join('; '));
    const fence = validateWriterFence(input.fence);
    if (!fence.ok) throw new StorageInvalidCommandError(fence.errors.join('; '));
    const op = this.findUnit(input.unit.operationKey, input.unit.unitId);
    if (op.state === 'committed' || op.state === 'aborted') {
      throw new StorageInvalidCommandError('only staging units seal');
    }
    if (op.state === 'sealed' && op.seal) {
      if (this.sameRoot(op.seal.commitRoot, input.root)) return { state: 'sealed', seal: op.seal };
      throw new StorageInvalidCommandError('only staging units seal');
    }
    if (op.state === 'sealing' && op.validation) {
      if (op.validationRoot === null || !this.sameRoot(op.validationRoot, input.root)) {
        throw new StorageInvalidCommandError('seal substitution rejected');
      }
      return this.driveValidation(op);
    }
    const root = validateCommitRoot(input.root);
    if (!root.ok) throw new StorageInvalidCommandError(root.errors.join('; '));
    const base = await this.currentBase(this.touchedChains(op.fragments));
    op.base = { version: this.staged.root.version, chains: base };
    op.validation = new StagedSealValidation(op.unitId, op.fragments, input.root);
    op.validationRoot = input.root;
    op.state = 'sealing';
    return this.driveValidation(op);
  }

  private driveValidation(op: StagedUnitRecord): SealValidationOutcome {
    if (!op.validation) throw new StorageInvalidCommandError('seal validation missing');
    let outcome: SealValidationOutcome;
    try {
      outcome = op.validation.step();
    } catch (error) {
      // A failed seal attempt leaves no partial validation behind: the unit
      // returns to staging so a corrected root can seal from scratch.
      op.state = 'staging';
      op.validation = null;
      op.validationRoot = null;
      op.seal = null;
      op.base = null;
      throw error;
    }
    if (outcome.state === 'sealed') {
      op.seal = outcome.seal;
      op.state = 'sealed';
    }
    return outcome;
  }

  async sealStaged(input: { readonly unit: StagedHandle; readonly root: StagedCommitRoot }): Promise<StagedUnitSeal> {
    this.requireOperation('write');
    const op = this.findUnit(input.unit.operationKey, input.unit.unitId);
    if (op.state === 'committed' || op.state === 'aborted') {
      throw new StorageInvalidCommandError('only staging units seal');
    }
    if (op.state === 'sealed' && op.seal) {
      if (this.sameRoot(op.seal.commitRoot, input.root)) return op.seal;
      throw new StorageInvalidCommandError('only staging units seal');
    }
    if (op.state === 'staging') {
      const shape = validateCommitRoot(input.root);
      if (!shape.ok) throw new StorageInvalidCommandError(shape.errors.join('; '));
      const base = await this.currentBase(this.touchedChains(op.fragments));
      op.base = { version: this.staged.root.version, chains: base };
      op.validation = new StagedSealValidation(op.unitId, op.fragments, input.root);
      op.validationRoot = input.root;
      op.state = 'sealing';
    } else if (op.validationRoot === null || !this.sameRoot(op.validationRoot, input.root)) {
      throw new StorageInvalidCommandError('seal substitution rejected');
    }
    let outcome = this.driveValidation(op);
    while (outcome.state === 'validating') {
      outcome = this.driveValidation(op);
    }
    return outcome.seal;
  }

  async commitStaged(input: {
    readonly seal: StagedUnitSeal;
    readonly fence: WriterFence;
  }): Promise<CommitReceipt> {
    this.requireOperation('write');
    const fence = validateWriterFence(input.fence);
    if (!fence.ok) throw new StorageInvalidCommandError(fence.errors.join('; '));
    const op = [...this.staged.units.values()].find((entry) => entry.unitId === input.seal.unitId);
    if (!op) throw new StorageInvalidCommandError('unknown staged seal');
    if (op.state === 'committed' && op.receipt) return op.receipt;
    if (op.state !== 'sealed' || !op.seal || !op.base) throw new StorageInvalidCommandError('unstaged commit');
    if (!this.sameRoot(op.seal.commitRoot, input.seal.commitRoot)) {
      throw new StorageInvalidCommandError('seal substitution rejected');
    }
    const current = await this.currentBase(new Set(op.base.chains.keys()));
    if (!this.staged.root.matches(op.base, current)) {
      throw new StorageCasConflictError('changed base without publication');
    }
    const receipt = await this.publishUnit(this.mergeEffects(op.fragments), {
      idempotencyKey: op.operationKey,
      segment: op.operationKey,
      fence: input.fence,
    });
    op.state = 'committed';
    op.receipt = receipt;
    return receipt;
  }

  async inspectStaged(operationKey: string): Promise<StagedUnitStatus> {
    this.requireOperation('read');
    const op = this.staged.units.get(operationKey);
    if (!op) throw new StorageInvalidCommandError('unknown staged operation');
    if (op.state === 'staging') return { state: 'staging', acceptedFragments: String(op.fragments.length) };
    if (op.state === 'sealing') return { state: 'sealing', acceptedFragments: String(op.fragments.length) };
    if (op.state === 'sealed' && op.seal) return { state: 'sealed', seal: op.seal };
    if (op.state === 'committed' && op.receipt) return { state: 'committed', commitId: op.receipt.commitId };
    return { state: 'aborted', reason: op.abortReason ?? 'aborted' };
  }

  async abortStaged(input: { readonly unit: StagedHandle }): Promise<void> {
    this.requireOperation('write');
    const op = this.findUnit(input.unit.operationKey, input.unit.unitId);
    if (op.state === 'committed') throw new StorageInvalidCommandError('committed units cannot abort');
    if (op.state === 'aborted') return;
    op.state = 'aborted';
    op.abortReason = op.operationKey;
    op.fragments.length = 0;
    op.validation = null;
    op.validationRoot = null;
    op.seal = null;
    op.base = null;
  }

  async externalRead(after: number, limit: number): Promise<JournalReadResult> {
    this.requireOperation('read');
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StorageInvalidCommandError('external reader requires a valid window');
    }
    const events = this.ctx.external.events.filter((event) => event.seq > after).slice(0, limit);
    return { events, watermark: this.ctx.external.seq };
  }

  async journalRead(consumer: string, after: number, limit: number): Promise<JournalReadResult> {
    this.requireOperation('read');
    if (typeof consumer !== 'string' || consumer.length === 0) {
      throw new StorageInvalidCommandError('journal reader requires a consumer');
    }
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StorageInvalidCommandError('journal reader requires a valid window');
    }
    return {
      events: this.staged.journal.filter((event) => event.seq > after).slice(0, limit),
      watermark: this.staged.journalSeq,
    };
  }

  async journalCheckpoint(consumer: string, expected: number, next: number): Promise<void> {
    this.requireOperation('write');
    if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(next) || next < 0) {
      throw new StorageInvalidCommandError('checkpoints require non-negative cursors');
    }
    let entry = this.staged.consumers.get(consumer);
    if (!entry) {
      entry = { cursor: 0, status: 'running', failedEvent: null, failedReason: null, failedSeq: null };
      this.staged.consumers.set(consumer, entry);
    }
    if (entry.cursor !== expected) throw new StorageCasConflictError('checkpoint expected mismatch');
    if (next < entry.cursor) throw new StorageInvalidCommandError('checkpoints are monotonic');
    if (next > this.staged.journalSeq) throw new StorageInvalidCommandError('checkpoint beyond the log');
    if (entry.status === 'stalled' && entry.failedSeq !== null && next >= entry.failedSeq) {
      throw new StorageInvalidCommandError('checkpoint cannot pass an undelivered poisoned event');
    }
    entry.cursor = next;
  }

  async journalInspect(consumer: string): Promise<ConsumerView> {
    this.requireOperation('read');
    const entry = this.staged.consumers.get(consumer);
    const cursor = entry?.cursor ?? 0;
    return {
      cursor,
      status: entry?.status ?? 'running',
      failedEvent: entry?.failedEvent ?? null,
      failedReason: entry?.failedReason ?? null,
      lag: this.staged.journalSeq - cursor,
    };
  }

  async journalMarkPoison(consumer: string, eventId: string, reason: string): Promise<void> {
    this.requireOperation('write');
    const event = this.staged.journal.find((entry) => entry.eventId === eventId);
    if (!event) throw new StorageInvalidCommandError('unknown journal event');
    let entry = this.staged.consumers.get(consumer);
    if (!entry) {
      entry = { cursor: 0, status: 'running', failedEvent: null, failedReason: null, failedSeq: null };
      this.staged.consumers.set(consumer, entry);
    }
    entry.status = 'stalled';
    entry.failedEvent = eventId;
    entry.failedReason = reason;
    entry.failedSeq = event.seq;
  }

  async journalRetry(consumer: string, expectedFailure: string): Promise<void> {
    this.requireOperation('write');
    const entry = this.staged.consumers.get(consumer);
    if (!entry || entry.status !== 'stalled' || entry.failedEvent !== expectedFailure) {
      throw new StorageInvalidCommandError('nothing to retry');
    }
    entry.status = 'running';
    entry.failedEvent = null;
    entry.failedReason = null;
    entry.failedSeq = null;
  }

  async journalResync(consumer: string): Promise<{ readonly snapshotRoot: string; readonly journalSeq: number }> {
    this.requireOperation('write');
    let entry = this.staged.consumers.get(consumer);
    if (!entry) {
      entry = { cursor: 0, status: 'running', failedEvent: null, failedReason: null, failedSeq: null };
      this.staged.consumers.set(consumer, entry);
    }
    // Resync captures the snapshot/root and journal boundary but never
    // advances the checkpoint; the consumer acknowledges only after
    // consuming the snapshot.
    entry.status = 'running';
    entry.failedEvent = null;
    entry.failedReason = null;
    entry.failedSeq = null;
    return { snapshotRoot: `root-${this.staged.journalSeq}`, journalSeq: this.staged.journalSeq };
  }

  async configureLifecycle(policy: PurgePolicy): Promise<void> {
    this.requireOperation('maintain');
    if (policy !== 'unconfigured' && policy !== 'optional' && policy !== 'required') {
      throw new StorageInvalidCommandError('unknown purge policy');
    }
    this.staged.policy = policy;
  }

  async declareCoverage(parent: string, child: string): Promise<void> {
    this.requireOperation('write');
    if (typeof parent !== 'string' || parent.length === 0 || typeof child !== 'string' || child.length === 0) {
      throw new StorageInvalidCommandError('coverage requires a parent and a child');
    }
    if (parent === child) throw new StorageInvalidCommandError('coverage cannot cover itself');
    let current: string | undefined = parent;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      if (current === child) throw new StorageInvalidCommandError('coverage cannot cycle');
      seen.add(current);
      current = this.staged.coverage.get(current);
    }
    this.staged.coverage.set(child, parent);
  }

  async holdTarget(target: string, reason: string): Promise<void> {
    this.requireOperation('maintain');
    if (typeof target !== 'string' || target.length === 0 || typeof reason !== 'string' || reason.length === 0) {
      throw new StorageInvalidCommandError('holds require a target and a reason');
    }
    this.staged.holds.set(target, reason);
  }

  async releaseHold(target: string): Promise<void> {
    this.requireOperation('maintain');
    if (!this.staged.holds.has(target)) throw new StorageInvalidCommandError('unknown hold');
    this.staged.holds.delete(target);
  }

  async completePurge(intentId: string): Promise<PurgeJobView> {
    this.requireOperation('maintain');
    const job = this.staged.jobs.get(intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge intent');
    if (job.state === 'complete') return { state: job.state, outcomeId: job.outcomeId };
    if (this.staged.holds.has(job.target)) {
      job.state = 'held';
      return { state: 'held', outcomeId: null };
    }
    if (!this.staged.knownChains.has(job.target) && !this.staged.blobs.has(job.target)) {
      job.state = 'failed';
      return { state: 'failed', outcomeId: null };
    }
    if (this.staged.knownChains.has(job.target) && !this.staged.disposed.has(job.target)) {
      await this.inner.disposeChain(job.target);
      this.staged.disposed.add(job.target);
      this.staged.root.publish();
    }
    const blob = this.staged.blobs.get(job.target);
    if (blob) {
      blob.bytes = null;
      blob.owners.clear();
    }
    job.state = 'complete';
    job.outcomeId = `purge-outcome-${intentId}`;
    this.staged.projections.emitDelta({
      cause: 'purge',
      records: [],
      aggregates: [],
      relationships: [],
      barriers: [],
      unitId: intentId,
    });
    return { state: job.state, outcomeId: job.outcomeId };
  }

  async purgeProgress(intentId: string): Promise<PurgeJobView> {
    this.requireOperation('read');
    const job = this.staged.jobs.get(intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge intent');
    return { state: job.state, outcomeId: job.outcomeId };
  }

  async purgeJobIds(): Promise<string[]> {
    this.requireOperation('read');
    return [...this.staged.jobs.keys()];
  }

  async shareBlob(blobId: string, owner: string, bytes: string): Promise<void> {
    this.requireOperation('write');
    if (typeof blobId !== 'string' || blobId.length === 0 || typeof owner !== 'string' || owner.length === 0) {
      throw new StorageInvalidCommandError('shared blobs require an id and an owner');
    }
    const existing = this.staged.blobs.get(blobId);
    if (existing && existing.bytes !== null && existing.bytes !== bytes) {
      throw new StorageIdempotencyConflictError('shared blob bytes conflict');
    }
    if (existing && existing.bytes !== null) {
      existing.owners.add(owner);
      return;
    }
    this.staged.blobs.set(blobId, { owners: new Set([owner]), bytes });
  }

  async releaseBlob(blobId: string, owner: string): Promise<void> {
    this.requireOperation('write');
    const existing = this.staged.blobs.get(blobId);
    if (!existing) throw new StorageInvalidCommandError('unknown shared blob');
    existing.owners.delete(owner);
    if (existing.owners.size === 0) existing.bytes = null;
  }

  async readBlob(blobId: string): Promise<string | null> {
    this.requireOperation('read');
    if (this.isCovered(blobId)) throw new StorageDeniedError('barrier covered');
    return this.staged.blobs.get(blobId)?.bytes ?? null;
  }
}
