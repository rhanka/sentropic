import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
import type { PostgresStorageOptions } from '../../src/storage/postgres/protocol.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import type { InjectedPgDriver, PgSession, SqlStatement } from '../../src/storage/postgres/protocol.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';

const withCanonical = (options: PostgresStorageOptions, leaseMs = 60000) =>
  createPostgresKernel({ ...options, canonicalOwnership: { leaseMs } });

const unitFor = (chainId: string, hash: string) => ({
  guards: [],
  records: [],
  appends: [
    {
      chainId,
      record: { id: `${chainId}-1`, bytes: '{"n":1}', hash },
      expectation: { kind: 'absent', allocation: '0' } as const,
    },
  ],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const fixture = (failures = 0, synchronousCommit = 'remote_apply', code = '40001') => {
  const statements: SqlStatement[] = [];
  const seen: PgSession[] = [];
  let attempts = 0;
  const driver: InjectedPgDriver = { transaction: async (options, operation) => {
    expect(options.isolation).toBe('serializable'); expect(options.deadlineMs).toBeGreaterThan(0);
    const session: PgSession = { execute: async (statement) => { statements.push(statement); return { rows: statement.text === 'SHOW synchronous_commit' ? [{ synchronous_commit: synchronousCommit }] : [] }; } };
    seen.push(session); attempts += 1;
    const result = await operation(session);
    if (attempts <= failures) throw { code };
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
  it('passes ownership failures through without retry, even on immutable flush', async () => {
    const f = fixture();
    const failure = new CanonicalOwnershipError('instance-busy', 'concurrent acquisition in progress');
    await assert.rejects(
      f.transactions.run(false, async () => { throw failure; }, true),
      (error: unknown) => error === failure,
    );
    assert.equal(f.attempts(), 1);
  });
  it('maps lock waits to non-retryable timeouts', async () => {
    const f = fixture(5, 'remote_apply', '55P03');
    await assert.rejects(
      f.transactions.run(false, async (session) => session.execute({ text: 'SELECT 1', values: [] }), true),
      (error: unknown) => error instanceof PostgresStorageError && error.condition === 'timeout',
    );
    assert.equal(f.attempts(), 1);
  });
});

describe.skipIf(!pgEnabled)('postgres transactions through real commits', () => {
  it('commits nested contributions from two grants in one session', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options);
      const outer = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      const inner = await kernel.bindNew(
        grantFor({ token: 'token-test-2', operations: ['read', 'write', 'maintain'] }),
      );
      await outer.configureLifecycle('optional');
      await inner.configureLifecycle('optional');
      await outer.transact({}, async (tx) => {
        await tx.apply(unitFor('nested-outer', 'hash-outer'));
        await inner.transact({}, async (nested) => {
          await nested.apply(unitFor('nested-inner', 'hash-inner'));
        });
      });
      assert.equal(await outer.readHead('nested-outer'), 'hash-outer');
      assert.equal(await inner.readHead('nested-inner'), 'hash-inner');
    } finally {
      await fixture.close();
    }
  });
  it('a caught inner error still poisons the commit', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options);
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      await assert.rejects(
        bound.transact({}, async (tx) => {
          try {
            await tx.apply({
              ...unitFor('poison-oversize', 'hash-poison'),
              records: [
                {
                  key: 'too-big',
                  contentHash: 'h',
                  bytes: { format: 'utf8' as const, data: 'x'.repeat(600_000) },
                },
              ],
            });
          } catch {
            // Swallowed: the failed contribution must still refuse the commit.
          }
          await tx.apply(unitFor('poison-after', 'hash-after'));
        }),
        (error: unknown) => error instanceof Error && /exceeds work limits/.test(error.message),
      );
      assert.equal(await bound.readHead('poison-after'), null);
    } finally {
      await fixture.close();
    }
  });
  it('retries after a hook failure and replays the committed receipt', async () => {
    const fixture = await createPgFixture();
    try {
      // The hook runs on every committing transaction (lifecycle included):
      // fail only the first data commit, then let the retry through.
      let commits = 0;
      const kernel = await createPostgresKernel({
        ...fixture.options,
        canonicalOwnership: { leaseMs: 60000 },
        onCommitPossession: async () => {
          commits += 1;
          if (commits === 2) throw new Error('hook-induced unknown outcome');
        },
      });
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      const key = 'transactions-retry-key';
      await assert.rejects(
        bound.commitAtomic(unitFor('retry-chain', 'hash-retry'), { idempotencyKey: key }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('Postgres storage unavailable') &&
          (error as Error & { cause?: unknown }).cause instanceof Error &&
          ((error as Error & { cause?: Error }).cause as Error).message === 'hook-induced unknown outcome',
      );
      const first = await bound.commitAtomic(unitFor('retry-chain', 'hash-retry'), { idempotencyKey: key });
      const replayed = await bound.commitAtomic(unitFor('retry-chain', 'hash-retry'), { idempotencyKey: key });
      assert.deepEqual(replayed, first);
      assert.equal((await bound.readChain('retry-chain')).length, 1);
    } finally {
      await fixture.close();
    }
  });
});
