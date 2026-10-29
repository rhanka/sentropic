import { testPgDriver } from '../storage/pg-driver.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { createMemoryPostgresRegistration } from '../../src/engram-memory/postgres.js';
import type { PgHostHistory, PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';

// Independent connection/pool over an already migrated host-owned schema.
// This peer never creates, migrates, drops or re-attests the owner's data.
export const memoryPgExisting = async (name: string) => {
  if (!/^memory_[a-f0-9]{12}$/.test(name)) throw new Error('invalid campaign schema');
  const connection = testPgDriver();
  const tx = new PgTransactions(connection.driver);
  const layout = { dataSchema: name, projectionSchemas: { 'engram-memory': `${name}_projection` }, outboxSchema: name };
  const history: PgHostHistory = {
    read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] }))
      .rows.map((row) => row.receipt as PgMigrationReceipt),
    complete: async () => { throw new Error('existing peer may not migrate'); },
  };
  const registration = await createMemoryPostgresRegistration();
  const options = { ...registration, moduleId: 'engram-memory' as const, driver: connection.driver,
    layout, history, cursorSecret: 'memory-host-qualification-secret' };
  return { tx, name, layout, history, registration, options, open: () => createPostgresKernel(options), close: connection.close };
};
