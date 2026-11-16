import { describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';

describe.skipIf(!pgEnabled)('Postgres fixture deadline cleanup', () => {
  it('releases server locks before a timed-out transaction rejects', async () => {
    const fixture = await createPgFixture();
    const observer = testPgDriver();
    let pid: number | undefined;
    try {
      await expect(fixture.options.driver.transaction(
        { isolation: 'serializable', readOnly: true, deadlineMs: 100 },
        async (session) => {
          await session.execute({ text: `SELECT * FROM "${fixture.name}".host_history LIMIT 1`, values: [] });
          pid = (await session.execute({ text: 'SELECT pg_backend_pid() AS pid', values: [] })).rows[0]!.pid as number;
          await session.execute({ text: 'SELECT pg_sleep(1)', values: [] });
        },
      )).rejects.toMatchObject({ code: '57014' });
      const active = await observer.driver.transaction(
        { isolation: 'serializable', readOnly: true, deadlineMs: 2000 },
        (session) => session.execute({ text: 'SELECT mode FROM pg_locks WHERE pid=$1 AND relation=$2::regclass', values: [pid, `"${fixture.name}".host_history`] }),
      );
      expect(pid).toBeTypeOf('number');
      expect(active.rows).toEqual([]);
    } finally {
      try { await fixture.close(); }
      finally { await observer.close(); }
    }
  });
});
