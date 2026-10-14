// Test-only staged/journal/barrier/lifecycle reference extension for the K2b
// shared corpus (L3a v4.1 frozen §§7, 10, 13, 16.1, 17.1). In-memory only, no
// durability claim. Wraps the K2a bound store: every grant check stays the
// base implementation, while coverage, disposal-mirror, purge policy and the
// journal live in per-scope staged state. Announces visibility-barriers-v1
// and purge-jobs-v1; predicates and relationships stay rejected (K3/K4 own
// the positives). Barriers ride with carrier appends (§10.1).

import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
} from '../../src/storage/errors.js';
import type { AtomicUnit, ChainExpectation, CommitOptions, CommitReceipt } from '../../src/storage/atomic.js';
import { validateAtomicUnit } from '../../src/storage/atomic.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import type { StorageScope, WorkLimits, WriterFence } from '../../src/storage/contracts.js';
import { validateWriterFence } from '../../src/storage/contracts.js';
import {
  nextStagedState,
  validateBeginInput,
  validateCommitRoot,
  validateFragmentInput,
  validateFragmentSequence,
  type FragmentReceipt,
  type StagedCommitRoot,
  type StagedUnitStatus,
} from '../../src/storage/staged-units.js';
import {
  TestBoundStore,
  TestReferenceStore,
  type ChainPage,
  type ChainRecordInput,
  type TestClock,
} from './reference-store.js';

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
  readonly operationKey?: string;
  readonly segment?: StagedJournalSegment;
}

export interface StagedConsumer {
  cursor: number;
  status: 'running' | 'stalled';
  failedEvent: string | null;
  failedReason: string | null;
  failedSeq: number | null;
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

interface StagedOp {
  readonly unitId: string;
  readonly operationKey: string;
  readonly fragments: StagedFragment[];
  state: 'staging' | 'sealed' | 'committed' | 'aborted';
  seal?: { readonly unitId: string; readonly commitRoot: StagedCommitRoot };
  base?: Map<string, { readonly head: string | null; readonly disposed: boolean }>;
  indexBase?: Map<string, { readonly digest: string; readonly resultIds: readonly string[] } | null>;
  receipt?: CommitReceipt;
  abortReason?: string;
  beginFence?: WriterFence;
  beginInputDigest?: string;
  beginContractDigest?: string;
  beginSourceBoundary?: string;
}

const compareEpoch = (current: string, begin: string): number => {
  const numeric = /^\d+$/;
  if (numeric.test(current) && numeric.test(begin)) {
    const a = BigInt(current);
    const b = BigInt(begin);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return current < begin ? -1 : current > begin ? 1 : 0;
};

interface StagedScope {
  readonly units: Map<string, StagedOp>;
  readonly chains: Set<string>;
  readonly disposed: Set<string>;
  readonly coverage: Map<string, string>;
  readonly barriers: Map<string, { readonly reason: string; readonly createdAt: string }>;
  readonly jobs: Map<string, PurgeJob>;
  readonly holds: Map<string, string>;
  readonly blobs: Map<string, { owners: Set<string>; bytes: string | null }>;
  readonly commits: Map<string, { readonly receipt: CommitReceipt; readonly unitHash: string }>;
  readonly journal: StagedJournalEvent[];
  readonly consumers: Map<string, StagedConsumer>;
  journalSeq: number;
  unitSeq: number;
}

const createStagedScope = (): StagedScope => ({
  units: new Map(),
  chains: new Set(),
  disposed: new Set(),
  coverage: new Map(),
  barriers: new Map(),
  jobs: new Map(),
  holds: new Map(),
  blobs: new Map(),
  commits: new Map(),
  journal: [],
  consumers: new Map(),
  journalSeq: 0,
  unitSeq: 0,
});

export class TestStagedReferenceStore extends TestReferenceStore {
  private readonly stagedScopes = new Map<string, StagedScope>();
  private readonly externalLog: StagedJournalEvent[] = [];
  private externalSeq = 0;
  private purgePolicy: PurgePolicy = 'optional';
  private readonly stagedClock: TestClock;
  private failExternalNext = false;
  private failPurgeNext = false;

  constructor(moduleId: string, clock: TestClock = () => new Date().toISOString(), purgePolicy: PurgePolicy = 'optional') {
    super(moduleId, clock);
    this.stagedClock = clock;
    this.purgePolicy = purgePolicy;
  }

  get policy(): PurgePolicy {
    return this.purgePolicy;
  }

  setPolicy(policy: PurgePolicy): void {
    this.purgePolicy = policy;
  }

  now(): string {
    return this.stagedClock();
  }

  stagedScope(scope: StorageScope): StagedScope {
    const key = JSON.stringify(['staged-scope', scope.tenantId, scope.workspaceId]);
    const existing = this.stagedScopes.get(key);
    if (existing) return existing;
    const created = createStagedScope();
    this.stagedScopes.set(key, created);
    return created;
  }

  bindStaged(grant: ScopeGrant<unknown>): TestStagedStore {
    const inner = super.bind(super.issueGrant(grant));
    return new TestStagedStore(inner, this.stagedScope(inner.scope), this);
  }

  armExternalFailure(): void {
    this.failExternalNext = true;
  }

  consumeExternalFailure(): void {
    if (this.failExternalNext) {
      this.failExternalNext = false;
      throw new StorageInvalidCommandError('external append failed');
    }
  }

  armPurgeFailure(): void {
    this.failPurgeNext = true;
  }

  consumePurgeFailure(): void {
    if (this.failPurgeNext) {
      this.failPurgeNext = false;
      throw new StorageInvalidCommandError('purge completion interrupted');
    }
  }

  appendExternal(entry: Omit<StagedJournalEvent, 'seq' | 'eventId'>): StagedJournalEvent {
    if (this.failExternalNext) {
      this.failExternalNext = false;
      throw new StorageInvalidCommandError('external append failed');
    }
    this.externalSeq += 1;
    const stored: StagedJournalEvent = { ...entry, seq: this.externalSeq, eventId: `evt-${this.externalSeq}` };
    this.externalLog.push(stored);
    return stored;
  }

  readExternal(after: number): readonly StagedJournalEvent[] {
    return this.externalLog.filter((event) => event.seq > after);
  }

  externalWatermark(): number {
    return this.externalSeq;
  }
}

export class TestStagedStore {
  constructor(
    private readonly inner: TestBoundStore,
    private readonly staged: StagedScope,
    private readonly store: TestStagedReferenceStore,
  ) {}

  get grant(): ScopeGrant<unknown> {
    return this.inner.grant;
  }

  get scope(): StorageScope {
    return this.inner.scope;
  }

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    this.inner.requireOperation(op);
  }

  isCovered(id: string): boolean {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !seen.has(current)) {
      if (this.staged.barriers.has(current)) return true;
      seen.add(current);
      current = this.staged.coverage.get(current);
    }
    return false;
  }

  appendChain(chainId: string, record: ChainRecordInput, expectation: ChainExpectation): { readonly seq: number; readonly hash: string; readonly replayed: boolean } {
    this.requireOperation('write');
    if (this.isCovered(chainId)) throw new StorageInvalidCommandError('covered chain cannot escape its barrier');
    const outcome = this.inner.appendChain(chainId, record, expectation);
    this.staged.chains.add(chainId);
    return outcome;
  }

  genesis(kind: string, id: string, hash: string, value: unknown): { readonly hash: string; readonly replayed: boolean } {
    return this.inner.genesis(kind, id, hash, value);
  }

  indexGet(key: string): ReturnType<TestBoundStore['indexGet']> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    return this.inner.indexGet(key);
  }

  indexPut(key: string, entry: Parameters<TestBoundStore['indexPut']>[1]): 'insert' | 'replace' {
    return this.inner.indexPut(key, entry);
  }

  readHead(chainId: string): string | null {
    this.requireOperation('read');
    if (this.isCovered(chainId)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(chainId)) throw new StorageDeniedError('chain disposed');
    return this.inner.readHead(chainId);
  }

  readRecord(key: string): ReturnType<TestBoundStore['readRecord']> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(key)) throw new StorageDeniedError('record disposed');
    return this.inner.readRecord(key);
  }

  readAggregate(key: string): ReturnType<TestBoundStore['readAggregate']> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(key)) throw new StorageDeniedError('aggregate disposed');
    return this.inner.readAggregate(key);
  }

  readChain(chainId: string): ReturnType<TestBoundStore['readChain']> {
    this.requireOperation('read');
    if (this.isCovered(chainId)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(chainId)) throw new StorageDeniedError('chain disposed');
    return this.inner.readChain(chainId);
  }

  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): ChainPage {
    // §8.4: denial carries no retained identity. An inaccessible page stops
    // traversal with a null continuation, never the inner head hash.
    if (this.isCovered(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
    if (this.staged.disposed.has(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
    return this.inner.readPage(chainId, limit, cursor, maxEncodedBytes);
  }

  disposeChain(chainId: string): void {
    this.inner.disposeChain(chainId);
    this.staged.disposed.add(chainId);
  }

  commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): CommitReceipt {
    this.requireOperation('write');
    this.store.consumeExternalFailure();
    if (options.limits) {
      const limited = validateAtomicUnit(unit, options.limits);
      if (!limited.ok) throw new StorageInvalidCommandError(limited.errors.join('; '));
    }
    if (unit.purgeIntents.length > 0 && this.store.policy === 'unconfigured') {
      throw new StorageDeniedError('purge not configured');
    }
    // §10.1: a purge intent requires purge authority. In the port this is
    // the maintain capability; without it the whole transaction is denied
    // before any effect is published.
    if (unit.purgeIntents.length > 0) {
      this.requireOperation('maintain');
    }
    if (this.store.policy === 'required' && unit.barriers.length > 0 && unit.purgeIntents.length === 0) {
      throw new StorageInvalidCommandError('purge intent required with barriers');
    }
    for (const append of unit.appends) {
      if (this.isCovered(append.chainId)) {
        throw new StorageInvalidCommandError('covered chain cannot escape its barrier');
      }
    }
    for (const record of unit.records) {
      if (this.isCovered(record.key)) throw new StorageInvalidCommandError('covered record cannot escape its barrier');
    }
    for (const update of unit.updates) {
      if (this.isCovered(update.key)) throw new StorageInvalidCommandError('covered state cannot escape its barrier');
    }
    if (options.idempotencyKey) {
      const stored = this.staged.commits.get(options.idempotencyKey);
      const unitHash = JSON.stringify(unit);
      if (stored) {
        if (stored.unitHash === unitHash) return stored.receipt;
        throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
      }
    }
    // §5.2 atomicity: a divergent purge-intent reuse must fail before any
    // effect is published, never after appends/records/updates are live.
    for (const intent of unit.purgeIntents) {
      const existing = this.staged.jobs.get(intent.intentId);
      if (existing && existing.target !== intent.target) {
        throw new StorageIdempotencyConflictError('purge intent reused for a divergent target');
      }
    }
    const receipt = this.inner.commitAtomic({ ...unit, barriers: [], purgeIntents: [] });
    for (const append of unit.appends) this.staged.chains.add(append.chainId);
    for (const barrier of unit.barriers) {
      this.staged.barriers.set(barrier.boundary, { reason: barrier.reason, createdAt: this.store.now() });
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
    this.staged.journalSeq += 1;
    const seq = this.staged.journalSeq;
    const segment = this.pendingSegment ? { operationKey: this.pendingSegment, from: seq, to: seq } : undefined;
    this.staged.journal.push({
      seq,
      eventId: `evt-${seq}`,
      scope: { ...this.scope },
      commitId: receipt.commitId,
      operationKey: options.idempotencyKey,
      segment,
    });
    this.store.appendExternal({
      scope: { ...this.scope },
      commitId: receipt.commitId,
      operationKey: options.idempotencyKey,
      segment,
    });
    if (options.idempotencyKey) {
      this.staged.commits.set(options.idempotencyKey, { receipt, unitHash: JSON.stringify(unit) });
    }
    return receipt;
  }

  private pendingSegment: string | null = null;

  commitWithSegment(unit: AtomicUnit, options: CommitOptions, operationKey: string): CommitReceipt {
    this.pendingSegment = operationKey;
    try {
      return this.commitAtomic(unit, { ...options, idempotencyKey: operationKey });
    } finally {
      this.pendingSegment = null;
    }
  }

  beginStaged(input: {
    readonly operationKey: string;
    readonly inputDigest: string;
    readonly contractDigest: string;
    readonly sourceBoundary: string;
    readonly fence: WriterFence;
  }): StagedHandle {
    this.requireOperation('write');
    const valid = validateBeginInput(input);
    if (!valid.ok) throw new StorageInvalidCommandError(valid.errors.join('; '));
    const existing = this.staged.units.get(input.operationKey);
    if (existing) {
      if (
        existing.beginInputDigest !== input.inputDigest ||
        existing.beginContractDigest !== input.contractDigest ||
        existing.beginSourceBoundary !== input.sourceBoundary
      ) {
        throw new StorageIdempotencyConflictError('divergent begin conflicts');
      }
      return { unitId: existing.unitId, operationKey: input.operationKey };
    }
    this.staged.unitSeq += 1;
    const op: StagedOp = {
      unitId: `unit-${this.staged.unitSeq}`,
      operationKey: input.operationKey,
      fragments: [],
      state: 'staging',
      beginFence: { ...input.fence },
      beginInputDigest: input.inputDigest,
      beginContractDigest: input.contractDigest,
      beginSourceBoundary: input.sourceBoundary,
    };
    this.staged.units.set(input.operationKey, op);
    return { unitId: op.unitId, operationKey: op.operationKey };
  }

  stageFragment(input: {
    readonly unit: StagedHandle;
    readonly ordinal: string;
    readonly predecessorHash: string | null;
    readonly fragmentDigest: string;
    readonly effects: AtomicUnit;
    readonly fence: WriterFence;
    readonly limits?: WorkLimits;
  }): FragmentReceipt {
    this.requireOperation('write');
    const op = this.staged.units.get(input.unit.operationKey);
    if (!op || op.unitId !== input.unit.unitId) throw new StorageInvalidCommandError('unknown staged unit');
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
      if (
        same.fragmentDigest === input.fragmentDigest &&
        JSON.stringify(same.effects) === JSON.stringify(input.effects)
      ) {
        return { unitId: op.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
      }
      throw new StorageIdempotencyConflictError('changed bytes at an accepted ordinal conflict');
    }
    const sequence = validateFragmentSequence(
      op.fragments.map((entry) => ({ ordinal: entry.ordinal, fragmentDigest: entry.fragmentDigest })),
      { ordinal: input.ordinal, predecessorHash: input.predecessorHash, fragmentDigest: input.fragmentDigest },
    );
    if (!sequence.ok) throw new StorageInvalidCommandError(sequence.errors.join('; '));
    // Buffers are immutable after acceptance: deep-copy the effects so a
    // caller-side mutation after staging can never rewrite the accepted unit.
    const frozenEffects = JSON.parse(JSON.stringify(input.effects)) as AtomicUnit;
    op.fragments.push({
      ordinal: input.ordinal,
      predecessorHash: input.predecessorHash,
      fragmentDigest: input.fragmentDigest,
      effects: frozenEffects,
    });
    return { unitId: op.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
  }

  sealStaged(input: { readonly unit: StagedHandle; readonly root: StagedCommitRoot }): {
    readonly unitId: string;
    readonly commitRoot: StagedCommitRoot;
  } {
    this.requireOperation('write');
    const op = this.staged.units.get(input.unit.operationKey);
    if (!op || op.unitId !== input.unit.unitId) throw new StorageInvalidCommandError('unknown staged unit');
    if (op.state !== 'staging') throw new StorageInvalidCommandError('only staging units seal');
    const root = validateCommitRoot(input.root);
    if (!root.ok) throw new StorageInvalidCommandError(root.errors.join('; '));
    if (input.root.operationId !== op.operationKey) {
      throw new StorageInvalidCommandError('seal operation mismatch');
    }
    if (input.root.contractDigest !== op.beginContractDigest) {
      throw new StorageInvalidCommandError('seal contract mismatch');
    }
    if (input.root.sourceBoundary !== op.beginSourceBoundary) {
      throw new StorageInvalidCommandError('seal boundary mismatch');
    }
    if (input.root.fragmentCount !== String(op.fragments.length)) {
      throw new StorageInvalidCommandError('wrong counts cannot seal');
    }
    const last = op.fragments[op.fragments.length - 1];
    if (!last || input.root.finalFragmentHash !== last.fragmentDigest) {
      throw new StorageInvalidCommandError('truncated chains cannot seal');
    }
    if (input.root.dependencyRoot !== 'dep-root-k2b' || input.root.effectRoot !== 'eff-root-k2b') {
      throw new StorageInvalidCommandError('seal roots mismatch');
    }
    if (nextStagedState('staging', 'begin-seal') !== 'sealing' || nextStagedState('sealing', 'seal') !== 'sealed') {
      throw new StorageInvalidCommandError('seal transition closed');
    }
    const touched = new Set<string>();
    const touchedIndex = new Set<string>();
    for (const fragment of op.fragments) {
      for (const guard of fragment.effects.guards) {
        if (guard.kind === 'head' || guard.kind === 'absent') touched.add(guard.chainId);
      }
      for (const append of fragment.effects.appends) touched.add(append.chainId);
      for (const write of fragment.effects.indexWrites) touchedIndex.add(write.key);
    }
    const base = new Map<string, { readonly head: string | null; readonly disposed: boolean }>();
    for (const chainId of touched) {
      base.set(chainId, { head: this.inner.readHead(chainId), disposed: this.staged.disposed.has(chainId) });
    }
    const indexBase = new Map<string, { readonly digest: string; readonly resultIds: readonly string[] } | null>();
    for (const key of touchedIndex) {
      const entry = this.inner.indexGet(key);
      indexBase.set(key, entry ? { digest: entry.digest, resultIds: [...entry.resultIds] } : null);
    }
    op.state = 'sealed';
    op.seal = { unitId: op.unitId, commitRoot: { ...input.root } };
    op.base = base;
    op.indexBase = indexBase;
    return { unitId: op.seal.unitId, commitRoot: { ...op.seal.commitRoot } };
  }

  commitStaged(input: {
    readonly seal: { readonly unitId: string; readonly commitRoot: StagedCommitRoot };
    readonly fence: WriterFence;
  }): CommitReceipt {
    this.requireOperation('write');
    const fence = validateWriterFence(input.fence);
    if (!fence.ok) throw new StorageInvalidCommandError(fence.errors.join('; '));
    const op = [...this.staged.units.values()].find((entry) => entry.unitId === input.seal.unitId);
    if (!op) throw new StorageInvalidCommandError('unknown staged seal');
    if (op.state === 'committed' && op.receipt) {
      if (!op.seal || JSON.stringify(op.seal) !== JSON.stringify(input.seal)) {
        throw new StorageInvalidCommandError('unknown staged seal');
      }
      return { ...op.receipt, scope: { ...op.receipt.scope } };
    }
    // §7.5 step 2 + §13.4: a successful CAS does not authorize a stale
    // writer. The commit fence must match the begin fence and must not
    // regress to an earlier epoch.
    if (op.beginFence) {
      if (input.fence.fenceId !== op.beginFence.fenceId) {
        throw new StorageInvalidCommandError('stale writer cannot publish');
      }
      if (compareEpoch(input.fence.epoch, op.beginFence.epoch) < 0) {
        throw new StorageInvalidCommandError('stale writer cannot publish');
      }
    }
    if (op.state !== 'sealed' || !op.seal || !op.base) throw new StorageInvalidCommandError('unstaged commit');
    if (JSON.stringify(op.seal) !== JSON.stringify(input.seal)) {
      throw new StorageInvalidCommandError('seal substitution rejected');
    }
    for (const [chainId, captured] of op.base) {
      if (this.inner.readHead(chainId) !== captured.head || this.staged.disposed.has(chainId) !== captured.disposed) {
        throw new StorageCasConflictError('changed base without publication');
      }
    }
    if (op.indexBase) {
      for (const [key, captured] of op.indexBase) {
        const current = this.inner.indexGet(key);
        const currentSig = current ? `${current.digest}:${[...current.resultIds].join(',')}` : null;
        const capturedSig = captured ? `${captured.digest}:${[...captured.resultIds].join(',')}` : null;
        if (currentSig !== capturedSig) {
          throw new StorageCasConflictError('changed base without publication');
        }
      }
    }
    const merged: AtomicUnit = {
      guards: op.fragments.flatMap((fragment) => fragment.effects.guards),
      records: op.fragments.flatMap((fragment) => fragment.effects.records),
      appends: op.fragments.flatMap((fragment) => fragment.effects.appends),
      updates: op.fragments.flatMap((fragment) => fragment.effects.updates),
      relationships: op.fragments.flatMap((fragment) => fragment.effects.relationships),
      barriers: op.fragments.flatMap((fragment) => fragment.effects.barriers),
      purgeIntents: op.fragments.flatMap((fragment) => fragment.effects.purgeIntents),
      indexWrites: op.fragments.flatMap((fragment) => fragment.effects.indexWrites),
    };
    const receipt = this.commitWithSegment(merged, {}, op.operationKey);
    op.state = 'committed';
    op.receipt = receipt;
    return { ...receipt, scope: { ...receipt.scope } };
  }

  inspectStaged(operationKey: string): StagedUnitStatus {
    this.requireOperation('read');
    const op = this.staged.units.get(operationKey);
    if (!op) throw new StorageInvalidCommandError('unknown staged operation');
    if (op.state === 'staging') return { state: 'staging', acceptedFragments: String(op.fragments.length) };
    if (op.state === 'sealed' && op.seal) return { state: 'sealed', seal: op.seal };
    if (op.state === 'committed' && op.receipt) return { state: 'committed', commitId: op.receipt.commitId };
    return { state: 'aborted', reason: op.abortReason ?? 'aborted' };
  }

  abortStaged(input: { readonly unit: StagedHandle }): void {
    this.requireOperation('write');
    const op = this.staged.units.get(input.unit.operationKey);
    if (!op || op.unitId !== input.unit.unitId) throw new StorageInvalidCommandError('unknown staged unit');
    if (op.state === 'committed') throw new StorageInvalidCommandError('committed units cannot abort');
    if (op.state === 'aborted') return;
    op.state = 'aborted';
    op.abortReason = op.operationKey;
    op.fragments.length = 0;
  }

  externalRead(after: number, limit: number): JournalReadResult {
    this.requireOperation('read');
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StorageInvalidCommandError('external reader requires a valid window');
    }
    const events = this.store.readExternal(after).slice(0, limit);
    return { events, watermark: this.store.externalWatermark() };
  }

  journalRead(consumer: string, after: number, limit: number): JournalReadResult {
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

  journalCheckpoint(consumer: string, expected: number, next: number): void {
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

  journalInspect(consumer: string): ConsumerView {
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

  journalMarkPoison(consumer: string, eventId: string, reason: string): void {
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

  journalRetry(consumer: string, expectedFailure: string): void {
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

  armExternalFailure(): void {
    this.store.armExternalFailure();
  }

  journalResync(consumer: string): { readonly snapshotRoot: string; readonly journalSeq: number } {
    this.requireOperation('write');
    let entry = this.staged.consumers.get(consumer);
    if (!entry) {
      entry = { cursor: 0, status: 'running', failedEvent: null, failedReason: null, failedSeq: null };
      this.staged.consumers.set(consumer, entry);
    }
    // §13.1-13.2: resync captures the snapshot/root and journal boundary but
    // never advances the checkpoint and never clears a poison stall. Only a
    // retry records authorized operator action; a checkpoint still cannot
    // pass an undelivered poisoned event after resync. Advancing or clearing
    // here would manufacture progress and lose events on a crash between
    // resync and snapshot consumption.
    const { tenantId, workspaceId } = this.scope;
    return { snapshotRoot: `root:${tenantId}:${workspaceId}:${this.staged.journalSeq}`, journalSeq: this.staged.journalSeq };
  }

  snapshotRead(snapshotRoot: string, after: number, limit: number): JournalReadResult {
    this.requireOperation('read');
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StorageInvalidCommandError('snapshot reader requires a valid window');
    }
    const match = /^root:([^:]+):([^:]+):(\d+)$/.exec(snapshotRoot);
    if (!match) throw new StorageInvalidCommandError('unknown snapshot root');
    const [, tenantId, workspaceId, seqRaw] = match;
    if (tenantId !== this.scope.tenantId || workspaceId !== this.scope.workspaceId) {
      throw new StorageInvalidCommandError('foreign snapshot root');
    }
    const boundary = Number(seqRaw);
    if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > this.staged.journalSeq) {
      throw new StorageInvalidCommandError('stale snapshot root');
    }
    const events = this.staged.journal.filter((event) => event.seq > after && event.seq <= boundary).slice(0, limit);
    return { events, watermark: boundary };
  }

  configureLifecycle(policy: PurgePolicy): void {
    this.requireOperation('maintain');
    this.store.setPolicy(policy);
  }

  declareCoverage(parent: string, child: string): void {
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
    if (this.isCovered(child) && !this.isCovered(parent)) {
      throw new StorageInvalidCommandError('covered child cannot escape its barrier');
    }
    this.staged.coverage.set(child, parent);
  }

  holdTarget(target: string, reason: string): void {
    this.requireOperation('maintain');
    if (typeof target !== 'string' || target.length === 0 || typeof reason !== 'string' || reason.length === 0) {
      throw new StorageInvalidCommandError('holds require a target and a reason');
    }
    this.staged.holds.set(target, reason);
  }

  releaseHold(target: string): void {
    this.requireOperation('maintain');
    if (!this.staged.holds.has(target)) throw new StorageInvalidCommandError('unknown hold');
    this.staged.holds.delete(target);
  }

  completePurge(intentId: string): PurgeJobView {
    this.requireOperation('maintain');
    const job = this.staged.jobs.get(intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge intent');
    if (job.state === 'complete') return { state: job.state, outcomeId: job.outcomeId };
    if (this.staged.holds.has(job.target)) {
      job.state = 'held';
      return { state: 'held', outcomeId: null };
    }
    const hasRecord = this.inner.readRecord(job.target) !== null;
    const hasAggregate = this.inner.readAggregate(job.target) !== null;
    if (!this.staged.chains.has(job.target) && !this.staged.blobs.has(job.target) && !hasRecord && !hasAggregate) {
      job.state = 'failed';
      return { state: 'failed', outcomeId: null };
    }
    if (this.staged.chains.has(job.target) && !this.staged.disposed.has(job.target)) {
      this.disposeChain(job.target);
    }
    if ((hasRecord || hasAggregate) && !this.staged.disposed.has(job.target)) {
      this.staged.disposed.add(job.target);
    }
    const blob = this.staged.blobs.get(job.target);
    if (blob) {
      blob.bytes = null;
      blob.owners.clear();
    }
    this.store.consumePurgeFailure();
    job.state = 'complete';
    job.outcomeId = `purge-outcome-${intentId}`;
    return { state: job.state, outcomeId: job.outcomeId };
  }

  armPurgeFailure(): void {
    this.store.armPurgeFailure();
  }

  purgeProgress(intentId: string): PurgeJobView {
    this.requireOperation('read');
    const job = this.staged.jobs.get(intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge intent');
    return { state: job.state, outcomeId: job.outcomeId };
  }

  purgeJobIds(): string[] {
    this.requireOperation('read');
    return [...this.staged.jobs.keys()];
  }

  shareBlob(blobId: string, owner: string, bytes: string): void {
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

  releaseBlob(blobId: string, owner: string): void {
    this.requireOperation('write');
    const existing = this.staged.blobs.get(blobId);
    if (!existing) throw new StorageInvalidCommandError('unknown shared blob');
    existing.owners.delete(owner);
    if (existing.owners.size === 0) existing.bytes = null;
  }

  readBlob(blobId: string): string | null {
    this.requireOperation('read');
    if (this.isCovered(blobId)) throw new StorageDeniedError('barrier covered');
    return this.staged.blobs.get(blobId)?.bytes ?? null;
  }
}
