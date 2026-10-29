import { randomBytes } from 'node:crypto';
import { testPgDriver } from '../storage/pg-driver.js';
import { grantFor } from '../storage/authority-corpus.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { applyPgMigrations, type PgHostHistory, type PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { checkMemoryPostgresDriver, createMemoryPostgresRegistration } from '../../src/engram-memory/postgres.js';
import { assembleMemoryHostBinding } from '../../src/engram-memory/binding.js';
import type { MemoryMaintenanceRunner } from '../../src/engram-memory/host-maintenance.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import type { PgPosition } from '../../src/storage/postgres/journal.js';
import type { JournalFence } from '../../src/storage/staged-core.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

export const memoryGrant = (workspaceId = 'workspace-a') => grantFor({
  token: `memory-${workspaceId}`, moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-a', workspaceId }, operations: ['read', 'write', 'maintain'],
});
/**
 * Qualified host-owned PG driver/pool provider for the qualification stack
 * (postgres:17). The live pool is part of the provider: installed calls
 * run through this exact pool, never a separately wired driver.
 */
export const memoryHostProvider = (pool: InjectedPgDriver) => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'c'.repeat(64) },
  serverFloor: '17.0.0',
  pool,
});
/** Host-issued maintain grant: exactly `['maintain']`, never combined. */
export const memoryMaintainGrant = (workspaceId = 'workspace-a') => grantFor({
  token: `memory-maintain-${workspaceId}`, moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-a', workspaceId }, operations: ['read', 'maintain'],
});
/** Neutral Engram-facing grant: exactly `['read','write']`, no maintain authority. */
export const memoryNeutralGrant = (workspaceId = 'workspace-a') => grantFor({
  token: `memory-neutral-${workspaceId}`, moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-a', workspaceId }, operations: ['read', 'write'],
});
/**
 * Host composition: the provider is checked, then the distinct
 * host-issued maintain binding is assembled alongside the derived neutral
 * grant. Engram paths use `binding.memoryGrant`; maintenance paths use
 * `binding.maintainGrant`. The combined `memoryGrant()` is legacy E6
 * coverage only and never enters the host binding.
 */
export const memoryHostComposed = (pool: InjectedPgDriver, invocationId = 'inv-host-1', storeId = 'store-1') => {
  const driver = memoryHostProvider(pool);
  checkMemoryPostgresDriver(driver);
  const binding = assembleMemoryHostBinding({ driver, maintainGrant: memoryMaintainGrant(), invocationId, storeId });
  return { provider: driver, binding };
};
/** Kernel-bound maintenance surface behind the host-only ports. */
export interface MemoryLiveBound {
  readonly journalFence: () => Promise<JournalFence>;
  readonly journalCheckpoint: (
    consumer: string, expected: PgPosition, next: PgPosition, fence: JournalFence,
  ) => Promise<void>;
  readonly journalPoison: (consumer: string, event: string, reason: string) => Promise<void>;
  readonly journalRetry: (
    consumer: string, expected: string | null, fence: JournalFence,
  ) => Promise<void>;
  readonly journalResync: (
    consumer: string, fence: JournalFence,
  ) => Promise<{ snapshotRoot: string; journalSeq: string }>;
  readonly snapshotRead: (
    token: string, after: number, limit: number,
  ) => Promise<{ rows: readonly unknown[] }>;
}
/**
 * Live maintenance runner for the positive fixture: every port delegates
 * 1:1 to the kernel-bound handle, which enforces the runner authority on
 * every call. The runner is bound to the host-only `['read', 'maintain']`
 * grant (never Engram's neutral handle): consumer delivery and snapshot
 * reads need the read leg, maintenance the maintain leg; `write` is never
 * carried, so the write path cannot reach maintain authority.
 */
export const memoryLiveRunner = (
  grant: ScopeGrant<unknown>,
  bound: MemoryLiveBound,
): MemoryMaintenanceRunner => ({
  grant,
  currentFence: () => bound.journalFence(),
  checkpoint: (consumer, expected, next, fence) => bound.journalCheckpoint(consumer, expected, next, fence),
  poison: (consumer, event, reason) => bound.journalPoison(consumer, event, reason),
  retry: (consumer, expected, fence) => bound.journalRetry(consumer, expected, fence),
  resync: (consumer, fence) => bound.journalResync(consumer, fence),
  snapshot: (token, after, limit) => bound.snapshotRead(token, after, limit),
});
export const memoryUnit = (extra: Partial<AtomicUnit> = {}): AtomicUnit => ({
  guards: [], records: [], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [], ...extra,
});
export const memoryUpdate = (key: readonly string[], value: unknown, version = 1) => ({
  key: JSON.stringify(key), version, value: { format: 'utf8' as const, data: JSON.stringify(value) },
});
export const memoryAppend = (cursor: string, previous?: string) => ({
  chainId: 'memory-journal',
  record: { id: `event-${cursor}`, hash: `hash-${cursor}`, bytes: JSON.stringify({
    event_id: `event-${cursor}`, intent_hash: `intent-${cursor}`, cursor,
  }) },
  expectation: previous ? { kind: 'head' as const, hash: previous } : { kind: 'absent' as const, allocation: '0' },
});
export const memoryPgHost = async () => {
  const connection = testPgDriver();
  const name = `memory_${randomBytes(6).toString('hex')}`;
  const layout = { dataSchema: name, projectionSchemas: { 'engram-memory': `${name}_projection` }, outboxSchema: name };
  const tx = new PgTransactions(connection.driver);
  const history: PgHostHistory = {
    read: async (session) => (await session.execute({
      text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [],
    })).rows.map((row) => row.receipt as PgMigrationReceipt),
    complete: async (session, receipt) => { await session.execute({
      text: `INSERT INTO "${name}".host_history VALUES ((SELECT COALESCE(MAX(ordinal),0)+1 FROM "${name}".host_history),$1::jsonb)`,
      values: [JSON.stringify(receipt)],
    }); },
  };
  const registration = await createMemoryPostgresRegistration();
  await tx.run(false, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE SCHEMA "${name}_projection";
      CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY, receipt jsonb NOT NULL)`, values: [] });
    await applyPgMigrations(session, layout, registration.assets, history, { id: 'memory-host/001', checksum: 'a'.repeat(64) });
  });
  const options = { ...registration, moduleId: 'engram-memory' as const, driver: connection.driver,
    layout, history, cursorSecret: 'memory-host-qualification-secret' };
  return { tx, name, layout, history, registration, options, open: () => createPostgresKernel(options),
    close: async () => {
      await tx.run(false, (session) => session.execute({
        text: `DROP SCHEMA "${name}_projection" CASCADE; DROP SCHEMA "${name}" CASCADE`, values: [],
      }));
      await connection.close();
    },
  };
};
