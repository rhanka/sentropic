// PostgreSQL open/commit ownership guards (lot E4).
// G-P0a: open-time retained session. G-P0b: commit-point durable possession
// check chained before the caller hook. Installed guards: asset
// deprecated-name scan and module-record readback.
// Red until src/storage/postgres/instance-*.ts lands.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import {
  assertNoDeprecatedAssetNames,
  ensurePgModuleRecord,
} from '../../src/storage/postgres/instance-guard.js';
import {
  resolvePgStoreKey,
  type PgInstanceOwnershipSession,
} from '../../src/storage/postgres/instance-ownership.js';
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
import { loadPgAssets } from '../../src/storage/postgres/migrations.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';

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
      id: 'cluster-mesh-pg/008-future@1',
      file: '008-future.sql',
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
});

const owned = (kernel: { readonly ownership: PgInstanceOwnershipSession | null }): PgInstanceOwnershipSession => {
  assert.ok(kernel.ownership);
  return kernel.ownership;
};

describe.skipIf(!pgEnabled)('postgres open/commit ownership guards', () => {
  it('retains the open-time session on the kernel (G-P0a)', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await fixture.open();
      const retained = { ...owned(first).handle };
      const second = await fixture.open();
      assert.equal(owned(second).handle.storageEpoch, '2');
      assert.equal(owned(second).handle.instanceId, retained.instanceId);
      assert.deepEqual({ ...owned(first).handle }, retained);
    } finally {
      await fixture.close();
    }
  });

  it('runs the durable guard before the caller hook and refuses terminal commits (G-P0b)', async () => {
    let calls = 0;
    const fixture = await createPgFixture({
      onCommitPossession: () => {
        calls += 1;
      },
    });
    try {
      const kernel = await fixture.open();
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
          text: `UPDATE "${fixture.name}".instance_ownership SET epoch='777' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(bound.commitAtomic(unitFor('guard-chain-2')), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
      assert.equal(calls, before);
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
