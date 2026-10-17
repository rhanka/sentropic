import { randomBytes } from 'node:crypto';
import { testPgDriver } from './pg-driver.js';
import { loadPgAssets, applyPgMigrations, type PgHostHistory, type PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import type { PostgresStorageOptions } from '../../src/storage/postgres/protocol.js';
export const createPgFixture = async (extra: Partial<PostgresStorageOptions> = {}) => {
  const connection = testPgDriver();
  const name = `storage_${randomBytes(6).toString('hex')}`;
  const layout = { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name };
  const history: PgHostHistory = {
    read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt as PgMigrationReceipt),
    complete: async (session, receipt) => { await session.execute({ text: `INSERT INTO "${name}".host_history VALUES($1,$2::jsonb)`, values: [receipt.order, JSON.stringify(receipt)] }); },
  };
  const tx = new PgTransactions(connection.driver);
  await tx.run(false, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY,receipt jsonb NOT NULL)`, values: [] });
    await applyPgMigrations(session, layout, await loadPgAssets(), history, { id: 'neutral-host/001', checksum: 'a'.repeat(64) });
  });
  const options = { moduleId: 'comments' as const, driver: connection.driver, layout, history, ...extra };
  return {
    options, tx, name, open: () => createPostgresKernel(options), disconnect: connection.close,
    close: async () => {
      await tx.run(false, (session) => session.execute({ text: `DROP SCHEMA "${name}" CASCADE`, values: [] }));
      await connection.close();
    },
  };
};
