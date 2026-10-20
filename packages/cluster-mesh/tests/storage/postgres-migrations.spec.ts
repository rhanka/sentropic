import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { loadPgAssets, applyPgMigrations, verifyPgInstallation, type PgHostHistory, type PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
describe.skipIf(!pgEnabled)('host-owned migration attachment', () => {
  const fixture = pgEnabled ? testPgDriver() : undefined;
  const name = `migration_${randomBytes(6).toString('hex')}`;
  const layout = { dataSchema: name, projectionSchemas: {}, outboxSchema: name };
  afterAll(async () => {
    if (!fixture) return;
    await fixture.driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 2000 }, (session) => session.execute({ text: `DROP SCHEMA IF EXISTS "${name}" CASCADE`, values: [] }));
    await fixture.close();
  });
  it('commits host-linked receipts and rejects actual schema or history drift', async () => {
    const tx = new PgTransactions(fixture!.driver);
    const assets = await loadPgAssets();
    // This is the host's history, not a second backend-owned scheduler.
    const history: PgHostHistory = {
      read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt as PgMigrationReceipt),
      complete: async (session, receipt) => { await session.execute({ text: `INSERT INTO "${name}".host_history(ordinal,receipt) VALUES($1,$2::jsonb)`, values: [receipt.order, JSON.stringify(receipt)] }); },
    };
    await tx.run(false, async (session) => {
      await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY, receipt jsonb NOT NULL)`, values: [] });
      await applyPgMigrations(session, layout, assets, history, { id: 'drizzle-shaped/0043', checksum: 'a'.repeat(64) });
    });
    await tx.run(true, (session) => verifyPgInstallation(session, layout, assets, history));
    await tx.run(false, (session) => session.execute({
      text: `CREATE TABLE "${name}".host_business(id integer PRIMARY KEY); CREATE FUNCTION "${name}".host_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'`, values: [],
    }));
    await tx.run(true, (session) => verifyPgInstallation(session, layout, assets, history));
    await tx.run(false, async (session) => { await session.execute({ text: `ALTER TABLE "${name}".payloads ADD COLUMN unregistered text`, values: [] }); });
    await expect(tx.run(true, (session) => verifyPgInstallation(session, layout, assets, history))).rejects.toMatchObject({ condition: 'schema-drift', retryable: false });
    await tx.run(false, async (session) => { await session.execute({ text: `ALTER TABLE "${name}".payloads DROP COLUMN unregistered; UPDATE "${name}".host_history SET receipt=jsonb_set(receipt,'{appliedChecksum}','"wrong"') WHERE ordinal=1`, values: [] }); });
    await expect(tx.run(true, (session) => verifyPgInstallation(session, layout, assets, history))).rejects.toMatchObject({ condition: 'configuration' });
  });
});
