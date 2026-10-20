import { describe, expect, it } from 'vitest';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import type { InjectedPgDriver, PgSession, SqlStatement } from '../../src/storage/postgres/protocol.js';

const fixture = (failures = 0, synchronousCommit = 'remote_apply') => {
  const statements: SqlStatement[] = [];
  const seen: PgSession[] = [];
  let attempts = 0;
  const driver: InjectedPgDriver = { transaction: async (options, operation) => {
    expect(options.isolation).toBe('serializable'); expect(options.deadlineMs).toBeGreaterThan(0);
    const session: PgSession = { execute: async (statement) => { statements.push(statement); return { rows: statement.text === 'SHOW synchronous_commit' ? [{ synchronous_commit: synchronousCommit }] : [] }; } };
    seen.push(session); attempts += 1;
    const result = await operation(session);
    if (attempts <= failures) throw { code: '40001' };
    return result;
  } };
  return { transactions: new PgTransactions(driver), statements, seen, attempts: () => attempts };
};
describe('Postgres transaction policy', () => {
  it('should keep one injected session, finite local settings and stronger durability', async () => {
    const f = fixture();
    let retained: PgSession | undefined;
    await f.transactions.run(false, async (session) => { retained = session; expect(f.seen).toHaveLength(1); await session.execute({ text: 'SELECT $1::text', values: ['canonical bytes'] }); });
    await expect(retained!.execute({ text: 'SELECT 1', values: [] })).rejects.toMatchObject({ condition: 'timeout' });
    expect(f.statements.some((statement) => statement.text.includes('synchronous_commit') && statement.text !== 'SHOW synchronous_commit')).toBe(false);
    expect(f.statements.some((statement) => statement.text.includes('set_config') && statement.values.includes('250ms'))).toBe(true);
    expect(f.statements.at(-1)?.values).toEqual(['canonical bytes']);
  });
  it('should retry only explicitly immutable flushes and stop after the attempt bound', async () => {
    const f = fixture(2); let executions = 0;
    expect(await f.transactions.run(false, async () => { executions += 1; return 'receipt'; }, true)).toBe('receipt');
    expect(executions).toBe(3);
    const never = fixture(5);
    await expect(never.transactions.run(false, async () => 'value', true)).rejects.toMatchObject({ condition: 'contention' });
    expect(never.attempts()).toBe(3);
    const callback = fixture(1);
    await expect(callback.transactions.run(false, async () => 'callback')).rejects.toMatchObject({ condition: 'contention' });
    expect(callback.attempts()).toBe(1);
  });
});
