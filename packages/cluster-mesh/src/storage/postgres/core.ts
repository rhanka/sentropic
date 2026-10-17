import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { validateScopeGrant, type ScopeGrant } from '../authority.js';
import { DEFAULT_WORK_LIMITS, validateWorkLimits, validateWriterFence, type StorageOperation, type StorageScope, type WorkLimits, type WriterFence } from '../contracts.js';
import type { CommitReceipt } from '../atomic.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import { createStaticAuthorityPort } from '../kernel.js';
import { HmacExactHeadBoundaryProvider, type ChainBoundaryProvider } from '../tokens.js';
import { PgRoots, pgJsonBytes, type PgRoot } from './roots.js';
import { PgTransactions } from './transactions.js';
import { decodePgText, decodePgUtf8 } from './codec.js';
import { PostgresStorageError } from './errors.js';
import { loadPgAssets, verifyPgInstallation } from './migrations.js';
import type { PgSession, PostgresStorageOptions } from './protocol.js';

export interface PgTx {
  readonly session: PgSession; readonly scope: StorageScope; readonly base: PgRoot;
  root: string | null; closed: boolean; failed: unknown; count: number;
  records: number; appends: number; encodedBytes: number; readonly receipt: CommitReceipt;
  readonly contributors: Map<string, ScopeGrant<unknown>>;
}
export class PgCore {
  readonly tx: PgTransactions;
  readonly roots: PgRoots;
  readonly ambient = new AsyncLocalStorage<PgTx>();
  readonly provider: ChainBoundaryProvider;
  readonly limits: WorkLimits;
  readonly authority;
  constructor(readonly options: PostgresStorageOptions, readonly incarnation: string) {
    this.tx = new PgTransactions(options.driver, options.budgets);
    this.roots = new PgRoots(options, incarnation);
    this.provider = options.boundaryProvider ?? new HmacExactHeadBoundaryProvider(options.cursorSecret);
    this.authority = options.authority ?? createStaticAuthorityPort();
    this.limits = Object.freeze({ ...(options.limits ?? DEFAULT_WORK_LIMITS) });
    if (!validateWorkLimits(this.limits).ok) throw new StorageInvalidCommandError('invalid Postgres work limits');
  }
  now(): string { return this.options.domainClock?.now() ?? this.options.now?.() ?? new Date().toISOString(); }
  id(kind: string): string { return this.options.ids?.next(kind) ?? `${kind}:${randomUUID()}`; }
  admit(grant: ScopeGrant<unknown>, operation: StorageOperation): void {
    const valid = validateScopeGrant(grant, { expectedModuleId: this.options.moduleId, nowIso: this.now() });
    if (!valid.ok || !grant.operations.includes(operation)) throw new StorageDeniedError('invalid or insufficient scope grant');
    this.authority.attest(grant);
  }
  async check(session: PgSession, grant: ScopeGrant<unknown>, operation: StorageOperation, lock = false): Promise<void> {
    this.admit(grant, operation);
    const result = await session.execute({ text: `SELECT bytes,revoked FROM ${this.roots.schema}.grants WHERE module=$1 AND token=$2${lock ? ' FOR SHARE' : ''}`, values: [this.options.moduleId, grant.token] });
    const row = result.rows[0];
    if (!row || row.revoked !== false || decodePgUtf8(row.bytes) !== JSON.stringify(grant)) throw new StorageDeniedError('unknown, revoked or changed scope grant');
  }
  async issue(grant: ScopeGrant<unknown>): Promise<void> {
    this.admit(grant, grant.operations[0]!);
    await this.tx.run(false, async (session) => {
      await session.execute({ text: `INSERT INTO ${this.roots.schema}.grants(module,token,bytes) VALUES($1,$2,$3) ON CONFLICT(module,token) DO NOTHING`, values: [this.options.moduleId, grant.token, pgJsonBytes(grant)] });
      await this.check(session, grant, grant.operations[0]!, true);
    });
  }
  async revoke(token: string): Promise<void> {
    await this.tx.run(false, (session) => session.execute({ text: `UPDATE ${this.roots.schema}.grants SET revoked=true WHERE module=$1 AND token=$2`, values: [this.options.moduleId, token] }));
  }
  work(requested?: WorkLimits): WorkLimits {
    const limits = requested ?? this.limits;
    if (!validateWorkLimits(limits).ok || (Object.keys(this.limits) as (keyof WorkLimits)[]).some((key) => limits[key] > this.limits[key])) throw new StorageInvalidCommandError('requested work exceeds installed limits');
    return { ...limits };
  }
  async fence(session: PgSession, grant: ScopeGrant<unknown>, fence: WriterFence): Promise<void> {
    if (!validateWriterFence(fence).ok) throw new StorageInvalidCommandError('invalid writer fence');
    const result = await session.execute({ text: `SELECT epoch::text FROM ${this.roots.schema}.fences WHERE scope_key=$1 AND lane=$2 AND owner=$3 AND incarnation=$4 AND epoch=$5::bigint AND (lease_until IS NULL OR lease_until>clock_timestamp()) FOR SHARE`, values: [this.roots.key(grant.scope), fence.fenceId, grant.principalId, this.incarnation, fence.epoch] });
    if (result.rows.length !== 1) throw new StorageInvalidCommandError('stale writer ownership or expired lease');
  }
  async provision(grant: ScopeGrant<unknown>, fence: WriterFence, leaseUntil: string | null = null): Promise<void> {
    if (!validateWriterFence(fence).ok) throw new StorageInvalidCommandError('invalid writer fence');
    await this.tx.run(false, async (session) => {
      await this.check(session, grant, 'write', true);
      const result = await session.execute({ text: `INSERT INTO ${this.roots.schema}.fences(scope_key,lane,owner,incarnation,epoch,lease_until) VALUES($1,$2,$3,$4,$5::bigint,$6::timestamptz)
        ON CONFLICT(scope_key,lane) DO UPDATE SET owner=excluded.owner,epoch=excluded.epoch,lease_until=excluded.lease_until WHERE ${this.roots.schema}.fences.epoch<excluded.epoch OR (${this.roots.schema}.fences.epoch=excluded.epoch AND ${this.roots.schema}.fences.owner=excluded.owner AND ${this.roots.schema}.fences.lease_until IS NOT DISTINCT FROM excluded.lease_until) RETURNING epoch::text`,
        values: [this.roots.key(grant.scope), fence.fenceId, grant.principalId, this.incarnation, fence.epoch, leaseUntil] });
      if (result.rows.length !== 1) throw new StorageInvalidCommandError('writer ownership cannot move backwards');
    });
  }
  async visible(session: PgSession, root: string | null, target: string, seen = new Set<string>()): Promise<void> {
    if (seen.has(target)) return;
    if (seen.size >= 128) throw new PostgresStorageError('corruption');
    seen.add(target);
    if (await this.roots.get(session, root, 'barrier', target) || await this.roots.get(session, root, 'disposed', target)) throw new StorageDeniedError('target is covered or disposed');
    const parents = await this.roots.get<readonly string[]>(session, root, 'parents', target) ?? [];
    for (const parent of parents) await this.visible(session, root, parent, seen);
  }
}
export const openPgCore = async (options: PostgresStorageOptions): Promise<PgCore> => {
  if (!options.history) throw new PostgresStorageError('configuration');
  const provisional = new PgCore(options, options.incarnation ?? `store:${randomUUID()}`);
  const assets = await loadPgAssets();
  const incarnation = await provisional.tx.run(false, async (session) => {
    await verifyPgInstallation(session, options.layout, assets, options.history);
    await session.execute({ text: `INSERT INTO ${provisional.roots.schema}.modules(module,incarnation) VALUES($1,$2) ON CONFLICT(module) DO NOTHING`, values: [options.moduleId, provisional.incarnation] });
    const result = await session.execute({ text: `SELECT incarnation FROM ${provisional.roots.schema}.modules WHERE module=$1`, values: [options.moduleId] });
    const stored = decodePgText(result.rows[0]?.incarnation);
    if (options.incarnation !== undefined && options.incarnation !== stored) throw new PostgresStorageError('configuration');
    return stored;
  });
  return new PgCore(options, incarnation);
};
