// PostgreSQL durable CanonicalInstanceOwnershipV1 (lot E4).
// Same contract name/version/meaning/digest as the neutral registry and the
// SQLite backend; durability comes from the 008 asset single row per module.
// Red until src/storage/postgres/instance-*.ts lands.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
} from '../../src/storage/instance-ownership.js';
import {
  resolvePgStoreKey,
  type PgInstanceOwnershipSession,
} from '../../src/storage/postgres/instance-ownership.js';
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { loadPgAssets } from '../../src/storage/postgres/migrations.js';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';

const COMMIT_UNIT = (chainId: string, hash: string) => ({
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

type PgTestFixture = Awaited<ReturnType<typeof createPgFixture>>;
type PgTestKernel = Awaited<ReturnType<PgTestFixture['open']>>;

const owned = (kernel: PgTestKernel): PgInstanceOwnershipSession => {
  assert.ok(kernel.ownership);
  return kernel.ownership;
};

const commitAs = async (kernel: PgTestKernel, chainId: string, hash: string) => {
  const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  await bound.configureLifecycle('optional');
  return bound.commitAtomic(COMMIT_UNIT(chainId, hash));
};

const ownershipRow = async (fixture: PgTestFixture) => {
  const rows = await fixture.tx.run(true, (session) =>
    session.execute({
      text: `SELECT module, instance, epoch FROM "${fixture.name}".instance_ownership`,
      values: [],
    }),
  );
  return rows.rows.map((row) => ({
    module: decodePgText(row.module),
    instance: decodePgText(row.instance),
    epoch: decodePgText(row.epoch),
  }));
};

describe.skipIf(!pgEnabled)('postgres durable instance ownership', () => {
  it('retains the winning pair at open with epoch 1', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await fixture.open();
      const { handle } = owned(kernel);
      assert.equal(handle.storageEpoch, '1');
      assert.ok(handle.instanceId.length > 0);
      assert.equal(handle.storeKey, resolvePgStoreKey(fixture.name, 'comments'));
      const rows = await ownershipRow(fixture);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.module, 'comments');
      assert.equal(rows[0]!.instance, handle.instanceId);
      assert.equal(rows[0]!.epoch, '1');
    } finally {
      await fixture.close();
    }
  });

  it('refuses a second live holder on the shared registry without queueing', async () => {
    const fixture = await createPgFixture({ instanceRegistry: new CanonicalInstanceRegistry() });
    try {
      await fixture.open();
      await assert.rejects(
        fixture.open(),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'instance-busy',
      );
    } finally {
      await fixture.close();
    }
  });

  it('supersedes monotonically across kernels and turns the loser terminal', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await fixture.open();
      const second = await fixture.open();
      assert.equal(owned(second).handle.storageEpoch, '2');
      assert.equal(owned(second).handle.instanceId, owned(first).handle.instanceId);
      await assert.rejects(commitAs(first, 'loser-chain', 'hash-loser'), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
      const replay = await second.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      assert.equal(await replay.readHead('loser-chain'), null);
      await commitAs(second, 'winner-chain', 'hash-winner');
      const check = await second.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      assert.equal(await check.readHead('winner-chain'), 'hash-winner');
    } finally {
      await fixture.close();
    }
  });

  it('releases and reacquires with a monotone epoch', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await fixture.open();
      owned(first).release();
      const second = await fixture.open();
      assert.equal(owned(second).handle.storageEpoch, '2');
      await assert.rejects(commitAs(first, 'released-chain', 'hash-released'), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
      await commitAs(second, 'reacquired-chain', 'hash-reacquired');
    } finally {
      await fixture.close();
    }
  });

  it('treats a jumped epoch row as terminal loss', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await fixture.open();
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET epoch='999' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(commitAs(kernel, 'jumped-chain', 'hash-jumped'), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
      const check = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      assert.equal(await check.readHead('jumped-chain'), null);
    } finally {
      await fixture.close();
    }
  });
});
