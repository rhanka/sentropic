// K3 ordinary record runtime (L3a v4.1 frozen §5): CAS-first appends,
// allocation, disposal guards, idempotent genesis/index, aggregate versions,
// predicate-positive acceptance, barrier/purge/relationship refusal, full
// rollback, R3 effective-cursor paging. Data ops; authority stays out.

import {
  StorageCasConflictError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from './errors.js';
import {
  validateAtomicUnit,
  validateCommitOptions,
  type AtomicUnit,
  type ChainExpectation,
  type CommitOptions,
  type CommitReceipt,
} from './atomic.js';
import { incrementBackendAllocation, type BackendScopeState } from './backend.js';
import type { ChainBoundaryProvider } from './tokens.js';

export interface ChainRecordInput {
  readonly id: string;
  readonly bytes: string;
  readonly hash: string;
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export const appendChainToScope = (
  state: BackendScopeState,
  chainId: string,
  record: ChainRecordInput,
  expectation: ChainExpectation,
): { readonly seq: number; readonly hash: string; readonly replayed: false } => {
  const chain = state.chains.get(chainId);
  if (chain?.disposed) throw new StorageInvalidCommandError('chain disposed');
  if (expectation.kind === 'absent') {
    if (expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected allocation for creation');
    if (chain) throw new StorageIdempotencyConflictError('chain already exists');
    state.chains.set(chainId, { allocation: incrementBackendAllocation('0'), head: record.hash, records: [{ ...record, seq: 0 }], disposed: false });
    return { seq: 0, hash: record.hash, replayed: false };
  }
  if (!chain) throw new StorageCasConflictError('missing chain for head expectation');
  if (chain.head !== expectation.hash) throw new StorageCasConflictError('stale head');
  const seq = chain.records.length;
  chain.records.push({ ...record, seq });
  chain.head = record.hash;
  chain.allocation = incrementBackendAllocation(chain.allocation);
  return { seq, hash: record.hash, replayed: false };
};

export const genesisToScope = (state: BackendScopeState, kind: string, id: string, hash: string, value: unknown) => {
  const key = `${kind}:${id}`;
  const stored = state.genesis.get(key);
  if (stored) {
    if (stored.hash === hash) return { hash, replayed: true as const };
    throw new StorageIdempotencyConflictError('genesis hash conflict');
  }
  state.genesis.set(key, { hash, value });
  return { hash, replayed: false as const };
};

export const disposeChainInScope = (state: BackendScopeState, chainId: string): void => {
  const chain = state.chains.get(chainId);
  if (!chain) throw new StorageInvalidCommandError('unknown chain');
  chain.disposed = true;
};

const pageBytes = (outcome: string, records: readonly unknown[], nextCursor: unknown): number =>
  Buffer.byteLength(JSON.stringify({ outcome, records, nextCursor }), 'utf8');

export interface ReadPageResult {
  readonly outcome: 'page' | 'incomplete' | 'inaccessible';
  readonly records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[];
  readonly nextCursor: { readonly position: number; readonly head: string } | null;
}

export const readPageFromScope = (
  state: BackendScopeState,
  chainId: string,
  limit: number,
  cursor: unknown,
  maxEncodedBytes: number,
  opts: { readonly moduleId: string; readonly scope: { readonly tenantId: string; readonly workspaceId: string }; readonly incarnation: string; readonly provider: ChainBoundaryProvider },
): ReadPageResult => {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new StorageInvalidCommandError('invalid limit');
  let start = 0;
  let cursorHead: string | null = null;
  let retained: { readonly position: number; readonly head: string } | null = null;
  if (cursor !== null && cursor !== undefined) {
    const verified = opts.provider.verify(chainId, cursor, { moduleId: opts.moduleId, scope: opts.scope, incarnation: opts.incarnation });
    if (!verified) throw new StorageInvalidCommandError('invalid cursor');
    start = verified.position;
    cursorHead = verified.head;
    retained = verified;
  }
  const chain = state.chains.get(chainId);
  if (chain?.disposed) return { outcome: 'inaccessible', records: [], nextCursor: retained };
  const records = chain?.records ?? [];
  const boundHead = cursorHead ?? chain?.head ?? null;
  if (boundHead === null) return { outcome: 'page', records: [], nextCursor: null };
  const boundIdx = records.findIndex((entry) => entry.hash === boundHead);
  if (boundIdx === -1) return { outcome: 'incomplete', records: [], nextCursor: retained };
  const mint = (position: number): { readonly position: number; readonly head: string } =>
    opts.provider.mint({ moduleId: opts.moduleId, scope: opts.scope, incarnation: opts.incarnation, selection: chainId, position, head: boundHead });
  const fit = (kept: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[], recovery: { readonly position: number; readonly head: string } | null): ReadPageResult => {
    const trimmed = [...kept];
    while (trimmed.length > 0 && pageBytes('incomplete', trimmed, recovery) > maxEncodedBytes) trimmed.pop();
    return { outcome: 'incomplete', records: trimmed, nextCursor: recovery };
  };
  const page: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] = [];
  let admitted: { readonly position: number; readonly head: string } | null = retained;
  for (const record of records.slice(0, boundIdx + 1)) {
    if (record.seq < start) continue;
    const next = mint(record.seq);
    if (page.length >= limit) {
      if (pageBytes('page', page, next) > maxEncodedBytes) return fit(page, admitted ?? retained ?? next);
      return { outcome: 'page', records: page, nextCursor: next };
    }
    if (pageBytes('page', [...page, record], next) > maxEncodedBytes) return fit(page, next);
    page.push(record);
    admitted = next;
  }
  return { outcome: 'page', records: page, nextCursor: null };
};

export const commitAtomicToScope = (
  state: BackendScopeState,
  unit: AtomicUnit,
  options: CommitOptions,
  ctx: { readonly moduleId: string; readonly scope: { readonly tenantId: string; readonly workspaceId: string }; readonly clock: () => string; readonly commitId: string },
): CommitReceipt => {
  if (!validateAtomicUnit(unit, options.limits).ok || !validateCommitOptions(options).ok) {
    throw new StorageInvalidCommandError('invalid unit or options');
  }
  const unitHash = JSON.stringify(unit);
  if (options.idempotencyKey) {
    const stored = state.commits.get(options.idempotencyKey);
    if (stored) {
      if (stored.unitHash === unitHash) return stored.receipt;
      throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
    }
  }
  if (unit.relationships.length > 0) throw new StorageInvalidCommandError('relationships unsupported in the K3 ordinary runtime');
  if (unit.barriers.length > 0) throw new UnsupportedProfileError('visibility-barriers-v1');
  if (unit.purgeIntents.length > 0) throw new UnsupportedProfileError('purge-jobs-v1');
  if (unit.records.length + unit.appends.length + unit.updates.length + unit.indexWrites.length === 0) {
    throw new StorageInvalidCommandError('empty unit');
  }
  for (const guard of unit.guards) {
    if (guard.kind === 'head' && (state.chains.get(guard.chainId)?.head ?? null) !== guard.hash) {
      throw new StorageCasConflictError('guard head mismatch');
    }
    if (guard.kind === 'absent' && state.chains.has(guard.chainId)) throw new StorageIdempotencyConflictError('guard absent violated');
    if (guard.kind === 'aggregate-version' && state.aggregates.get(guard.key)?.version !== guard.version) {
      throw new StorageCasConflictError('guard aggregate version mismatch');
    }
    if (guard.kind === 'predicate' && (!nonEmpty(guard.predicateId) || !nonEmpty(guard.dependency))) {
      throw new StorageInvalidCommandError('predicate guard requires an id and dependency');
    }
  }
  for (const append of unit.appends) {
    const chain = state.chains.get(append.chainId);
    if (append.expectation.kind === 'absent') {
      if (append.expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected allocation at commit');
      if (chain) throw new StorageIdempotencyConflictError('stale creation expectation');
    } else if (chain?.head !== append.expectation.hash) throw new StorageCasConflictError('stale head at commit');
  }
  const stagedChains = new Map([...state.chains].map(([id, chain]) => [id, { allocation: chain.allocation, head: chain.head, records: [...chain.records], disposed: chain.disposed }]));
  const stagedIndex = new Map(state.index);
  const stagedRecords = new Map(state.records);
  const stagedAggregates = new Map(state.aggregates);
  for (const append of unit.appends) {
    const chain = stagedChains.get(append.chainId);
    if (chain?.disposed) throw new StorageInvalidCommandError('chain disposed at commit');
    if (!chain) {
      stagedChains.set(append.chainId, { allocation: incrementBackendAllocation('0'), head: append.record.hash, records: [{ id: append.record.id, seq: 0, hash: append.record.hash, bytes: append.record.bytes }], disposed: false });
    } else {
      const seq = chain.records.length;
      chain.records.push({ id: append.record.id, seq, hash: append.record.hash, bytes: append.record.bytes });
      chain.head = append.record.hash;
      chain.allocation = incrementBackendAllocation(chain.allocation);
    }
  }
  for (const write of unit.indexWrites) {
    const stored = stagedIndex.get(write.key);
    if (stored && stored.digest !== write.digest) throw new StorageIdempotencyConflictError('index digest conflict at commit');
    stagedIndex.set(write.key, { digest: write.digest, resultIds: write.resultIds, resultHash: write.resultHash });
  }
  for (const record of unit.records) {
    const stored = stagedRecords.get(record.key);
    if (stored && stored.contentHash !== record.contentHash) throw new StorageIdempotencyConflictError('record hash conflict at commit');
    stagedRecords.set(record.key, { bytes: record.bytes, contentHash: record.contentHash });
  }
  for (const update of unit.updates) {
    const stored = stagedAggregates.get(update.key);
    if (stored && update.version <= stored.version) throw new StorageCasConflictError('stale aggregate version at commit');
    stagedAggregates.set(update.key, { version: update.version, value: update.value });
  }
  state.chains.clear();
  for (const [id, chain] of stagedChains) state.chains.set(id, chain);
  state.index.clear();
  for (const [key, entry] of stagedIndex) state.index.set(key, entry);
  state.records.clear();
  for (const [key, entry] of stagedRecords) state.records.set(key, entry);
  state.aggregates.clear();
  for (const [key, entry] of stagedAggregates) state.aggregates.set(key, entry);
  const receipt: CommitReceipt = { commitId: ctx.commitId, moduleId: ctx.moduleId, scope: { ...ctx.scope }, committedAt: ctx.clock(), effectiveRecords: unit.appends.length + unit.records.length + unit.updates.length, effectiveAppends: unit.appends.length, journalCursor: `cursor-${ctx.commitId}` };
  if (options.idempotencyKey) state.commits.set(options.idempotencyKey, { receipt, unitHash });
  return receipt;
};
