import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { validateScopeGrant, type ScopeGrant } from '../authority.js';
import {
  DEFAULT_WORK_LIMITS,
  isU64Counter,
  validateWorkLimits,
  validateWriterFence,
  type EncodedValue,
  type StorageOperation,
  type StorageScope,
  type WorkLimits,
  type WriterFence,
} from '../contracts.js';
// Exact-u64 fence epochs (E2): the neutral WriterFence stays safe-only, but
// the PG fence/provision paths additionally accept canonical u64 epochs so
// ownership epochs persist exactly through the signed-64 crossing.
const isU64Fence = (fence: WriterFence): boolean => {
  if (typeof fence !== 'object' || fence === null) return false;
  const candidate = fence as unknown as Record<string, unknown>;
  return (
    typeof candidate['fenceId'] === 'string' &&
    (candidate['fenceId'] as string).length > 0 &&
    (candidate['fenceId'] as string).length <= 256 &&
    !(candidate['fenceId'] as string).includes('\0') &&
    isU64Counter(candidate['epoch'])
  );
};
import type { CommitReceipt } from '../atomic.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import { createStaticAuthorityPort } from '../kernel.js';
import { HmacExactHeadBoundaryProvider, type ChainBoundaryProvider } from '../tokens.js';
import { PgRoots, pgJsonBytes, type PgRoot } from './roots.js';
import { DEFAULT_PG_BUDGETS, PgTransactions, withPgTxTimeouts } from './transactions.js';
import { decodePgUtf8 } from './codec.js';
import { PostgresStorageError } from './errors.js';
import { loadPgAssets, verifyPgInstallation } from './migrations.js';
import { CanonicalInstanceRegistry, CanonicalOwnershipError } from '../instance-ownership.js';
import {
  acquirePgInstanceOwnership,
  acquisitionRaced,
  DEFAULT_LEASE_MS,
  expirePgInstanceLease,
  resolvePgStoreKey,
  verifyPgInstanceOwnership,
  type PgInstanceOwnershipSession,
} from './instance-ownership.js';
import {
  assertNoDeprecatedAssetNames,
  assertPgOwnershipCatalog,
  chainPossessionGuard,
  createOwnershipCell,
  ensurePgModuleRecord,
  wrapDriverWithOwnership,
} from './instance-guard.js';
import { validatePgLayout, type PgSession, type PostgresStorageOptions } from './protocol.js';
import { validateModuleDescriptor } from '../descriptor.js';
const freezeRegistration = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeRegistration);
    Object.freeze(value);
  }
};

export interface PgTx {
  readonly session: PgSession;
  readonly scope: StorageScope;
  readonly base: PgRoot;
  root: string | null;
  closed: boolean;
  failed: unknown;
  count: number;
  records: number;
  recordWrites: number;
  appends: number;
  encodedBytes: number;
  readonly receipt: CommitReceipt;
  barriers: number;
  purges: number;
  moduleResult?: EncodedValue;
  readonly digests: string[];
  noop?: boolean;
  readonly contributors: Map<string, ScopeGrant<unknown>>;
  readonly revalidators: Set<() => Promise<void>>;
}
export class PgCore {
  readonly tx: PgTransactions;
  readonly roots: PgRoots;
  readonly ambient = new AsyncLocalStorage<PgTx>();
  readonly provider: ChainBoundaryProvider;
  readonly limits: WorkLimits;
  readonly authority;
  constructor(
    readonly options: PostgresStorageOptions,
    readonly incarnation: string,
    readonly ownership: PgInstanceOwnershipSession | null = null,
  ) {
    if (typeof options.cursorSecret !== 'string' || !options.cursorSecret.trim()) {
      throw new StorageInvalidCommandError('durable Postgres storage requires a stable cursorSecret');
    }
    const descriptor = options.descriptor
      ? (JSON.parse(JSON.stringify(options.descriptor)) as typeof options.descriptor)
      : undefined;
    if (descriptor) {
      if (
        !validateModuleDescriptor(descriptor).ok ||
        descriptor.queryNames.some((name) => typeof options.queries?.[name] !== 'function')
      )
        throw new StorageInvalidCommandError('invalid registered Postgres descriptor');
      freezeRegistration(descriptor);
    }
    this.options = Object.freeze({
      ...options,
      descriptor,
      layout: validatePgLayout(options.layout),
      assets: options.assets
        ? Object.freeze(
            options.assets.map((asset) => Object.freeze({ ...asset, requires: Object.freeze([...asset.requires]) })),
          )
        : undefined,
      limits: options.limits ? Object.freeze({ ...options.limits }) : undefined,
      budgets: Object.freeze({ ...options.budgets }),
      operations: Object.freeze(
        Object.fromEntries(
          Object.entries(options.operations ?? {}).map(([key, operation]) => [key, Object.freeze({ ...operation })]),
        ),
      ),
      stagedModules: Object.freeze(
        Object.fromEntries(
          Object.entries(options.stagedModules ?? {}).map(([key, module]) => [key, Object.freeze({ ...module })]),
        ),
      ),
      queries: Object.freeze({ ...options.queries }),
      pgPredicates: Object.freeze({ ...options.pgPredicates }),
    });
    options = this.options;
    if (
      options.outbox &&
      ['append', 'read', 'find'].some(
        (name) => typeof options.outbox?.[name as keyof typeof options.outbox] !== 'function',
      )
    )
      throw new StorageInvalidCommandError('alternate journal requires append and replay on the same log');
    this.tx = new PgTransactions(options.driver, options.budgets);
    this.roots = new PgRoots(options, incarnation);
    this.provider = options.boundaryProvider ?? new HmacExactHeadBoundaryProvider(options.cursorSecret);
    this.authority = options.authority ?? createStaticAuthorityPort();
    this.limits = Object.freeze({ ...(options.limits ?? DEFAULT_WORK_LIMITS) });
    if (!validateWorkLimits(this.limits).ok) throw new StorageInvalidCommandError('invalid Postgres work limits');
  }
  now(): string {
    return this.options.domainClock?.now() ?? this.options.now?.() ?? new Date().toISOString();
  }
  id(kind: string): string {
    if (kind.endsWith('capability') || kind === 'boundary') return `${kind}:${randomUUID()}`;
    return this.options.ids?.next(kind) ?? `${kind}:${randomUUID()}`;
  }
  admit(grant: ScopeGrant<unknown>, operation: StorageOperation): void {
    const valid = validateScopeGrant(grant, { expectedModuleId: this.options.moduleId, nowIso: this.now() });
    if (!valid.ok || !grant.operations.includes(operation))
      throw new StorageDeniedError('invalid or insufficient scope grant');
    this.authority.attest(grant);
  }
  async check(
    session: PgSession,
    grant: ScopeGrant<unknown>,
    operation: StorageOperation,
    lock = false,
  ): Promise<void> {
    this.admit(grant, operation);
    const result = await session.execute({
      text: `SELECT bytes, revoked FROM ${this.roots.schema}.grants WHERE module=$1 AND token=$2${lock ? ' FOR SHARE' : ''}`,
      values: [this.options.moduleId, grant.token],
    });
    const row = result.rows[0];
    if (!row || row.revoked !== false || decodePgUtf8(row.bytes) !== JSON.stringify(grant))
      throw new StorageDeniedError('unknown, revoked or changed scope grant');
  }
  async issue(grant: ScopeGrant<unknown>): Promise<void> {
    this.admit(grant, Array.isArray(grant.operations) ? grant.operations[0]! : 'read');
    await this.tx.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.roots.schema}.grants(module, token, bytes) VALUES($1, $2, $3) ON CONFLICT(module, token) DO NOTHING`,
        values: [this.options.moduleId, grant.token, pgJsonBytes(grant)],
      });
      await this.check(session, grant, grant.operations[0]!, true);
    });
  }
  async revoke(token: string): Promise<void> {
    await this.tx.run(false, (session) =>
      session.execute({
        text: `INSERT INTO ${this.roots.schema}.grants(module, token, bytes, revoked)
          VALUES($1, $2, $3, true) ON CONFLICT(module, token) DO UPDATE SET revoked=true`,
        values: [this.options.moduleId, token, Buffer.from('null')],
      }),
    );
  }
  work(requested?: WorkLimits): WorkLimits {
    const limits = requested ?? this.limits;
    if (
      !validateWorkLimits(limits).ok ||
      (Object.keys(this.limits) as (keyof WorkLimits)[]).some((key) => limits[key] > this.limits[key])
    )
      throw new StorageInvalidCommandError('requested work exceeds installed limits');
    return { ...limits };
  }
  async fence(session: PgSession, grant: ScopeGrant<unknown>, fence: WriterFence): Promise<void> {
    if (!validateWriterFence(fence).ok && !isU64Fence(fence)) throw new StorageInvalidCommandError('invalid writer fence');
    const result = await session.execute({
      text: `SELECT epoch::text FROM ${this.roots.schema}.fences WHERE scope_key=$1 AND lane=$2 AND owner=$3 AND incarnation=$4 AND epoch=$5::numeric AND
        (lease_until IS NULL OR lease_until>clock_timestamp()) FOR SHARE`,
      values: [this.roots.key(grant.scope), fence.fenceId, grant.principalId, this.incarnation, fence.epoch],
    });
    if (result.rows.length !== 1) throw new StorageInvalidCommandError('stale writer ownership or expired lease');
  }
  async provision(grant: ScopeGrant<unknown>, fence: WriterFence, leaseUntil: string | null = null): Promise<void> {
    if (!validateWriterFence(fence).ok && !isU64Fence(fence)) throw new StorageInvalidCommandError('invalid writer fence');
    await this.tx.run(false, async (session) => {
      await this.check(session, grant, 'write', true);
      const result = await session.execute({
        text: `INSERT INTO ${this.roots.schema}.fences(scope_key, lane, owner, incarnation, epoch, lease_until)
        VALUES($1, $2, $3, $4, $5::numeric, $6::timestamptz)
        ON CONFLICT(scope_key, lane) DO UPDATE SET owner=excluded.owner, epoch=excluded.epoch, lease_until=excluded.lease_until WHERE
        ${this.roots.schema}.fences.epoch<excluded.epoch OR
        (${this.roots.schema}.fences.epoch=excluded.epoch AND ${this.roots.schema}.fences.owner=excluded.owner
        AND ${this.roots.schema}.fences.lease_until
        IS NOT DISTINCT FROM excluded.lease_until) RETURNING epoch::text`,
        values: [
          this.roots.key(grant.scope),
          fence.fenceId,
          grant.principalId,
          this.incarnation,
          fence.epoch,
          leaseUntil,
        ],
      });
      if (result.rows.length !== 1) throw new StorageInvalidCommandError('writer ownership cannot move backwards');
    });
  }
  async visible(session: PgSession, root: string | null, target: string, seen = new Set<string>()): Promise<void> {
    if (seen.has(target)) return;
    if (seen.size >= 128) throw new PostgresStorageError('corruption');
    seen.add(target);
    if (
      (await this.roots.get(session, root, 'barrier', target)) ||
      (await this.roots.get(session, root, 'disposed', target))
    )
      throw new StorageDeniedError('target is covered or disposed');
    const parents = (await this.roots.get<readonly string[]>(session, root, 'parents', target)) ?? [];
    for (const parent of parents) await this.visible(session, root, parent, seen);
  }
}
export const openPgCore = async (options: PostgresStorageOptions): Promise<PgCore> => {
  if (!options.history) throw new PostgresStorageError('configuration');
  // Opt-in canonical ownership wraps the driver before any transaction, so
  // every kernel transaction verifies (and renews) the retained session on
  // its own session. Without opt-in the driver passes through untouched.
  const optIn = options.canonicalOwnership;
  const cell = optIn ? createOwnershipCell('', options.moduleId, optIn.leaseMs ?? DEFAULT_LEASE_MS) : null;
  // Timeout-first driver (G-P1): wait timeouts apply right after BEGIN, so
  // the ownership retained-session renew/verify stacked above also runs
  // bounded. `run` re-applies the same values afterwards (idempotent).
  const timed = withPgTxTimeouts(options.driver, Object.freeze({ ...DEFAULT_PG_BUDGETS, ...options.budgets }));
  const wrapped = cell ? wrapDriverWithOwnership(timed, cell) : null;
  // Release runs on the timeout-guarded driver WITHOUT the ownership
  // renewal: expiring the lease is the opposite of renewing it, and the
  // DELETE predicate (module, instance, epoch) already leaves a taken-over
  // successor row alone. A stale handle is therefore a silent no-op per the
  // neutral registry contract, never a renewal refusal.
  const releaseTx = new PgTransactions(timed, options.budgets);
  const provisional = new PgCore(
    wrapped ? { ...options, driver: wrapped.driver } : options,
    options.incarnation ?? `store:${randomUUID()}`,
  );
  options = provisional.options;
  if (cell) cell.schema = provisional.roots.schema;
  const assets = options.assets ?? (await loadPgAssets());
  assertNoDeprecatedAssetNames(assets);
  const opened = await provisional.tx.run(false, async (session) => {
    if (cell && optIn) {
      // G-P0a: the ownership catalog is a precondition of an opt-in open,
      // checked before installation attestation so a missing or tampered
      // catalog refuses with `open-refused` (registry/SQLite parity) rather
      // than surfacing as schema drift.
      await assertPgOwnershipCatalog(session, options.layout.dataSchema);
    }
    await verifyPgInstallation(session, options.layout, assets, options.history);
    const wanted = provisional.options.descriptor
      ? createHash('sha256').update(JSON.stringify(provisional.options.descriptor), 'utf8').digest('hex')
      : null;
    const stored = await ensurePgModuleRecord(session, provisional.roots.schema, {
      moduleId: options.moduleId,
      incarnation: options.incarnation,
      effectiveIncarnation: provisional.incarnation,
      wantedDescriptorDigest: wanted,
    });
    let ownership: PgInstanceOwnershipSession | null = null;
    if (cell && optIn) {
      // The open transaction retains the winning lease. A live holder
      // refuses the open promptly (no queue, never supersede).
      const storeKey = resolvePgStoreKey(options.layout.dataSchema, options.moduleId);
      const registry = optIn.registry ?? new CanonicalInstanceRegistry();
      const won = await acquirePgInstanceOwnership(
        session,
        provisional.roots.schema,
        storeKey,
        options.moduleId,
        registry,
        cell.leaseMs,
      );
      cell.handle = won.handle;
      ownership = {
        handle: won.handle,
        verify: (verifySession) =>
          verifyPgInstanceOwnership(verifySession, cell.schema, cell.moduleId, won.handle, cell.released),
        release: async () => {
          // Idempotent like the neutral registry: a repeated or stale
          // release is a no-op and must never clear a successor row. The
          // release transaction bypasses the renewal (see releaseTx), so
          // the predicate in expirePgInstanceLease is what runs — not the
          // short-circuit above.
          if (cell.released) return;
          await releaseTx.run(false, (releaseSession) =>
            expirePgInstanceLease(releaseSession, cell.schema, cell.moduleId, won.handle),
          );
          cell.released = true;
          registry.release(won.registryHandle);
        },
      };
    }
    return { stored, ownership };
  }).catch((error: unknown) => {
    // A serialization race lost at COMMIT time is still a concurrent
    // acquisition: refuse it as `instance-busy`, never a lock error.
    if (cell && optIn && acquisitionRaced(error)) {
      throw new CanonicalOwnershipError('instance-busy', 'concurrent acquisition in progress');
    }
    throw error;
  });
  // G-P0b: for opt-in kernels the durable guard runs on the committing
  // session itself through the existing onCommitPossession seam (no second
  // transaction, no transaction rewiring). Other kernels keep their hook.
  const chained: PostgresStorageOptions =
    cell && wrapped
      ? { ...options, onCommitPossession: chainPossessionGuard(wrapped.useSession, cell, options.onCommitPossession) }
      : options;
  return new PgCore(chained, opened.stored, opened.ownership);
};
