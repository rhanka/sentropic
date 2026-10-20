import { afterAll, describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
describe.skipIf(!pgEnabled)('real injected Postgres transactions', () => {
  const fixture = pgEnabled ? testPgDriver() : undefined;
  afterAll(() => fixture?.close());
  it('uses one backend connection, rolls back and cancels bounded SQL', async () => {
    const tx = new PgTransactions(fixture!.driver);
    await tx.run(false, async (session) => {
      const first = await session.execute({ text: 'SELECT pg_backend_pid() AS pid', values: [] });
      const second = await session.execute({ text: 'SELECT pg_backend_pid() AS pid', values: [] });
      expect(first.rows[0]?.pid).toBe(second.rows[0]?.pid);
      const settings = await session.execute({ text: 'SHOW synchronous_commit', values: [] });
      expect(settings.rows[0]?.synchronous_commit).toBe('on');
    });
    await expect(tx.run(false, async (session) => {
      await session.execute({ text: 'CREATE TABLE cm_rollback_probe (value integer)', values: [] });
      throw new Error('rollback');
    })).rejects.toMatchObject({ condition: 'unavailable' });
    await tx.run(true, async (session) => {
      expect((await session.execute({ text: "SELECT to_regclass('cm_rollback_probe') AS name", values: [] })).rows[0]?.name).toBeNull();
    });
    const bounded = new PgTransactions(fixture!.driver, { statementMs: 20 });
    await expect(bounded.run(true, (session) => session.execute({ text: 'SELECT pg_sleep(1)', values: [] }))).rejects.toMatchObject({ condition: 'timeout' });
  });
});
