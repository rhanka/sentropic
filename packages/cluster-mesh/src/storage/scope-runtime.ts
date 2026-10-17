// K3 scope binding and ordinary transactions (L3a v4.1 frozen §4, §5).
// Grants are JSON DTOs: bind keeps a deeply frozen copy, so caller-side
// mutation can never escalate authority or switch scope. Every operation
// revalidates expiry, revocation and the required storage operation.
// transact() runs in a request-local asynchronous context: independent calls
// stay isolated while a nested call on the same handle joins the outer
// overlay and can only mark it rollback-only. The commit id is reserved
// upfront; a joined call returns a frozen provisional copy of the reserved
// receipt (zero effects before the outer commits) and only the outer commit
// returns the final counts. An empty transaction commits nothing and is
// refused. Physically disposed chains deny full getters and leak no
// continuation. Reads return copies, never canonical state.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { canOperate, validateScopeGrant, type ScopeGrant } from './authority.js';
import {
  StorageCasConflictError,
  StorageDeniedError,
  StorageIdempotencyConflictError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from './errors.js';
import type { AtomicUnit, CommitOptions, CommitReceipt, IdempotencyEntry, IdempotencySelector } from './atomic.js';
import { requireProfile, type ProfileClaim, type ProfileId } from './profiles.js';
import { incrementBackendAllocation, type BackendScopeState, type MemoryBackend } from './backend.js';
import {
  appendChainToScope,
  commitAtomicToScope,
  commitUnitsToScope,
  disposeChainInScope,
  genesisToScope,
  readPageFromScope,
  type ChainRecordInput,
  type PredicateContext,
  type PredicateEvaluator,
  type PredicateView,
  type ReadPageResult,
  type CommitContext,
} from './record-runtime.js';
import type { RootMutationCoordinator, RootMutationKind, RootReadKind } from './mutation-coordinator.js';
import type { ChainBoundaryProvider } from './tokens.js';
import { validatePageLimits, type PageLimits, type StorageScope } from './contracts.js';

// Semantic profile definitions: each digest is the SHA-256 of the K3
// ordinary meaning of the profile, not of its bare label (m8). A mutant
// hashing only the label produces a different digest.
const PROFILE_DEFINITIONS: Readonly<Record<ProfileId, string>> = {
  'atomic-units-v1':
    'atomic-units-v1:sequential-CAS-staging;full-rollback;equal-digest-replace;empty-refused',
  'immutable-chains-v1':
    'immutable-chains-v1:exact-head-CAS;per-chain-allocation;disposed-denies-getters;payload-erased',
  'immutable-boundaries-v1':
    'immutable-boundaries-v1:cursor-v2[HMAC-SHA256-128(module,scope,incarnation,keyId,selection,head,seq,allocation,ordering,position)];unknown-boundary-incomplete;no-lease;no-clock-expiry',
  'scope-outbox-v1': 'scope-outbox-v1:not-advertised-by-k3-ordinary',
  'visibility-barriers-v1': 'visibility-barriers-v1:not-advertised-by-k3-ordinary',
  'staged-units-v1': 'staged-units-v1:not-advertised-by-k3-ordinary',
  'purge-jobs-v1': 'purge-jobs-v1:not-advertised-by-k3-ordinary',
  'generations-v1': 'generations-v1:not-advertised-by-k3-ordinary',
  'leased-snapshots-v1': 'leased-snapshots-v1:not-advertised-by-k3-ordinary',
  'fenced-writers-v1': 'fenced-writers-v1:refused-verify-in-s1-p1',
  'restore-witness-v1': 'restore-witness-v1:not-advertised-by-k3-ordinary',
};

const profileDigest = (profile: ProfileId): string =>
  createHash('sha256').update(`k3-ordinary-v1:${profile}:${PROFILE_DEFINITIONS[profile]}`, 'utf8').digest('hex');

export const ORDINARY_PROFILES: readonly ProfileClaim[] = [
  { profile: 'atomic-units-v1', version: '1', digest: profileDigest('atomic-units-v1') },
  { profile: 'immutable-chains-v1', version: '1', digest: profileDigest('immutable-chains-v1') },
  { profile: 'immutable-boundaries-v1', version: '1', digest: profileDigest('immutable-boundaries-v1') },
];

// Frozen capability advertisements (m1): the array and every declaration
// are sealed, so planting an entry through one handle can never widen what
// another handle advertises.
for (const entry of ORDINARY_PROFILES) Object.freeze(entry);
Object.freeze(ORDINARY_PROFILES);

const deepCopyGrant = (grant: ScopeGrant<unknown>): ScopeGrant<unknown> =>
  JSON.parse(JSON.stringify(grant)) as ScopeGrant<unknown>;

const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) deepFreeze(entry);
  Object.freeze(value);
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

interface TxOverlay {
  readonly units: AtomicUnit[];
  readonly heads: Map<string, string | null>;
  readonly created: Set<string>;
  readonly aggregateVersions: Map<string, number>;
  readonly aggregateWrites: Map<string, { version: number; value: { format: 'utf8' | 'base64'; data: string } }>;
  readonly recordWrites: Map<string, { bytes: { format: 'utf8' | 'base64'; data: string }; contentHash: string }>;
  readonly chainAppends: Map<string, ChainRecordInput[]>;
  readonly indexAppends: Map<string, { digest: string; resultIds: string[]; resultHash: string | null }>;
  rollbackOnly: boolean;
  savedError: unknown;
  closed: boolean;
  readonly receipt: CommitReceipt;
  // Every handle that joined this overlay, by grant token (§4.3 m3): each
  // one is revalidated immediately before the mutation commits.
  readonly contributors: Map<string, ScopeGrant<unknown>>;
  readonly scope: StorageScope;
}

/** §5.2 record read: one entry per found key, in key order. Absent keys
 * are absent from the result (never null entries). */
export interface RecordRead {
  readonly key: string;
  readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string };
  readonly contentHash: string;
}

/** §5.2 paginated chain read request: limit and byte budget are mandatory,
 * the cursor carries the resume position. */
export interface ChainReadRequest {
  readonly chainId: string;
  readonly limit: number;
  readonly cursor?: unknown;
  readonly maxEncodedBytes: number;
}

/** §5.2 paginated chain read result: the committed readPage shape, over the
 * combined committed-plus-pending view. */
export type RecordPage = ReadPageResult;

export interface KernelTransaction {
  apply(unit: AtomicUnit): Promise<void>;
  readHead(chainId: string): Promise<string | null>;
  readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null>;
  readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  /** §5.2 paginated chain read over pending appends plus committed state. */
  readChain(input: ChainReadRequest): Promise<RecordPage>;
  /** §5.2 command-index lookup over pending writes plus committed state. */
  findIdempotency(selector: IdempotencySelector): Promise<IdempotencyEntry | null>;
  /** §5.2 bounded multi-record read over pending writes plus committed state. */
  readRecords(keys: readonly string[], limits: PageLimits): Promise<readonly RecordRead[]>;
}

/** Internal kernel wiring. Not part of the public surface (R-MAJ-5): the
 * adapter entry point re-exports neither this interface nor the runtime
 * constructor, and the runtime keeps its reference in a true private field,
 * so no issuance, revocation or backend state is reachable from a handle. */
export interface ScopedRuntimeDeps {
  readonly coordinator?: RootMutationCoordinator;
  readonly moduleId: string;
  /** Unique owning-kernel identity: transactions never join across kernels. */
  readonly kernelId: string;
  readonly backend: MemoryBackend;
  readonly provider: ChainBoundaryProvider;
  readonly incarnation: string;
  readonly clock: () => string;
  readonly revoked: Set<string>;
  readonly issued: Map<string, string>;
  readonly nextCommitId: () => string;
  readonly authority: { attest(grant: ScopeGrant<unknown>): void };
  readonly predicates?: Readonly<Record<string, PredicateEvaluator>>;
}

// Request-local transaction contexts (§5.5 isolation between concurrent
// contexts): one overlay per kernel-plus-module-plus-scope per asynchronous
// call chain, so two handles of one kernel bound to the same grant and
// scope join instead of committing independently (m3). Distinct kernels,
// modules or scopes never join (Sol-2): independent kernels own independent
// backends, and a cross-kernel join would commit foreign units to the wrong
// store under one receipt.
const txScope = new AsyncLocalStorage<Map<string, TxOverlay>>();

const txJoinKey = (kernelId: string, moduleId: string, scope: StorageScope): string =>
  JSON.stringify(['tx', kernelId, moduleId, scope.tenantId, scope.workspaceId]);

export class ScopedRuntime {
  readonly grant: ScopeGrant<unknown>;
  private readonly boundScope: StorageScope;
  /** True private issuance state (R-MAJ-5): invisible at runtime, so
   * `(handle as any).deps` is undefined and Adapter handles carry no
   * emission, revocation or backend reach. */
  #deps: ScopedRuntimeDeps;

  constructor(
    grant: ScopeGrant<unknown>,
    readonly moduleId: string,
    deps: ScopedRuntimeDeps,
  ) {
    const copy = deepCopyGrant(grant);
    deepFreeze(copy);
    this.grant = copy;
    this.boundScope = Object.freeze({ tenantId: copy.scope.tenantId, workspaceId: copy.scope.workspaceId });
    this.#deps = deps;
    // Sealed handle (Sol-1, realm-limited): the instance is frozen, the
    // shared prototype is frozen (see below) and boundScope is frozen, so
    // escalation, tenant-switch or method wrapping by property assignment
    // throws instead of redirecting authority. Intrinsic realm objects
    // (Array.prototype and friends) stay outside this guarantee: full
    // isolation needs a realm or process boundary (spec §6.5). Every
    // operation re-attests authority and grant/scope equality through
    // requireOperation; the commit-time contributor revalidation below is
    // inline, and backend addressing reads the frozen boundScope directly
    // (safe: frozen at bind, and the scope getter copies).
    Object.freeze(this);
  }

  get scope(): StorageScope {
    // A copy: callers can never retarget the bound scope object (the
    // cross-scope check in requireOperation stays meaningful).
    return { ...this.boundScope };
  }

  get profiles(): readonly ProfileClaim[] {
    return ORDINARY_PROFILES;
  }

  capability(profile: ProfileId): ProfileClaim {
    requireProfile(
      ORDINARY_PROFILES.map((entry) => entry.profile),
      profile,
    );
    const claim = ORDINARY_PROFILES.find((entry) => entry.profile === profile);
    if (!claim) throw new UnsupportedProfileError(String(profile));
    return { profile: claim.profile, version: claim.version, digest: claim.digest };
  }

  requireOperation(op: 'read' | 'write' | 'publish' | 'maintain'): void {
    const validity = validateScopeGrant(this.grant, { nowIso: this.#deps.clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (this.#deps.revoked.has(this.grant.token)) throw new StorageDeniedError('grant revoked');
    // The authority port is re-attested on every operation (§4.3, m7): a
    // changed issuer or revision pin denies here even though the frozen
    // grant copy is unchanged. The default structural port only enforces
    // explicitly configured expectations; shape and lifetime stay with
    // validateScopeGrant above.
    this.#deps.authority.attest(this.grant);
    if (!canOperate(this.grant, op)) throw new StorageDeniedError(`grant lacks ${op}`);
    if (this.grant.scope.tenantId !== this.boundScope.tenantId || this.grant.scope.workspaceId !== this.boundScope.workspaceId) {
      throw new StorageDeniedError('cross-scope handle');
    }
  }

  private commitContext(commitId = this.#deps.nextCommitId()): CommitContext {
    return { moduleId: this.moduleId, scope: this.boundScope, clock: this.#deps.clock,
      commitId, predicates: this.#deps.predicates };
  }

  private change<T>(kind: RootMutationKind, keys: readonly string[], operation: (state: BackendScopeState) => T): T {
    const coordinator = this.#deps.coordinator;
    return coordinator
      ? coordinator.mutate(this.grant, kind, keys, operation, this.commitContext(), () => this.requireOperation(kind === 'dispose' ? 'maintain' : 'write'))
      : operation(this.#deps.backend.scopeState(this.boundScope));
  }

  private accessible(kind: RootReadKind, key: string): boolean {
    return this.#deps.coordinator?.accessible(this.grant, kind, key) ?? true;
  }

  private assertAccessible(kind: RootReadKind, key: string): void {
    if (!this.accessible(kind, key)) throw new StorageDeniedError('current root denies this subject');
  }

  async appendChain(chainId: string, record: ChainRecordInput, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Promise<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    return this.change('append', [chainId], (state) => appendChainToScope(state, chainId, record, expectation));
  }

  async genesis(kind: string, id: string, hash: string, value: unknown): Promise<{ readonly hash: string; readonly replayed: boolean }> {
    this.requireOperation('write');
    return this.change('genesis', [`${kind}:${id}`], (state) => genesisToScope(state, kind, id, hash, value));
  }

  async indexGet(key: string): Promise<{ readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null> {
    this.requireOperation('read');
    this.assertAccessible('index', key);
    const stored = this.#deps.backend.scopeState(this.boundScope).index.get(key);
    if (!stored) return null;
    return { digest: stored.digest, resultIds: [...stored.resultIds], resultHash: stored.resultHash };
  }

  async indexPut(key: string, entry: { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null }): Promise<'insert' | 'replace'> {
    this.requireOperation('write');
    return this.change('index', [key], (state) => {
      const stored = state.index.get(key);
      // Detached copies: the caller's entry object never aliases canonical
      // state (Sol-3/m4).
      const detached = { digest: entry.digest, resultIds: [...entry.resultIds], resultHash: entry.resultHash };
      if (!stored) {
        state.index.set(key, detached);
        return 'insert';
      }
      if (stored.digest === entry.digest) {
        state.index.set(key, detached);
        return 'replace';
      }
      throw new StorageIdempotencyConflictError('index digest conflict');
    });
  }

  async readHead(chainId: string): Promise<string | null> {
    this.requireOperation('read');
    this.assertAccessible('chain', chainId);
    const chain = this.#deps.backend.scopeState(this.boundScope).chains.get(chainId);
    if (chain?.disposed) throw new StorageDeniedError('chain disposed');
    return chain?.head ?? null;
  }

  async readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> {
    this.requireOperation('read');
    this.assertAccessible('record', key);
    const stored = this.#deps.backend.scopeState(this.boundScope).records.get(key);
    if (!stored) return null;
    return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
  }

  async readAggregate(key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> {
    this.requireOperation('read');
    this.assertAccessible('aggregate', key);
    const stored = this.#deps.backend.scopeState(this.boundScope).aggregates.get(key);
    if (!stored) return null;
    return { version: stored.version, value: { ...stored.value } };
  }

  async readChain(chainId: string): Promise<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]> {
    this.requireOperation('read');
    this.assertAccessible('chain', chainId);
    const chain = this.#deps.backend.scopeState(this.boundScope).chains.get(chainId);
    if (chain?.disposed) throw new StorageDeniedError('chain disposed');
    return (chain?.records ?? []).map((entry) => ({ ...entry }));
  }

  async readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<ReadPageResult> {
    this.requireOperation('read');
    if (!this.accessible('chain', chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
    return readPageFromScope(this.#deps.backend.scopeState(this.boundScope), chainId, limit, cursor, maxEncodedBytes, {
      moduleId: this.moduleId,
      scope: this.boundScope,
      incarnation: this.#deps.incarnation,
      provider: this.#deps.provider,
    });
  }

  async disposeChain(chainId: string): Promise<void> {
    this.requireOperation('maintain');
    this.change('dispose', [chainId], (state) => disposeChainInScope(state, chainId));
  }

  async commitAtomic(unit: AtomicUnit, options: CommitOptions = {}): Promise<CommitReceipt> {
    this.requireOperation('write');
    const ctx = this.commitContext();
    return this.#deps.coordinator
      ? this.#deps.coordinator.commit(this.grant, [unit], options, ctx, () => this.requireOperation('write'))
      : commitAtomicToScope(this.#deps.backend.scopeState(this.boundScope), unit, options, ctx);
  }

  /** §5.5 ordinary transaction with kernel-bound join.
   *
   * A joined call (same kernel, module and scope) never receives the shared
   * mutable receipt: it returns a frozen provisional copy carrying the
   * reserved commit id with zero effects (`effectiveRecords` and
   * `effectiveAppends` read 0 until the outer commits). Only the outer
   * commit returns the final counts, likewise as a frozen copy, so a joined
   * contributor holding a provisional copy can never rewrite them. A
   * reserved commit id whose outer fails never commits.
   */
  async transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>): Promise<{ readonly value: T; readonly receipt: CommitReceipt }> {
    this.requireOperation('write');
    const ambient = txScope.getStore();
    const joinKey = txJoinKey(this.#deps.kernelId, this.moduleId, this.boundScope);
    const joined = ambient?.get(joinKey);
    if (joined) {
      // A live overlay for this module and scope joins (§5.5). A closed one
      // means detached work outliving its context: refuse it instead of
      // opening an independent transaction (R-MAJ-3).
      if (joined.closed) throw new StorageInvalidCommandError('transaction closed');
      joined.contributors.set(this.grant.token, this.grant);
      try {
        const value = await operation(this.makeTx(joined));
        // Provisional receipt copy (m2): the joined call returns a frozen
        // snapshot of the reserved commit (zero effects before the outer
        // commits), never the shared mutable receipt object. A reserved
        // commit id that never commits means the outer failed (§5.5: the
        // callback result returns only after commit).
        const provisional: CommitReceipt = { ...joined.receipt, scope: { ...joined.receipt.scope } };
        Object.freeze(provisional.scope);
        Object.freeze(provisional);
        return { value, receipt: provisional };
      } catch (error) {
        joined.rollbackOnly = true;
        joined.savedError = error;
        throw error;
      }
    }
    // The commit id is reserved before the operation runs; every joined call
    // reports that id on its own frozen provisional copy, never the shared
    // mutable receipt, and only the outer commit returns the final counts.
    const commitId = this.#deps.nextCommitId();
    const receipt: CommitReceipt = { commitId, moduleId: this.moduleId, scope: { ...this.boundScope }, committedAt: this.#deps.clock(), effectiveRecords: 0, effectiveAppends: 0, journalCursor: `cursor-${commitId}` };
    const overlay: TxOverlay = { units: [], heads: new Map(), created: new Set(), aggregateVersions: new Map(), aggregateWrites: new Map(), recordWrites: new Map(), chainAppends: new Map(), indexAppends: new Map(), rollbackOnly: false, savedError: null, closed: false, receipt, contributors: new Map([[this.grant.token, this.grant]]), scope: { ...this.boundScope } };
    const nested = new Map(ambient);
    nested.set(joinKey, overlay);
    try {
      const value = await txScope.run(nested, () => operation(this.makeTx(overlay)));
      if (overlay.rollbackOnly) throw overlay.savedError ?? new StorageInvalidCommandError('transaction rolled back');
      this.requireOperation('write');
      if (overlay.units.length === 0) throw new StorageInvalidCommandError('empty transaction commits nothing');
      // Commit-time revalidation of every contributor (§4.3 m3): a handle
      // revoked or expired between its apply and the outer commit cannot
      // smuggle its units in.
      const revalidate = () => {
        this.requireOperation('write');
        for (const grant of overlay.contributors.values()) {
          const validity = validateScopeGrant(grant, { nowIso: this.#deps.clock() });
          if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
          if (this.#deps.revoked.has(grant.token)) throw new StorageDeniedError('grant revoked');
          this.#deps.authority.attest(grant);
          if (!canOperate(grant, 'write')) throw new StorageDeniedError('grant lacks write');
          if (grant.scope.tenantId !== overlay.scope.tenantId || grant.scope.workspaceId !== overlay.scope.workspaceId) {
            throw new StorageDeniedError('cross-scope handle');
          }
        }
      };
      revalidate();
      const context = this.commitContext(commitId);
      const committed = this.#deps.coordinator
        ? this.#deps.coordinator.commit(this.grant, overlay.units, options, context, revalidate)
        : commitUnitsToScope(this.#deps.backend.scopeState(this.boundScope), overlay.units, options, context);
      Object.assign(overlay.receipt, committed);
      // Final receipt copy (m2): the outer commit returns its own frozen
      // snapshot, so a joined contributor holding a provisional copy can
      // never rewrite the committed counts.
      const finalReceipt: CommitReceipt = { ...overlay.receipt, scope: { ...overlay.receipt.scope } };
      Object.freeze(finalReceipt.scope);
      Object.freeze(finalReceipt);
      return { value, receipt: finalReceipt };
    } catch (error) {
      if (!overlay.rollbackOnly) {
        overlay.rollbackOnly = true;
        overlay.savedError = error;
        throw error;
      }
      throw overlay.savedError ?? error;
    } finally {
      overlay.closed = true;
    }
  }

  private makeTx(overlay: TxOverlay): KernelTransaction {
    const backendState = () => this.#deps.backend.scopeState(this.boundScope);
    const effectiveHead = (chainId: string): string | null => {
      if (overlay.heads.has(chainId)) return overlay.heads.get(chainId) ?? null;
      return backendState().chains.get(chainId)?.head ?? null;
    };
    const effectiveAggregateVersion = (key: string): number | undefined => {
      if (overlay.aggregateVersions.has(key)) return overlay.aggregateVersions.get(key);
      return backendState().aggregates.get(key)?.version;
    };
    const markFailed = (error: unknown): never => {
      overlay.rollbackOnly = true;
      overlay.savedError = error;
      throw error;
    };
    // Predicate view over the overlay: base state plus pending writes, so
    // apply-time evaluation already sees read-your-writes (R-MAJ-6). The
    // commit re-evaluates every guard against the staged state, which is the
    // predicate dependency tracking for K3: no guard survives unevaluated.
    const overlayView = (): PredicateView => ({
      readHead: (chainId: string): string | null => effectiveHead(chainId),
      hasChain: (chainId: string): boolean => overlay.created.has(chainId) || backendState().chains.has(chainId),
      readRecord: (key: string) => {
        const pending = overlay.recordWrites.get(key);
        if (pending) return { bytes: { ...pending.bytes }, contentHash: pending.contentHash };
        const stored = backendState().records.get(key);
        if (!stored) return null;
        return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
      },
      readAggregateVersion: (key: string): number | undefined => effectiveAggregateVersion(key),
    });
    const predicateContext = (predicateId: string): PredicateContext => ({
      moduleId: this.moduleId,
      scope: { ...this.boundScope },
      predicateId,
      view: overlayView(),
    });
    const checkApplyGuard = (guard: AtomicUnit['guards'][number]): void => {
      if (guard.kind === 'head') {
        if (effectiveHead(guard.chainId) !== guard.hash) throw new StorageCasConflictError('guard head mismatch');
      } else if (guard.kind === 'absent') {
        if (overlay.created.has(guard.chainId) || backendState().chains.has(guard.chainId)) {
          throw new StorageIdempotencyConflictError('guard absent violated');
        }
      } else if (guard.kind === 'aggregate-version') {
        if (effectiveAggregateVersion(guard.key) !== guard.version) {
          throw new StorageCasConflictError('guard aggregate version mismatch');
        }
      } else if (guard.kind === 'predicate') {
        if (!nonEmpty(guard.predicateId) || !nonEmpty(guard.dependency)) {
          throw new StorageInvalidCommandError('predicate guard requires an id and dependency');
        }
        // Own-property lookup only (O3): an inherited key such as
        // 'constructor' must read as unregistered, never as an evaluator.
        const registry = this.#deps.predicates;
        const evaluator = registry !== undefined && Object.hasOwn(registry, guard.predicateId) ? registry[guard.predicateId] : undefined;
        if (!evaluator) throw new UnsupportedProfileError(`predicate:${guard.predicateId}`);
        if (!evaluator(guard.dependency, predicateContext(guard.predicateId))) {
          throw new StorageCasConflictError('predicate guard mismatch');
        }
      } else {
        throw new StorageInvalidCommandError(`unknown guard kind:${(guard as { readonly kind?: unknown }).kind}`);
      }
    };
    // Every transactional read revalidates authority (§4.3, R-MAJ-4): a
    // write-only grant cannot read through its transaction, and a grant
    // revoked or expired mid-callback denies the next read.
    const txReadGuard = (): void => {
      if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
      this.requireOperation('read');
    };
    return {
      apply: async (unit: AtomicUnit): Promise<void> => {
        if (overlay.closed) throw new StorageInvalidCommandError('transaction closed');
        try {
          this.requireOperation('write');
          for (const guard of unit.guards) checkApplyGuard(guard);
          // Sequential provisional checks (Sol-4): each append is CAS-checked
          // against the heads advanced by the earlier appends of this same
          // unit, so a create-then-append unit applies together.
          for (const append of unit.appends) {
            if (append.expectation.kind === 'absent') {
              if (overlay.created.has(append.chainId) || backendState().chains.has(append.chainId)) {
                throw new StorageIdempotencyConflictError('stale creation expectation');
              }
              overlay.created.add(append.chainId);
            } else {
              if (effectiveHead(append.chainId) !== append.expectation.hash) {
                throw new StorageCasConflictError('stale head at commit');
              }
            }
            overlay.heads.set(append.chainId, append.record.hash);
            const pending = overlay.chainAppends.get(append.chainId) ?? [];
            pending.push({ ...append.record });
            overlay.chainAppends.set(append.chainId, pending);
          }
          for (const update of unit.updates) {
            overlay.aggregateVersions.set(update.key, update.version);
            overlay.aggregateWrites.set(update.key, { version: update.version, value: { ...update.value } });
          }
          for (const record of unit.records) {
            overlay.recordWrites.set(record.key, { bytes: { ...record.bytes }, contentHash: record.contentHash });
          }
          for (const write of unit.indexWrites) {
            overlay.indexAppends.set(write.key, { digest: write.digest, resultIds: [...write.resultIds], resultHash: write.resultHash });
          }
        } catch (error) {
          markFailed(error);
        }
        // The flush plan is frozen: later caller-side mutation of the unit
        // cannot change what the commit stages.
        const frozen = JSON.parse(JSON.stringify(unit)) as AtomicUnit;
        overlay.units.push(frozen);
      },
      readHead: async (chainId: string): Promise<string | null> => {
        txReadGuard();
        this.assertAccessible('chain', chainId);
        if (backendState().chains.get(chainId)?.disposed) throw new StorageDeniedError('chain disposed');
        return effectiveHead(chainId);
      },
      readAggregate: async (key: string): Promise<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null> => {
        txReadGuard();
        this.assertAccessible('aggregate', key);
        const pending = overlay.aggregateWrites.get(key);
        if (pending) return { version: pending.version, value: { ...pending.value } };
        const stored = backendState().aggregates.get(key);
        if (!stored) return null;
        return { version: stored.version, value: { ...stored.value } };
      },
      readRecord: async (key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null> => {
        txReadGuard();
        this.assertAccessible('record', key);
        const pending = overlay.recordWrites.get(key);
        if (pending) return { bytes: { ...pending.bytes }, contentHash: pending.contentHash };
        const stored = backendState().records.get(key);
        if (!stored) return null;
        return { bytes: { ...stored.bytes }, contentHash: stored.contentHash };
      },
      readChain: async (input: ChainReadRequest): Promise<RecordPage> => {
        txReadGuard();
        if (typeof input !== 'object' || input === null) throw new StorageInvalidCommandError('chain read requires a request');
        const { chainId, limit, maxEncodedBytes } = input;
        const cursor = input.cursor ?? null;
        if (!nonEmpty(chainId)) throw new StorageInvalidCommandError('chain read requires a chainId');
        if (!this.accessible('chain', chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
        if (!Number.isSafeInteger(limit) || limit <= 0) throw new StorageInvalidCommandError('invalid limit');
        if (!Number.isSafeInteger(maxEncodedBytes) || maxEncodedBytes <= 0) {
          throw new StorageInvalidCommandError('invalid byte budget');
        }
        // Paginated over the combined committed-plus-pending view: delegate
        // to the committed pager on a scratch scope state, so tx pages share
        // the exact budget, floor and cursor semantics of readPage (§5.2).
        // The scratch state is discarded; canonical state is never touched.
        const state = backendState();
        const committed = state.chains.get(chainId);
        let allocation = committed?.allocation ?? '0';
        const combined = (committed?.records ?? []).map((entry) => ({ ...entry }));
        for (const record of overlay.chainAppends.get(chainId) ?? []) {
          allocation = incrementBackendAllocation(allocation);
          combined.push({ id: record.id, seq: combined.length, hash: record.hash, bytes: record.bytes });
        }
        const scratch: BackendScopeState = {
          ...state,
          chains: new Map(state.chains).set(chainId, {
            allocation,
            head: combined.length === 0 ? null : combined[combined.length - 1].hash,
            records: combined,
            disposed: committed?.disposed ?? false,
          }),
        };
        return readPageFromScope(scratch, chainId, limit, cursor, maxEncodedBytes, {
          moduleId: this.moduleId,
          scope: this.boundScope,
          incarnation: this.#deps.incarnation,
          provider: this.#deps.provider,
        });
      },
      findIdempotency: async (selector: IdempotencySelector): Promise<IdempotencyEntry | null> => {
        txReadGuard();
        this.assertAccessible('index', selector.key);
        // K1 command index (§5.4) with read-your-writes: pending index
        // writes of this transaction win over committed state (R-MAJ-7).
        const pending = overlay.indexAppends.get(selector.key);
        if (pending) return { digest: pending.digest, resultIds: [...pending.resultIds], resultHash: pending.resultHash };
        const stored = backendState().index.get(selector.key);
        if (!stored) return null;
        return { digest: stored.digest, resultIds: [...stored.resultIds], resultHash: stored.resultHash };
      },
      readRecords: async (keys: readonly string[], limits: PageLimits): Promise<readonly RecordRead[]> => {
        txReadGuard();
        // Limits are mandatory (§5.2): an absent or malformed budget refuses
        // instead of reading unbounded.
        if (!validatePageLimits(limits).ok) throw new StorageInvalidCommandError('record read requires valid limits');
        if (keys.length > limits.maxRecords) {
          throw new StorageInvalidCommandError('record read exceeds maxRecords');
        }
        const rows: RecordRead[] = [];
        for (const key of keys) {
          this.assertAccessible('record', key);
          const pending = overlay.recordWrites.get(key);
          if (pending) {
            rows.push({ key, bytes: { ...pending.bytes }, contentHash: pending.contentHash });
            continue;
          }
          const stored = backendState().records.get(key);
          if (stored) rows.push({ key, bytes: { ...stored.bytes }, contentHash: stored.contentHash });
        }
        // The byte budget applies to the encoded result: an over-budget
        // result refuses fail-closed instead of truncating silently.
        if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > limits.maxEncodedBytes) {
          throw new StorageInvalidCommandError('record read exceeds maxEncodedBytes');
        }
        return rows;
      },
    };
  }
}

// The prototype is shared by every handle of every kernel in this realm:
// freezing it closes the cross-module channel (Sol-1 cases A and D), so
// replacing requireOperation or wrapping a method throws for all handles.
Object.freeze(ScopedRuntime.prototype);
