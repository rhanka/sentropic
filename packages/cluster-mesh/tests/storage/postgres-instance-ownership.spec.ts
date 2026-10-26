// PostgreSQL durable CanonicalInstanceOwnershipV1 (lot E4).
// Same contract name/version/meaning/digest as the neutral registry and the
// SQLite backend; durability comes from the 008 asset single row per module.
// Red until src/storage/postgres/instance-*.ts lands.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  type CanonicalOwnershipCode,
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

// Open-time refusals surface through the open transaction: the canonical
// code rides on the cause of the PostgresStorageError wrapper.
const rejectsCause = async (promise: Promise<unknown>, code: CanonicalOwnershipCode): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PostgresStorageError);
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof CanonicalOwnershipError && cause.code === code;
  });
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
      await rejectsCause(fixture.open(), 'instance-busy');
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

  it('treats a swapped instance row as terminal loss', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await fixture.open();
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET instance='intruder' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(commitAs(kernel, 'swapped-chain', 'hash-swapped'), (error: unknown) => {
        assert.ok(error instanceof PostgresStorageError);
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
    } finally {
      await fixture.close();
    }
  });

  it('carries exact u64 epochs past 2^53 without Number conversion', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await fixture.open();
      assert.equal(owned(first).handle.storageEpoch, '1');
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET epoch='9007199254740992' WHERE module='comments'`,
          values: [],
        }),
      );
      const second = await fixture.open();
      assert.equal(owned(second).handle.storageEpoch, '9007199254740993');
      assert.equal(owned(second).handle.instanceId, owned(first).handle.instanceId);
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET epoch='18446744073709551615' WHERE module='comments'`,
          values: [],
        }),
      );
      const top = await fixture.open();
      assert.equal(owned(top).handle.storageEpoch, '18446744073709551615');
      await rejectsCause(fixture.open(), 'stale-epoch');
    } finally {
      await fixture.close();
    }
  });

  it('isolates ownership per module and per store', async () => {
    const fixture = await createPgFixture();
    const other = await createPgFixture();
    try {
      const comments = await fixture.open();
      const live = await createPostgresKernel({ ...fixture.options, moduleId: 'engram-live' });
      assert.equal(owned(comments).handle.storageEpoch, '1');
      assert.equal(owned(live).handle.storageEpoch, '1');
      assert.notEqual(owned(live).handle.instanceId, owned(comments).handle.instanceId);
      assert.notEqual(owned(live).handle.storeKey, owned(comments).handle.storeKey);
      const rows = await ownershipRow(fixture);
      assert.equal(rows.length, 2);
      const alone = await other.open();
      assert.equal(owned(alone).handle.storageEpoch, '1');
      assert.notEqual(owned(alone).handle.instanceId, owned(comments).handle.instanceId);
    } finally {
      await fixture.close();
      await other.close();
    }
  });

  it('refuses to open when the ownership table is not installed', async () => {
    const legacy = (await loadPgAssets()).filter((asset) => asset.toVersion <= 7);
    assert.ok(legacy.length === 7);
    const fixture = await createPgFixture({ assets: legacy });
    try {
      await rejectsCause(fixture.open(), 'open-refused');
    } finally {
      await fixture.close();
    }
  });
});
