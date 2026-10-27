// PostgreSQL open/commit ownership guards (lot E4, R1).
// G-P0a: retained session at open + installed catalog verification (trigger
// binding, deferral, enabled state — a fingerprint cannot see those).
// G-P0b: commit-point guard inside the committing transaction; the caller
// hook runs last. A 1-connection pool proves no second transaction opens.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import {
  assertNoDeprecatedAssetNames,
  assertPgOwnershipCatalog,
  ensurePgModuleRecord,
} from '../../src/storage/postgres/instance-guard.js';
import { resolvePgStoreKey } from '../../src/storage/postgres/instance-ownership.js';
import type { PgInstanceOwnershipSession } from '../../src/storage/postgres/instance-ownership.js';
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
import type { InjectedPgDriver, PgSession, SqlResult } from '../../src/storage/postgres/protocol.js';
import { loadPgAssets } from '../../src/storage/postgres/migrations.js';
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

const withCanonical = (options: PgTestFixture['options'], leaseMs = 60000) =>
  createPostgresKernel({ ...options, canonicalOwnership: { leaseMs } });

describe('pg instance store identity', () => {
  it('derives one store key per schema and module', () => {
    assert.equal(resolvePgStoreKey('s', 'comments'), resolvePgStoreKey('s', 'comments'));
    assert.notEqual(resolvePgStoreKey('s', 'comments'), resolvePgStoreKey('s', 'engram-live'));
    assert.notEqual(resolvePgStoreKey('s', 'comments'), resolvePgStoreKey('other', 'comments'));
  });
});

describe('pg installed asset guard', () => {
  it('accepts the published assets and refuses deprecated names', async () => {
    const assets = await loadPgAssets();
    assertNoDeprecatedAssetNames(assets);
    const ghost = {
      id: 'cluster-mesh-pg/008-legacy@1',
      file: '008-legacy.sql',
      order: 8,
      dialect: 'postgresql',
      mode: 'transactional',
      fromVersion: 7,
      toVersion: 8,
      requires: ['cluster-mesh-pg/007-consumed-counters@1'],
      sql: 'SELECT 1',
      checksum: '0'.repeat(64),
    } as const;
    assert.throws(
      () => assertNoDeprecatedAssetNames([...assets, ghost]),
      (error: unknown) => error instanceof PostgresStorageError,
    );
  });

  it('does not flag hold, old or tmp as substrings', () => {
    for (const file of ['threshold.sql', 'hold.sql', 'scaffold.sql', '001-core.sql', '007-consumed-counters.sql']) {
      assertNoDeprecatedAssetNames([{ file }]);
    }
    for (const file of ['legacy.sql', 'x-backup.sql', 'tmp.sql', 'old.sql']) {
      assert.throws(() => assertNoDeprecatedAssetNames([{ file }]), (error: unknown) => error instanceof PostgresStorageError);
    }
  });
});

/**
 * Enablement pin for the lease backstop (no PG needed: canned catalog rows).
 * 008 creates a plain constraint trigger, born `tgenabled='O'` (origin+local,
 * the PostgreSQL default); `'A'` (ENABLE ALWAYS) is accepted too, `'D'` and
 * `'R'` are refused as `open-refused`. Replica mode (`session_replication_role
 * = replica`) skips `'O'` triggers, so the backstop only guards the primary:
 * E4 is single-primary by design (no replicas), recorded as a qualification
 * limit in BRANCH.md — the in-tx renewal UPDATE stays the primary guard.
 */
describe('pg ownership catalog enablement', () => {
  const catalogRows = (tgenabled: string, withTrigger = true) => ({
    columns: [
      { column_name: 'module', data_type: 'text' },
      { column_name: 'instance', data_type: 'text' },
      { column_name: 'epoch', data_type: 'text' },
      { column_name: 'holder_until', data_type: 'timestamp with time zone' },
    ],
    checks: [{ definition: "CHECK (epoch <= '18446744073709551615'::text)" }],
    triggers: withTrigger
      ? [
          {
            tgname: 'instance_ownership_lease',
            tgenabled,
            tgdeferrable: true,
            tginitdeferred: true,
            tgtype: 17,
            proname: 'instance_ownership_guard',
            lanname: 'plpgsql',
            prosrc: 'IF NEW.holder_until IS NULL OR NEW.holder_until <= clock_timestamp() THEN RAISE',
          },
        ]
      : [],
  });
  const catalogSession = (rows: ReturnType<typeof catalogRows>): PgSession => ({
    execute: async ({ text }): Promise<SqlResult> => {
      if (text.includes('information_schema')) return { rows: rows.columns, rowCount: rows.columns.length };
      if (text.includes('pg_constraint')) return { rows: rows.checks, rowCount: rows.checks.length };
      return { rows: rows.triggers, rowCount: rows.triggers.length };
    },
  });
  it("accepts the born 'O' enablement", async () => {
    await assertPgOwnershipCatalog(catalogSession(catalogRows('O')), 'probe');
  });
  it("accepts the 'A' (always) enablement", async () => {
    await assertPgOwnershipCatalog(catalogSession(catalogRows('A')), 'probe');
  });
  it("refuses a 'D' (disabled) trigger as open-refused", async () => {
    await assert.rejects(
      assertPgOwnershipCatalog(catalogSession(catalogRows('D')), 'probe'),
      (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
    );
  });
  it("refuses an 'R' (replica-only) trigger as open-refused", async () => {
    await assert.rejects(
      assertPgOwnershipCatalog(catalogSession(catalogRows('R')), 'probe'),
      (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
    );
  });
  it('refuses a missing trigger as open-refused', async () => {
    await assert.rejects(
      assertPgOwnershipCatalog(catalogSession(catalogRows('O', false)), 'probe'),
      (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
    );
  });
});

describe.skipIf(!pgEnabled)('postgres open/commit ownership guards', () => {
  it('retains the open-time session on the kernel (G-P0a)', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await withCanonical(fixture.options);
      const retained = { ...owned(first).handle };
      assert.equal(retained.storageEpoch, '1');
      const rows = await fixture.tx.run(true, (session) =>
        session.execute({
          text: `SELECT holder_until, clock_timestamp() AS now FROM "${fixture.name}".instance_ownership WHERE module='comments'`,
          values: [],
        }),
      );
      assert.equal(rows.rows.length, 1);
      const holderUntil = rows.rows[0]!.holder_until;
      const now = rows.rows[0]!.now;
      const holderMs = holderUntil instanceof Date ? holderUntil.getTime() : new Date(holderUntil as string).getTime();
      const nowMs = now instanceof Date ? now.getTime() : new Date(now as string).getTime();
      assert.ok(holderMs > nowMs, 'the retained lease outlives the open transaction');
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'instance-busy',
      );
      await owned(first).release();
      const second = await withCanonical(fixture.options);
      assert.equal(owned(second).handle.storageEpoch, '2');
      assert.equal(owned(second).handle.instanceId, retained.instanceId);
    } finally {
      await fixture.close();
    }
  });

  it('verifies the installed trigger catalog (G-P0a)', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options);
      await fixture.tx.run(true, (session) => assertPgOwnershipCatalog(session, fixture.name));
      // Release first: the reopen below must be refused for the missing
      // trigger, not for a live lease.
      await owned(kernel).release();
      await fixture.tx.run(false, (session) =>
        session.execute({ text: `DROP TRIGGER instance_ownership_lease ON "${fixture.name}".instance_ownership`, values: [] }),
      );
      await assert.rejects(
        fixture.tx.run(true, (session) => assertPgOwnershipCatalog(session, fixture.name)),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
      );
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
      );
    } finally {
      await fixture.close();
    }
  });

  it('runs the durable guard before the caller hook and refuses terminal commits (G-P0b)', async () => {
    let calls = 0;
    const fixture = await createPgFixture();
    try {
      const kernel = await createPostgresKernel({
        ...fixture.options,
        canonicalOwnership: { leaseMs: 60000 },
        onCommitPossession: () => {
          calls += 1;
        },
      });
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      const unitFor = (chainId: string) => ({
        guards: [],
        records: [],
        appends: [
          {
            chainId,
            record: { id: `${chainId}-1`, bytes: '{"n":1}', hash: `hash-${chainId}` },
            expectation: { kind: 'absent', allocation: '0' } as const,
          },
        ],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      });
      await bound.commitAtomic(unitFor('guard-chain-1'));
      assert.ok(calls >= 1);
      const before = calls;
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET instance='intruder' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(
        bound.commitAtomic(unitFor('guard-chain-2')),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss',
      );
      assert.equal(calls, before);
    } finally {
      await fixture.close();
    }
  });

  it('commits through a single-connection pool without opening a second transaction', async () => {
    const fixture = await createPgFixture();
    try {
      let active = 0;
      let peak = 0;
      const raw = fixture.options.driver;
      const limited: InjectedPgDriver = {
        transaction: async (options, operation) => {
          active += 1;
          peak = Math.max(peak, active);
          assert.ok(active <= 1, 'the guard must reuse the committing session, not open a second transaction');
          try {
            return await raw.transaction(options, operation);
          } finally {
            active -= 1;
          }
        },
      };
      const kernel = await createPostgresKernel({ ...fixture.options, driver: limited, canonicalOwnership: { leaseMs: 60000 } });
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      await bound.commitAtomic({
        guards: [],
        records: [],
        appends: [
          {
            chainId: 'pool-chain',
            record: { id: 'p1', bytes: '{"n":1}', hash: 'hash-p1' },
            expectation: { kind: 'absent', allocation: '0' } as const,
          },
        ],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      });
      assert.equal(peak, 1);
      const check = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      assert.equal(await check.readHead('pool-chain'), 'hash-p1');
    } finally {
      await fixture.close();
    }
  });

  it('refuses to commit a lease that expires inside the transaction (trigger backstop)', async () => {
    const fixture = await createPgFixture();
    try {
      await withCanonical(fixture.options);
      // A raw write that kills the lease cannot commit: the deferred
      // trigger re-checks liveness at COMMIT time, inside the transaction.
      await assert.rejects(
        fixture.tx.run(false, (session) =>
          session.execute({
            text: `UPDATE "${fixture.name}".instance_ownership SET holder_until = clock_timestamp() - make_interval(secs => 1) WHERE module='comments'`,
            values: [],
          }),
        ),
        (error: unknown) => error instanceof PostgresStorageError && error.sqlState === 'P0001',
      );
    } finally {
      await fixture.close();
    }
  });

  it('refuses a module record that diverges from options (readback)', async () => {
    const fixture = await createPgFixture();
    try {
      const incarnation = 'fixed-test-incarnation';
      await createPostgresKernel({ ...fixture.options, incarnation });
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".modules SET incarnation='intruder' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(createPostgresKernel({ ...fixture.options, incarnation }), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        return true;
      });
    } finally {
      await fixture.close();
    }
  });

  it('reads the module record back through the installed guard', async () => {
    const fixture = await createPgFixture();
    try {
      const stored = await fixture.tx.run(false, (session) =>
        ensurePgModuleRecord(session, `"${fixture.name}"`, {
          moduleId: 'comments',
          incarnation: 'readback-incarnation',
          effectiveIncarnation: 'readback-incarnation',
        }),
      );
      assert.equal(stored, 'readback-incarnation');
      const rows = await fixture.tx.run(true, (session) =>
        session.execute({
          text: `SELECT incarnation FROM "${fixture.name}".modules WHERE module='comments'`,
          values: [],
        }),
      );
      assert.equal(decodePgText(rows.rows[0]?.incarnation), 'readback-incarnation');
    } finally {
      await fixture.close();
    }
  });
});
