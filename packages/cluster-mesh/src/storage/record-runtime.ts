// K3 ordinary record runtime (L3a v4.1 frozen §5): CAS-first appends,
// allocation, disposal guards, idempotent genesis/index, aggregate versions,
// evaluated predicates, barrier/purge/relationship refusal, full rollback,
// R3 effective-cursor paging. Data ops; authority stays out.

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
import { validateEncodedValue } from './contracts.js';
import { incrementBackendAllocation, type BackendScopeState } from './backend.js';
import { isUnknownCursorBoundary, type ChainBoundaryProvider } from './tokens.js';

export interface ChainRecordInput {
  readonly id: string;
  readonly bytes: string;
  readonly hash: string;
}

/** Read-only state view handed to predicate evaluators: base state plus the
 * writes staged so far, so evaluation sees read-your-writes (§5.5). */
export interface PredicateView {
  readHead(chainId: string): string | null;
  hasChain(chainId: string): boolean;
  readRecord(key: string): {
    readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string };
    readonly contentHash: string;
  } | null;
  readAggregateVersion(key: string): number | undefined;
}

export interface PredicateContext {
  readonly moduleId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly predicateId: string;
  readonly view: PredicateView;
}

/** Predicates are bound to scope and state (§4.1, §5.3): the dependency
 * stays the first argument, and the second carries module, scope and the
 * staged-state view. Evaluators ignoring the context keep working. */
export type PredicateEvaluator = (dependency: string, ctx: PredicateContext) => boolean;

export interface CommitContext {
  readonly moduleId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly clock: () => string;
  readonly commitId: string;
  readonly predicates?: Readonly<Record<string, PredicateEvaluator>>;
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
  // The canonical copy is detached: later caller-side mutation of the input
  // value cannot change committed genesis state (Sol-3).
  state.genesis.set(key, { hash, value: JSON.parse(JSON.stringify(value)) as unknown });
  return { hash, replayed: false as const };
};

export const disposeChainInScope = (state: BackendScopeState, chainId: string): void => {
  const chain = state.chains.get(chainId);
  if (!chain) throw new StorageInvalidCommandError('unknown chain');
  chain.disposed = true;
  // Physical disposal erases payload bytes while retaining the permitted
  // status surface: identity, sequence, hashes, head and allocation (§5.3,
  // §5.4). No getter renders disposed content, and commit-time copies can no
  // longer duplicate the erased bytes (m9).
  chain.records = chain.records.map((entry) => ({ ...entry, bytes: '' }));
};

const pageBytes = (outcome: string, records: readonly unknown[], nextCursor: unknown): number =>
  Buffer.byteLength(JSON.stringify({ outcome, records, nextCursor }), 'utf8');

export interface ReadPageResult {
  readonly outcome: 'page' | 'incomplete' | 'inaccessible';
  readonly records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[];
  readonly nextCursor: string | null;
}

type PageRecord = { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string };

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
  let cursorSeq = -1;
  let cursorAllocation: string | null = null;
  let retained: string | null = null;
  if (cursor !== null && cursor !== undefined) {
    const verified = opts.provider.verify(chainId, cursor, { moduleId: opts.moduleId, scope: opts.scope, incarnation: opts.incarnation });
    if (verified === null) throw new StorageInvalidCommandError('invalid cursor');
    // §8.2 changed incarnation or retired key: an explicit incomplete result
    // with no recovery position. Never invalid-command, never the latest head.
    if (isUnknownCursorBoundary(verified)) return { outcome: 'incomplete', records: [], nextCursor: null };
    start = verified.position;
    cursorHead = verified.head;
    cursorSeq = verified.seq;
    cursorAllocation = verified.allocation;
    retained = cursor as string;
  }
  const chain = state.chains.get(chainId);
  // Physical disposal leaks no continuation: the retained cursor dies here.
  if (chain?.disposed) return { outcome: 'inaccessible', records: [], nextCursor: null };
  const records = chain?.records ?? [];
  // The immutable boundary is the terminal record sealed at mint time: exact
  // head hash plus sequence plus allocation (§8.2). Without a cursor the
  // boundary is the current terminal record.
  const terminal = records.length === 0 ? null : records[records.length - 1];
  const boundHead = cursorHead ?? terminal?.hash ?? null;
  const boundSeq = cursorHead === null ? (terminal?.seq ?? -1) : cursorSeq;
  const boundAllocation = cursorHead === null ? (terminal === null ? null : (chain?.allocation ?? null)) : cursorAllocation;
  if (boundHead === null || boundAllocation === null) return { outcome: 'page', records: [], nextCursor: null };
  // Allocation only grows: a smaller live allocation means the sealed
  // boundary is unavailable here (partial rebuild after a restart).
  if (chain !== undefined && Number.isSafeInteger(Number(chain.allocation)) && Number.isSafeInteger(Number(boundAllocation)) && Number(chain.allocation) < Number(boundAllocation)) {
    return { outcome: 'incomplete', records: [], nextCursor: null };
  }
  // Exact terminal identity: sequence plus hash. A repeated hash (§9.3
  // CAS-only chains) resolves to its sealed occurrence, never the first one.
  const boundIdx = records.findIndex((entry) => entry.seq === boundSeq && entry.hash === boundHead);
  if (boundIdx === -1) {
    // The sealed boundary is absent (resync pending): the retained cursor is
    // the recovery position, kept only when it fits the budget (Sol-6/m5).
    if (retained !== null && pageBytes('incomplete', [], retained) > maxEncodedBytes) {
      return { outcome: 'incomplete', records: [], nextCursor: null };
    }
    return { outcome: 'incomplete', records: [], nextCursor: retained };
  }
  const mint = (position: number): string =>
    opts.provider.mint({ moduleId: opts.moduleId, scope: opts.scope, incarnation: opts.incarnation, selection: chainId, position, head: boundHead, seq: boundSeq, allocation: boundAllocation });
  // R3 (§8.4): the surviving cursor is always a recovery position for the
  // first undelivered record (start + delivered count), recomputed after
  // every trim. When even the empty page plus its recovery cursor overflows
  // the budget, the floor is an empty page with a null cursor.
  const fit = (kept: PageRecord[], recoveryStart: number): ReadPageResult => {
    const trimmed = [...kept];
    const recoveryFor = (delivered: number): string | null =>
      boundHead === null ? null : mint(recoveryStart + delivered);
    while (trimmed.length > 0 && pageBytes('incomplete', trimmed, recoveryFor(trimmed.length)) > maxEncodedBytes) {
      trimmed.pop();
    }
    // K2b r3 floor (reference-store.ts): an emptied page carries no retained
    // cursor. The caller already holds its resume position (the recovery for
    // zero delivered records is the input cursor), so echoing it adds no
    // recovery information and risks exceeding the byte floor.
    if (trimmed.length === 0) return { outcome: 'incomplete', records: trimmed, nextCursor: null };
    let recovery = recoveryFor(trimmed.length);
    if (recovery !== null && pageBytes('incomplete', trimmed, recovery) > maxEncodedBytes) recovery = null;
    return { outcome: 'incomplete', records: trimmed, nextCursor: recovery };
  };
  const page: PageRecord[] = [];
  // Chains are sequence-dense by construction (both append paths assign
  // seq = records.length), so paging starts at the resume position instead
  // of scanning from index 0, and the record after the current one is an
  // O(1) neighbour lookup instead of a slice-plus-find per admitted record.
  for (let index = Math.max(start, 0); index <= boundIdx; index += 1) {
    const record = records[index];
    if (record.seq < start) continue;
    if (page.length >= limit) {
      // The page is full: the current record is the first undelivered one.
      const next = mint(record.seq);
      if (pageBytes('page', page, next) > maxEncodedBytes) return fit(page, start);
      return { outcome: 'page', records: page, nextCursor: next };
    }
    // Admission is measured with the effective returned cursor: the token of
    // the first record after this one, or null when this record ends the
    // bound. A trailing record that fits with a null cursor is a page.
    const following = index + 1 <= boundIdx ? records[index + 1] : null;
    const effective = following === null ? null : mint(following.seq);
    if (pageBytes('page', [...page, { ...record }], effective) > maxEncodedBytes) return fit(page, start);
    page.push({ ...record });
  }
  return { outcome: 'page', records: page, nextCursor: null };
};

export const mergeAtomicUnits = (units: readonly AtomicUnit[]): AtomicUnit => ({
  guards: units.flatMap((unit) => unit.guards),
  records: units.flatMap((unit) => unit.records),
  appends: units.flatMap((unit) => unit.appends),
  updates: units.flatMap((unit) => unit.updates),
  relationships: units.flatMap((unit) => unit.relationships),
  barriers: units.flatMap((unit) => unit.barriers),
  purgeIntents: units.flatMap((unit) => unit.purgeIntents),
  indexWrites: units.flatMap((unit) => unit.indexWrites),
  ...(units.some((unit) => unit.moduleResult) ? { moduleResult: units.find((unit) => unit.moduleResult)?.moduleResult } : {}),
});

interface StagedCommit {
  readonly chains: Map<string, { allocation: string; head: string | null; records: PageRecord[]; disposed: boolean }>;
  readonly index: Map<string, { digest: string; resultIds: readonly string[]; resultHash: string | null }>;
  readonly records: Map<string, { bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; contentHash: string }>;
  readonly aggregates: Map<string, { version: number; value: { readonly format: 'utf8' | 'base64'; readonly data: string } }>;
}

const stagedView = (staged: StagedCommit): PredicateView => ({
  readHead: (chainId: string): string | null => staged.chains.get(chainId)?.head ?? null,
  hasChain: (chainId: string): boolean => staged.chains.has(chainId),
  readRecord: (key: string) => {
    const stored = staged.records.get(key);
    if (!stored) return null;
    return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
  },
  readAggregateVersion: (key: string): number | undefined => staged.aggregates.get(key)?.version,
});

const checkGuards = (guards: AtomicUnit['guards'], staged: StagedCommit, ctx: CommitContext): void => {
  for (const guard of guards) {
    if (guard.kind === 'head') {
      if ((staged.chains.get(guard.chainId)?.head ?? null) !== guard.hash) {
        throw new StorageCasConflictError('guard head mismatch');
      }
    } else if (guard.kind === 'absent') {
      if (staged.chains.has(guard.chainId)) throw new StorageIdempotencyConflictError('guard absent violated');
    } else if (guard.kind === 'aggregate-version') {
      if (staged.aggregates.get(guard.key)?.version !== guard.version) {
        throw new StorageCasConflictError('guard aggregate version mismatch');
      }
    } else if (guard.kind === 'predicate') {
      // Registered predicates are evaluated against scope and staged state;
      // nothing is accepted unevaluated.
      if (!nonEmpty(guard.predicateId) || !nonEmpty(guard.dependency)) {
        throw new StorageInvalidCommandError('predicate guard requires an id and dependency');
      }
      const evaluator = ctx.predicates?.[guard.predicateId];
      if (!evaluator) throw new UnsupportedProfileError(`predicate:${guard.predicateId}`);
      if (
        !evaluator(guard.dependency, {
          moduleId: ctx.moduleId,
          scope: { tenantId: ctx.scope.tenantId, workspaceId: ctx.scope.workspaceId },
          predicateId: guard.predicateId,
          view: stagedView(staged),
        })
      ) {
        throw new StorageCasConflictError('predicate guard mismatch');
      }
    } else {
      // Unknown guard kinds fail closed: an unrecognized discriminant must
      // never let its carrier commit (Sol-5).
      throw new StorageInvalidCommandError(`unknown guard kind:${(guard as { readonly kind?: unknown }).kind}`);
    }
  }
};

const stageEffects = (unit: AtomicUnit, staged: StagedCommit, state: BackendScopeState): void => {
  // Clone-on-touch (m6): untouched chains keep sharing the canonical arrays;
  // only the first write to a chain detaches its entry.
  const touched = new Set<string>();
  const touchChain = (chainId: string) => {
    const current = staged.chains.get(chainId);
    if (current === undefined || touched.has(chainId)) return current;
    touched.add(chainId);
    if (state.chains.get(chainId) === current) {
      const detached = { ...current, records: [...current.records] };
      staged.chains.set(chainId, detached);
      return detached;
    }
    return current;
  };
  for (const append of unit.appends) {
    const chain = touchChain(append.chainId);
    if (append.expectation.kind === 'absent') {
      if (append.expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected allocation at commit');
      if (chain) throw new StorageIdempotencyConflictError('stale creation expectation');
      staged.chains.set(append.chainId, { allocation: incrementBackendAllocation('0'), head: append.record.hash, records: [{ id: append.record.id, seq: 0, hash: append.record.hash, bytes: append.record.bytes }], disposed: false });
    } else {
      if (!chain) throw new StorageCasConflictError('missing chain for head expectation');
      if (chain.disposed) throw new StorageInvalidCommandError('chain disposed at commit');
      if (chain.head !== append.expectation.hash) throw new StorageCasConflictError('stale head at commit');
      const seq = chain.records.length;
      chain.records.push({ id: append.record.id, seq, hash: append.record.hash, bytes: append.record.bytes });
      chain.head = append.record.hash;
      chain.allocation = incrementBackendAllocation(chain.allocation);
    }
  }
  for (const write of unit.indexWrites) {
    const stored = staged.index.get(write.key);
    if (stored && stored.digest !== write.digest) throw new StorageIdempotencyConflictError('index digest conflict at commit');
    // Detached copy: later caller-side mutation of resultIds cannot change
    // the canonical index entry (Sol-3/m4).
    staged.index.set(write.key, { digest: write.digest, resultIds: [...write.resultIds], resultHash: write.resultHash });
  }
  for (const record of unit.records) {
    const stored = staged.records.get(record.key);
    if (stored && stored.contentHash !== record.contentHash) throw new StorageIdempotencyConflictError('record hash conflict at commit');
    staged.records.set(record.key, { bytes: { ...record.bytes }, contentHash: record.contentHash });
  }
  for (const update of unit.updates) {
    const stored = staged.aggregates.get(update.key);
    if (stored && update.version <= stored.version) throw new StorageCasConflictError('stale aggregate version at commit');
    staged.aggregates.set(update.key, { version: update.version, value: { ...update.value } });
  }
};

export const commitUnitsToScope = (
  state: BackendScopeState,
  units: readonly AtomicUnit[],
  options: CommitOptions,
  ctx: CommitContext,
): CommitReceipt => {
  const merged = mergeAtomicUnits(units);
  if (!validateAtomicUnit(merged, options.limits).ok || !validateCommitOptions(options).ok) {
    throw new StorageInvalidCommandError('invalid unit or options');
  }
  // Fence verification belongs to S1/P1 (§13.4): the K3 ordinary runtime
  // cannot verify it, so a fenced commit is refused instead of silently
  // running unfenced.
  if (options.fence !== undefined) throw new UnsupportedProfileError('fenced-writers-v1');
  // K3-local preflight (Sol-5): guards use registered kinds, records carry
  // valid encoded bytes, and the merged unit fits the byte budget. Every
  // violation refuses before any effect is staged.
  for (const record of merged.records) {
    if (!nonEmpty(record.key) || !nonEmpty(record.contentHash) || !validateEncodedValue(record.bytes).ok) {
      throw new StorageInvalidCommandError('record write requires a key, content hash and encoded bytes');
    }
  }
  for (const update of merged.updates) {
    if (!validateEncodedValue(update.value).ok) throw new StorageInvalidCommandError('aggregate update requires encoded bytes');
  }
  if (options.limits !== undefined) {
    const mergedBytes = Buffer.byteLength(JSON.stringify(merged), 'utf8');
    if (mergedBytes > options.limits.maxEncodedBytes) throw new StorageInvalidCommandError('merged unit exceeds maxEncodedBytes');
  }
  const unitHash = JSON.stringify(units);
  if (options.idempotencyKey) {
    const stored = state.commits.get(options.idempotencyKey);
    if (stored) {
      // The stored receipt is copied: the caller can never mutate canonical
      // idempotency state through a returned receipt (Sol-3).
      if (stored.unitHash === unitHash) return { ...stored.receipt, scope: { ...stored.receipt.scope } };
      throw new StorageIdempotencyConflictError('idempotency key reused with a divergent unit');
    }
  }
  if (merged.relationships.length > 0) throw new StorageInvalidCommandError('relationships unsupported in the K3 ordinary runtime');
  if (merged.barriers.length > 0) throw new UnsupportedProfileError('visibility-barriers-v1');
  if (merged.purgeIntents.length > 0) throw new UnsupportedProfileError('purge-jobs-v1');
  if (merged.records.length + merged.appends.length + merged.updates.length + merged.indexWrites.length === 0) {
    throw new StorageInvalidCommandError('empty unit');
  }
  // Sequential validation (§5.5 read-your-writes): every unit's guards run
  // against the state evolved by the previous units of the same commit, and
  // every append is CAS-checked while staging, never against the base alone.
  // The staging maps share canonical entries until the first touch (m6).
  const staged: StagedCommit = {
    chains: new Map(state.chains),
    index: new Map(state.index),
    records: new Map(state.records),
    aggregates: new Map(state.aggregates),
  };
  for (const unit of units) {
    checkGuards(unit.guards, staged, ctx);
    stageEffects(unit, staged, state);
  }
  state.chains.clear();
  for (const [id, chain] of staged.chains) state.chains.set(id, chain);
  state.index.clear();
  for (const [key, entry] of staged.index) state.index.set(key, entry);
  state.records.clear();
  for (const [key, entry] of staged.records) state.records.set(key, entry);
  state.aggregates.clear();
  for (const [key, entry] of staged.aggregates) state.aggregates.set(key, entry);
  const receipt: CommitReceipt = { commitId: ctx.commitId, moduleId: ctx.moduleId, scope: { ...ctx.scope }, committedAt: ctx.clock(), effectiveRecords: merged.appends.length + merged.records.length + merged.updates.length, effectiveAppends: merged.appends.length, journalCursor: `cursor-${ctx.commitId}` };
  if (options.idempotencyKey) {
    state.commits.set(options.idempotencyKey, { receipt: { ...receipt, scope: { ...receipt.scope } }, unitHash });
  }
  return receipt;
};

export const commitAtomicToScope = (
  state: BackendScopeState,
  unit: AtomicUnit,
  options: CommitOptions,
  ctx: CommitContext,
): CommitReceipt => commitUnitsToScope(state, [unit], options, ctx);
