import { randomBytes } from 'node:crypto';
import { testPgDriver } from '../storage/pg-driver.js';
import { grantFor } from '../storage/authority-corpus.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { applyPgMigrations, type PgHostHistory, type PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { checkMemoryPostgresDriver, createMemoryPostgresRegistration } from '../../src/engram-memory/postgres.js';
import { assembleMemoryHostBinding } from '../../src/engram-memory/binding.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

export const memoryGrant = (workspaceId = 'workspace-a') => grantFor({
  token: `memory-${workspaceId}`, moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-a', workspaceId }, operations: ['read', 'write', 'maintain'],
});
/** Qualified host-owned PG driver/pool provider for the qualification stack (postgres:17). */
export const memoryHostProvider = () => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'c'.repeat(64) },
  serverFloor: '17.0.0',
});
/**
 * Host composition over an opened host: the provider is checked, then the
 * distinct host-issued maintain binding is assembled. Callers run fence and
 * storage calls through `binding.maintainGrant`, never the neutral handle.
 */
export const memoryHostComposed = () => {
  const driver = memoryHostProvider();
  checkMemoryPostgresDriver(driver);
  const binding = assembleMemoryHostBinding({ driver, maintainGrant: memoryGrant() });
  return { provider: driver, binding, grant: binding.maintainGrant };
};
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
