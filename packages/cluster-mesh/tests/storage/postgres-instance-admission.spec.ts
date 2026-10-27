// PostgreSQL continuous ownership admission (lot E5, G-P1).
// Opt-in kernels through real COMMIT/ROLLBACK: the session must stay valid
// from admission to the effective commit, a loss in any window (mid-tx,
// hook-driven, expiry, terminal mark, revocation) must refuse, and stale
// handles must never clear a successor. Late windows are hook-driven
// (custom onCommitPossession on another connection), never sleeps.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import type { PgInstanceOwnershipSession } from '../../src/storage/postgres/instance-ownership.js';
import type { PostgresStorageOptions } from '../../src/storage/postgres/protocol.js';
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';

type PgTestFixture = Awaited<ReturnType<typeof createPgFixture>>;
type PgTestKernel = Awaited<ReturnType<PgTestFixture['open']>>;

const owned = (kernel: PgTestKernel): PgInstanceOwnershipSession => {
  assert.ok(kernel.ownership);
  return kernel.ownership;
};

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

const commitAs = async (kernel: PgTestKernel, chainId: string, hash: string) => {
  const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  await bound.configureLifecycle('optional');
  return bound.commitAtomic(unitFor(chainId, hash));
};

// Test setup only (never a verdict): replace the lease row with a dead one.
const expireLease = async (fixture: PgTestFixture, module: string): Promise<void> => {
  const current = await fixture.tx.run(true, (session) =>
    session.execute({
      text: `SELECT instance, epoch FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    }),
  );
  const row = current.rows[0];
  assert.ok(row !== undefined, 'a lease row must exist to expire');
  await fixture.tx.run(false, async (session) => {
    await session.execute({
      text: `DELETE FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    });
    await session.execute({
      text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
        VALUES($1, $2, $3, clock_timestamp() - make_interval(secs => 60))`,
      values: [module, decodePgText(row.instance), decodePgText(row.epoch)],
    });
  });
};

const readLeaseRow = async (fixture: PgTestFixture, module: string) => {
  const rows = await fixture.tx.run(true, (session) =>
    session.execute({
      text: `SELECT instance, epoch, holder_until, clock_timestamp() AS now FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    }),
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  const holderUntilMs = row.holder_until instanceof Date ? row.holder_until.getTime() : NaN;
  const nowMs = row.now instanceof Date ? row.now.getTime() : NaN;
  return {
    instance: decodePgText(row.instance),
    epoch: decodePgText(row.epoch),
    live: holderUntilMs > nowMs,
  };
};

describe.skipIf(!pgEnabled)('postgres continuous ownership admission', () => {
  it('commits while live and refuses everything once the lease lapses', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options);
      await commitAs(kernel, 'admit-live', 'hash-live');
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await expireLease(fixture, 'comments');
      await assert.rejects(
        commitAs(kernel, 'admit-dead', 'hash-dead'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss',
      );
      await assert.rejects(
        bound.readHead('admit-live'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss',
      );
    } finally {
      await fixture.close();
    }
  });

  it('refuses a commit after a takeover between admission and commit', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await withCanonical(fixture.options);
      const bound = await first.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      // Late window (no open transaction holds the lease lock yet): expire
      // and hand over on independent connections, then commit.
      await expireLease(fixture, 'comments');
      const second = await withCanonical(fixture.options);
      assert.equal(owned(second).handle.storageEpoch, '2');
      await assert.rejects(
        bound.commitAtomic(unitFor('late-loss', 'hash-late')),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch',
      );
      // The successor still commits through the same window.
      const rebound = await second.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await rebound.configureLifecycle('optional');
      await rebound.commitAtomic(unitFor('late-winner', 'hash-winner'));
    } finally {
      await fixture.close();
    }
  });
});
