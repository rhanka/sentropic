// Test-only in-memory reference store for the K2a shared corpus.
// Implements executable K1 semantics (§5, §4): CAS-first appends, idempotent
// genesis, equal-digest index replacement, atomic units, authority checks.
// No durability, no SQL, no backend claim.

import {
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
} from '../../src/storage/errors.js';
import type { AtomicUnit, ChainExpectation, CommitOptions, CommitReceipt } from '../../src/storage/atomic.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { canOperate, validateScopeGrant } from '../../src/storage/authority.js';
import {
  createReferenceState,
  getScopeState,
  incrementAllocation,
  type ReferenceState,
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

export interface ChainPage {
  readonly outcome: 'page' | 'incomplete';
  readonly records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[];
  readonly nextCursor: number | null;
}

const defaultClock: TestClock = () => new Date().toISOString();

export class TestBoundStore {
  private readonly commitsByKey = new Map<string, CommitReceipt>();
  private commitSeq = 0;

  constructor(
    readonly grant: ScopeGrant<unknown>,
    readonly moduleId: string,
    private readonly state: ReferenceState,
    private readonly revoked: Set<string>,
    private readonly clock: TestClock,
  ) {}

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    const nowIso = this.clock();
    const validity = validateScopeGrant(this.grant, { nowIso });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (this.revoked.has(this.grant.token)) throw new StorageDeniedError('grant revoked');
    if (!canOperate(this.grant, op)) throw new StorageDeniedError(`grant lacks ${op}`);
    const scopeMismatch =
      this.grant.scope.tenantId !== this.scope.tenantId || this.grant.scope.workspaceId !== this.scope.workspaceId;
    if (scopeMismatch) throw new StorageDeniedError('cross-scope handle');
  }

  get scope() {
    return this.grant.scope;
  }

  appendChain(chainId: string, record: ChainRecordInput, expectation: ChainExpectation): AppendOutcome {
    this.requireOperation('write');
    const scopeState = getScopeState(this.state, this.scope);
    const chain = scopeState.chains.get(chainId);
    if (chain?.disposed) throw new StorageInvalidCommandError('chain disposed');
    if (expectation.kind === 'absent') {
      if (chain) throw new StorageIdempotencyConflictError('chain already exists');
      scopeState.chains.set(chainId, {
        allocation: incrementAllocation('0'),
        head: record.hash,
        records: [{ ...record, seq: 0 }],
        disposed: false,
      });
      return { seq: 0, hash: record.hash, replayed: false };
    }
    if (!chain) throw new StorageIdempotencyConflictError('missing chain for head expectation');
    if (chain.head !== expectation.hash) throw new StorageIdempotencyConflictError('stale head');
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

  readChain(chainId: string): readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] {
    this.requireOperation('read');
    return getScopeState(this.state, this.scope).chains.get(chainId)?.records ?? [];
  }

  readPage(chainId: string, limit: number, cursor: number | null, maxEncodedBytes: number): ChainPage {
    this.requireOperation('read');
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new StorageInvalidCommandError('invalid limit');
    const records = this.readChain(chainId);
    const start = cursor ?? 0;
    const page: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] = [];
    let used = 0;
    for (const record of records) {
      if (record.seq < start) continue;
      if (page.length >= limit) return { outcome: 'page', records: page, nextCursor: record.seq };
      const size = Buffer.byteLength(record.bytes, 'utf8');
      if (size > maxEncodedBytes) {
        if (page.length === 0) return { outcome: 'incomplete', records: [], nextCursor: record.seq };
        return { outcome: 'incomplete', records: page, nextCursor: record.seq };
      }
      if (used + size > maxEncodedBytes) return { outcome: 'incomplete', records: page, nextCursor: record.seq };
      used += size;
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
    if (options.idempotencyKey) {
      const replayed = this.commitsByKey.get(options.idempotencyKey);
      if (replayed) return replayed;
    }
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
    const scopeState = getScopeState(this.state, this.scope);
    for (const guard of unit.guards) {
      if (guard.kind === 'head') {
        const head = scopeState.chains.get(guard.chainId)?.head ?? null;
        if (head !== guard.hash) throw new StorageIdempotencyConflictError('guard head mismatch');
      }
      if (guard.kind === 'absent') {
        if (scopeState.chains.has(guard.chainId)) throw new StorageIdempotencyConflictError('guard absent violated');
      }
    }
    for (const append of unit.appends) {
      const chain = scopeState.chains.get(append.chainId);
      if (append.expectation.kind === 'absent' && chain) {
        throw new StorageIdempotencyConflictError('stale creation expectation');
      }
      if (append.expectation.kind === 'head' && chain?.head !== append.expectation.hash) {
        throw new StorageIdempotencyConflictError('stale head at commit');
      }
    }
    let applied = 0;
    for (const append of unit.appends) {
      const chain = scopeState.chains.get(append.chainId);
      if (!chain) {
        scopeState.chains.set(append.chainId, {
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
      const stored = scopeState.index.get(write.key);
      if (stored && stored.digest !== write.digest) {
        throw new StorageIdempotencyConflictError('index digest conflict at commit');
      }
      scopeState.index.set(write.key, { digest: write.digest, resultIds: write.resultIds, resultHash: write.resultHash });
      applied += 1;
    }
    applied += unit.records.length + unit.updates.length;
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
    if (options.idempotencyKey) this.commitsByKey.set(options.idempotencyKey, receipt);
    return receipt;
  }
}

export class TestReferenceStore {
  private readonly state = createReferenceState();
  private readonly revoked = new Set<string>();

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

  bind(grant: ScopeGrant<unknown>): TestBoundStore {
    const validity = validateScopeGrant(grant, { nowIso: this.clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (grant.moduleId !== this.moduleId) throw new StorageDeniedError('wrong module');
    if (this.revoked.has(grant.token)) throw new StorageDeniedError('grant revoked');
    return new TestBoundStore(grant, this.moduleId, this.state, this.revoked, this.clock);
  }
}
