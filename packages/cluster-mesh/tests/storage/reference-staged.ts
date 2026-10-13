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
}

export interface PurgeJobView {
  readonly state: 'pending' | 'held' | 'complete' | 'failed';
  readonly outcomeId: string | null;
}

interface PurgeJob extends PurgeJobView {
  readonly intentId: string;
  readonly target: string;
  readonly authorizedBy: string;
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
  receipt?: CommitReceipt;
  abortReason?: string;
}

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
  private purgePolicy: PurgePolicy = 'optional';
  private readonly stagedClock: TestClock;

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
    const inner = super.bind(grant);
    return new TestStagedStore(inner, this.stagedScope(inner.scope), this);
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
    return this.inner.readRecord(key);
  }

  readAggregate(key: string): ReturnType<TestBoundStore['readAggregate']> {
    this.requireOperation('read');
    if (this.isCovered(key)) throw new StorageDeniedError('barrier covered');
    return this.inner.readAggregate(key);
  }

  readChain(chainId: string): ReturnType<TestBoundStore['readChain']> {
    this.requireOperation('read');
    if (this.isCovered(chainId)) throw new StorageDeniedError('barrier covered');
    if (this.staged.disposed.has(chainId)) throw new StorageDeniedError('chain disposed');
    return this.inner.readChain(chainId);
  }

  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): ChainPage {
    const page = this.inner.readPage(chainId, limit, cursor, maxEncodedBytes);
    if (this.isCovered(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: page.nextCursor };
    if (this.staged.disposed.has(chainId)) return { outcome: 'inaccessible', records: [], nextCursor: page.nextCursor };
    return page;
  }

  disposeChain(chainId: string): void {
    this.inner.disposeChain(chainId);
    this.staged.disposed.add(chainId);
  }

  commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): CommitReceipt {
    this.requireOperation('write');
    if (options.limits) {
      const limited = validateAtomicUnit(unit, options.limits);
      if (!limited.ok) throw new StorageInvalidCommandError(limited.errors.join('; '));
    }
    if (unit.purgeIntents.length > 0 && this.store.policy === 'unconfigured') {
      throw new StorageDeniedError('purge not configured');
    }
    if (this.store.policy === 'required' && unit.barriers.length > 0 && unit.purgeIntents.length === 0) {
      throw new StorageInvalidCommandError('purge intent required with barriers');
    }
    if (options.idempotencyKey) {
      const stored = this.staged.commits.get(options.idempotencyKey);
      const unitHash = JSON.stringify(unit);
      if (stored) {
        if (stored.unitHash === unitHash) return stored.receipt;
        throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
      }
    }
    const receipt = this.inner.commitAtomic({ ...unit, barriers: [], purgeIntents: [] });
    for (const append of unit.appends) this.staged.chains.add(append.chainId);
    for (const barrier of unit.barriers) {
      this.staged.barriers.set(barrier.boundary, { reason: barrier.reason, createdAt: this.store.now() });
    }
    for (const intent of unit.purgeIntents) {
      const existing = this.staged.jobs.get(intent.intentId);
      if (existing) {
        if (existing.target !== intent.target) {
          throw new StorageIdempotencyConflictError('purge intent reused for a divergent target');
        }
      } else {
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
    this.staged.journal.push({
      seq,
      eventId: `evt-${seq}`,
      scope: { ...this.scope },
      commitId: receipt.commitId,
      operationKey: options.idempotencyKey,
      segment: this.pendingSegment ? { operationKey: this.pendingSegment, from: seq, to: seq } : undefined,
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
      return this.commitAtomic(unit, options);
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
    if (existing) return { unitId: existing.unitId, operationKey: input.operationKey };
    this.staged.unitSeq += 1;
    const op: StagedOp = {
      unitId: `unit-${this.staged.unitSeq}`,
      operationKey: input.operationKey,
      fragments: [],
      state: 'staging',
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

  inspectStaged(operationKey: string): StagedUnitStatus {
    this.requireOperation('read');
    const op = this.staged.units.get(operationKey);
    if (!op) throw new StorageInvalidCommandError('unknown staged operation');
    if (op.state === 'staging') return { state: 'staging', acceptedFragments: String(op.fragments.length) };
    if (op.state === 'sealed' && op.seal) return { state: 'sealed', seal: op.seal };
    if (op.state === 'committed' && op.receipt) return { state: 'committed', commitId: op.receipt.commitId };
    return { state: 'aborted', reason: op.abortReason ?? 'aborted' };
  }
}
