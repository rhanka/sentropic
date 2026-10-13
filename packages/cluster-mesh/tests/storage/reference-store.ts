// Test-only in-memory reference store for the K2a shared corpus.
// Implements executable K1 semantics (L3a v4.1 frozen §5, §4): CAS-first
// appends, idempotent genesis, equal-digest index replacement, atomic units,
// authority checks. No durability, no SQL, no backend claim.

import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from '../../src/storage/errors.js';
import type { AtomicUnit, ChainExpectation, CommitOptions, CommitReceipt } from '../../src/storage/atomic.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { canOperate, validateScopeGrant } from '../../src/storage/authority.js';
import {
  createReferenceState,
  getScopeState,
  incrementAllocation,
  type ReferenceState,
  type TestChainState,
} from './reference-state.js';

export type TestClock = () => string;

export interface ChainRecordInput {
  readonly id: string;
  readonly bytes: string;
  readonly hash: string;
}

export interface AppendOutcome {
  readonly seq: number;
  readonly hash: string;
  readonly replayed: boolean;
}

export interface ChainPageCursor {
  readonly position: number;
  readonly head: string | null;
}

export interface ChainPage {
  readonly outcome: 'page' | 'incomplete' | 'inaccessible';
  readonly records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[];
  readonly nextCursor: ChainPageCursor | null;
}

const defaultClock: TestClock = () => new Date().toISOString();

// Grants are JSON-serializable DTOs: the bound handle keeps a deeply frozen
// copy so a caller-side mutation after binding can never escalate authority
// or switch scope (§4.1, §4.3).
const deepCopyGrant = (grant: ScopeGrant<unknown>): ScopeGrant<unknown> =>
  JSON.parse(JSON.stringify(grant)) as ScopeGrant<unknown>;

const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) deepFreeze(entry);
  Object.freeze(value);
};

const encodedPageBytes = (
  outcome: string,
  records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[],
  nextCursor: ChainPageCursor | null,
): number => Buffer.byteLength(JSON.stringify({ outcome, records, nextCursor }), 'utf8');

export class TestBoundStore {
  readonly grant: ScopeGrant<unknown>;
  private readonly boundScope: { readonly tenantId: string; readonly workspaceId: string };
  private commitSeq = 0;

  constructor(
    grant: ScopeGrant<unknown>,
    readonly moduleId: string,
    private readonly state: ReferenceState,
    private readonly revoked: Set<string>,
    private readonly clock: TestClock,
  ) {
    const copy = deepCopyGrant(grant);
    deepFreeze(copy);
    this.grant = copy;
    this.boundScope = { tenantId: copy.scope.tenantId, workspaceId: copy.scope.workspaceId };
  }

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    const nowIso = this.clock();
    const validity = validateScopeGrant(this.grant, { nowIso });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (this.revoked.has(this.grant.token)) throw new StorageDeniedError('grant revoked');
    if (!canOperate(this.grant, op)) throw new StorageDeniedError(`grant lacks ${op}`);
    const scopeMismatch =
      this.grant.scope.tenantId !== this.boundScope.tenantId ||
      this.grant.scope.workspaceId !== this.boundScope.workspaceId;
    if (scopeMismatch) throw new StorageDeniedError('cross-scope handle');
  }

  get scope() {
    return this.boundScope;
  }

  appendChain(chainId: string, record: ChainRecordInput, expectation: ChainExpectation): AppendOutcome {
    this.requireOperation('write');
    const scopeState = getScopeState(this.state, this.scope);
    const chain = scopeState.chains.get(chainId);
    if (chain?.disposed) throw new StorageInvalidCommandError('chain disposed');
    if (expectation.kind === 'absent') {
      if (expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected allocation for creation');
      if (chain) throw new StorageIdempotencyConflictError('chain already exists');
      scopeState.chains.set(chainId, {
        allocation: incrementAllocation('0'),
        head: record.hash,
        records: [{ ...record, seq: 0 }],
        disposed: false,
      });
      return { seq: 0, hash: record.hash, replayed: false };
    }
    if (!chain) throw new StorageCasConflictError('missing chain for head expectation');
    if (chain.head !== expectation.hash) throw new StorageCasConflictError('stale head');
    const seq = chain.records.length;
    chain.records.push({ ...record, seq });
    chain.head = record.hash;
    chain.allocation = incrementAllocation(chain.allocation);
    return { seq, hash: record.hash, replayed: false };
  }

  genesis(kind: string, id: string, hash: string, value: unknown): { readonly hash: string; readonly replayed: boolean } {
    this.requireOperation('write');
    const scopeState = getScopeState(this.state, this.scope);
    const key = `${kind}:${id}`;
    const stored = scopeState.genesis.get(key);
    if (stored) {
      if (stored.hash === hash) return { hash, replayed: true };
      throw new StorageIdempotencyConflictError('genesis hash conflict');
    }
    scopeState.genesis.set(key, { hash, value });
    return { hash, replayed: false };
  }

  indexGet(key: string): { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).index.get(key) ?? null;
  }

  indexPut(key: string, entry: { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null }): 'insert' | 'replace' {
    this.requireOperation('write');
    const scopeState = getScopeState(this.state, this.scope);
    const stored = scopeState.index.get(key);
    if (!stored) {
      scopeState.index.set(key, entry);
      return 'insert';
    }
    if (stored.digest === entry.digest) {
      scopeState.index.set(key, entry);
      return 'replace';
    }
    throw new StorageIdempotencyConflictError('index digest conflict');
  }

  readHead(chainId: string): string | null {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).chains.get(chainId)?.head ?? null;
  }

  readRecord(key: string): { readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).records.get(key) ?? null;
  }

  readAggregate(key: string): { readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).aggregates.get(key) ?? null;
  }

  readChain(chainId: string): readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).chains.get(chainId)?.records ?? [];
  }

  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): ChainPage {
    this.requireOperation('read');
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new StorageInvalidCommandError('invalid limit');
    let start = 0;
    let cursorHead: string | null = null;
    let retained: ChainPageCursor | null = null;
    if (cursor !== null && cursor !== undefined) {
      if (typeof cursor !== 'object' || cursor === null) throw new StorageInvalidCommandError('invalid cursor');
      const candidate = cursor as { readonly position?: unknown; readonly head?: unknown };
      if (!Number.isSafeInteger(candidate.position) || (candidate.position as number) < 0) {
        throw new StorageInvalidCommandError('invalid cursor');
      }
      if (typeof candidate.head !== 'string' || candidate.head.length === 0) {
        throw new StorageInvalidCommandError('invalid cursor');
      }
      start = candidate.position as number;
      cursorHead = candidate.head;
      retained = { position: start, head: cursorHead };
    }
    const scopeState = getScopeState(this.state, this.scope);
    const chain = scopeState.chains.get(chainId);
    if (chain?.disposed) return { outcome: 'inaccessible', records: [], nextCursor: retained };
    const records = chain?.records ?? [];
    const boundHead = cursorHead ?? chain?.head ?? null;
    const boundIdx = boundHead === null ? records.length : records.findIndex((entry) => entry.hash === boundHead);
    if (boundHead !== null && boundIdx === -1) {
      return { outcome: 'incomplete', records: [], nextCursor: retained };
    }
    const visible = boundHead === null ? [] : records.slice(0, boundIdx + 1);
    const page: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] = [];
    for (const record of visible) {
      if (record.seq < start) continue;
      const next: ChainPageCursor = { position: record.seq, head: boundHead as string };
      if (page.length >= limit) return { outcome: 'page', records: page, nextCursor: next };
      if (encodedPageBytes('page', [...page, record], next) > maxEncodedBytes) {
        if (page.length === 0) return { outcome: 'incomplete', records: [], nextCursor: next };
        return { outcome: 'incomplete', records: page, nextCursor: next };
      }
      page.push(record);
    }
    return { outcome: 'page', records: page, nextCursor: null };
  }

  disposeChain(chainId: string): void {
    this.requireOperation('maintain');
    const scopeState = getScopeState(this.state, this.scope);
    const chain = scopeState.chains.get(chainId);
    if (!chain) throw new StorageInvalidCommandError('unknown chain');
    chain.disposed = true;
  }

  commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): CommitReceipt {
    this.requireOperation('write');
    const scopeState = getScopeState(this.state, this.scope);
    const unitHash = JSON.stringify(unit);
    if (options.idempotencyKey) {
      const stored = scopeState.commits.get(options.idempotencyKey);
      if (stored) {
        if (stored.unitHash === unitHash) return stored.receipt;
        throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
      }
    }
    if (unit.relationships.length > 0) {
      throw new StorageInvalidCommandError('relationships unsupported in the K2a reference');
    }
    if (unit.barriers.length > 0) throw new UnsupportedProfileError('visibility-barriers-v1');
    if (unit.purgeIntents.length > 0) throw new UnsupportedProfileError('purge-jobs-v1');
    if (
      unit.records.length === 0 &&
      unit.appends.length === 0 &&
      unit.updates.length === 0 &&
      unit.indexWrites.length === 0 &&
      unit.relationships.length === 0 &&
      unit.barriers.length === 0 &&
      unit.purgeIntents.length === 0
    ) {
      throw new StorageInvalidCommandError('empty unit');
    }
    for (const guard of unit.guards) {
      if (guard.kind === 'head') {
        const head = scopeState.chains.get(guard.chainId)?.head ?? null;
        if (head !== guard.hash) throw new StorageCasConflictError('guard head mismatch');
      }
      if (guard.kind === 'absent') {
        if (scopeState.chains.has(guard.chainId)) throw new StorageIdempotencyConflictError('guard absent violated');
      }
      if (guard.kind === 'aggregate-version') {
        const stored = scopeState.aggregates.get(guard.key);
        if (stored?.version !== guard.version) throw new StorageCasConflictError('guard aggregate version mismatch');
      }
      if (guard.kind === 'predicate') {
        throw new StorageInvalidCommandError('predicate guards unsupported in the K2a reference');
      }
    }
    for (const append of unit.appends) {
      const chain = scopeState.chains.get(append.chainId);
      if (append.expectation.kind === 'absent') {
        if (append.expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected allocation at commit');
        if (chain) throw new StorageIdempotencyConflictError('stale creation expectation');
      }
      if (append.expectation.kind === 'head' && chain?.head !== append.expectation.hash) {
        throw new StorageCasConflictError('stale head at commit');
      }
    }
    const stagedChains = new Map<string, TestChainState>();
    for (const [id, chain] of scopeState.chains) {
      stagedChains.set(id, { allocation: chain.allocation, head: chain.head, records: [...chain.records], disposed: chain.disposed });
    }
    const stagedIndex = new Map(scopeState.index);
    const stagedRecords = new Map(scopeState.records);
    const stagedAggregates = new Map(scopeState.aggregates);
    let applied = 0;
    for (const append of unit.appends) {
      const chain = stagedChains.get(append.chainId);
      if (chain?.disposed) throw new StorageInvalidCommandError('chain disposed at commit');
      if (!chain) {
        stagedChains.set(append.chainId, {
          allocation: incrementAllocation('0'),
          head: append.record.hash,
          records: [{ id: append.record.id, seq: 0, hash: append.record.hash, bytes: append.record.bytes }],
          disposed: false,
        });
      } else {
        const seq = chain.records.length;
        chain.records.push({ id: append.record.id, seq, hash: append.record.hash, bytes: append.record.bytes });
        chain.head = append.record.hash;
        chain.allocation = incrementAllocation(chain.allocation);
      }
      applied += 1;
    }
    for (const write of unit.indexWrites) {
      const stored = stagedIndex.get(write.key);
      if (stored && stored.digest !== write.digest) {
        throw new StorageIdempotencyConflictError('index digest conflict at commit');
      }
      stagedIndex.set(write.key, { digest: write.digest, resultIds: write.resultIds, resultHash: write.resultHash });
      applied += 1;
    }
    for (const record of unit.records) {
      const stored = stagedRecords.get(record.key);
      if (stored && stored.contentHash !== record.contentHash) {
        throw new StorageIdempotencyConflictError('record hash conflict at commit');
      }
      stagedRecords.set(record.key, { bytes: record.bytes, contentHash: record.contentHash });
    }
    for (const update of unit.updates) {
      const stored = stagedAggregates.get(update.key);
      if (stored && update.version <= stored.version) {
        throw new StorageCasConflictError('stale aggregate version at commit');
      }
      stagedAggregates.set(update.key, { version: update.version, value: update.value });
    }
    applied += unit.records.length + unit.updates.length;
    scopeState.chains.clear();
    for (const [id, chain] of stagedChains) scopeState.chains.set(id, chain);
    scopeState.index.clear();
    for (const [key, entry] of stagedIndex) scopeState.index.set(key, entry);
    scopeState.records.clear();
    for (const [key, entry] of stagedRecords) scopeState.records.set(key, entry);
    scopeState.aggregates.clear();
    for (const [key, entry] of stagedAggregates) scopeState.aggregates.set(key, entry);
    this.commitSeq += 1;
    const receipt: CommitReceipt = {
      commitId: `commit-${this.commitSeq}`,
      moduleId: this.moduleId,
      scope: { ...this.scope },
      committedAt: this.clock(),
      effectiveRecords: applied,
      effectiveAppends: unit.appends.length,
      journalCursor: `cursor-${this.commitSeq}`,
    };
    if (options.idempotencyKey) scopeState.commits.set(options.idempotencyKey, { receipt, unitHash });
    return receipt;
  }
}

export class TestReferenceStore {
  private readonly state = createReferenceState();
  private readonly revoked = new Set<string>();
  private readonly issued = new Map<string, string>();

  constructor(
    readonly moduleId: string,
    private readonly clock: TestClock = defaultClock,
  ) {
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new StorageInvalidCommandError('reference store requires a moduleId');
    }
  }

  revoke(token: string): void {
    this.revoked.add(token);
  }

  issueGrant(grant: ScopeGrant<unknown>): ScopeGrant<unknown> {
    this.issued.set(grant.token, JSON.stringify(grant));
    return grant;
  }

  bindNew(grant: ScopeGrant<unknown>): TestBoundStore {
    return this.bind(this.issueGrant(grant));
  }

  bind(grant: ScopeGrant<unknown>): TestBoundStore {
    const validity = validateScopeGrant(grant, { nowIso: this.clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (grant.moduleId !== this.moduleId) throw new StorageDeniedError('wrong module');
    if (this.revoked.has(grant.token)) throw new StorageDeniedError('grant revoked');
    const issued = this.issued.get(grant.token);
    if (!issued) throw new StorageDeniedError('unknown grant token');
    if (issued !== JSON.stringify(grant)) throw new StorageDeniedError('grant tampered');
    return new TestBoundStore(grant, this.moduleId, this.state, this.revoked, this.clock);
  }
}
