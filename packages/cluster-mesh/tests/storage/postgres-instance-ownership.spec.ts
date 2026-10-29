// PostgreSQL durable CanonicalInstanceOwnershipV1 (lot E4, R1).
// Runs the shared semantic corpus for real against opt-in kernels, plus
// lease-specific cases (refusal, release, expiry, u64, isolation).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  type CanonicalOwnershipCode,
} from '../../src/storage/instance-ownership.js';
import { isPositiveU64Counter } from '../../src/storage/u64.js';
import { resolvePgStoreKey } from '../../src/storage/postgres/instance-ownership.js';
import type { PgInstanceOwnershipSession } from '../../src/storage/postgres/instance-ownership.js';
import type { PostgresStorageOptions } from '../../src/storage/postgres/protocol.js';
import type { StorageModuleId } from '../../src/storage/contracts.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { loadPgAssets } from '../../src/storage/postgres/migrations.js';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { defineOwnershipSemantics, type OwnershipCaseDriver, type OwnershipCaseHandle } from './instance-corpus.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';

type PgTestFixture = Awaited<ReturnType<typeof createPgFixture>>;
type PgTestKernel = Awaited<ReturnType<PgTestFixture['open']>>;

const owned = (kernel: PgTestKernel): PgInstanceOwnershipSession => {
  assert.ok(kernel.ownership);
  return kernel.ownership;
};

const withCanonical = (
  options: PostgresStorageOptions,
  extra: { moduleId?: StorageModuleId; canonicalOwnership?: { leaseMs?: number; registry?: CanonicalInstanceRegistry } } = {},
) =>
  createPostgresKernel({
    ...options,
    ...extra,
    canonicalOwnership: { leaseMs: 60000, ...(extra.canonicalOwnership ?? {}) },
  });

const commitAs = async (kernel: PgTestKernel, chainId: string, hash: string) => {
  const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  await bound.configureLifecycle('optional');
  return bound.commitAtomic({
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
};

const ownershipRow = async (fixture: PgTestFixture, module: string) => {
  const rows = await fixture.tx.run(true, (session) =>
    session.execute({
      text: `SELECT instance, epoch, holder_until FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    }),
  );
  return rows.rows.map((row) => ({
    instance: decodePgText(row.instance),
    epoch: decodePgText(row.epoch),
  }));
};

/** Canonical decimal comparison without Number conversion (test helper). */
const compareCanon = (left: string, right: string): number => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** Canonical decimal decrement by one, exact (test helper, input > 1). */
const decrementCanon = (value: string): string => {
  const digits = value.split('');
  let index = digits.length - 1;
  while (digits[index] === '0') {
    digits[index] = '9';
    index -= 1;
  }
  digits[index] = String(Number(digits[index]) - 1);
  return digits.join('').replace(/^0+(?=[0-9])/, '');
};

/**
 * Shared-corpus driver over opt-in kernels. Each corpus store maps to a real
 * module id (cycled); explicit epochs re-enter through a seeded expired row,
 * mirroring the registry's re-entry with an explicit epoch.
 */
const pgCaseDriver = (
  fixture: PgTestFixture,
  registry: CanonicalInstanceRegistry,
  leaseMs: number,
): OwnershipCaseDriver => {
  const modules = ['comments', 'engram-live', 'engram-memory'] as const;
  const moduleFor = new Map<string, (typeof modules)[number]>();
  const forStore = (store: string) => {
    const known = moduleFor.get(store);
    if (known) return known;
    const assigned = modules[moduleFor.size % modules.length]!;
    moduleFor.set(store, assigned);
    return assigned;
  };
  interface LiveEntry {
    kernel: PgTestKernel;
    session: PgInstanceOwnershipSession;
    handle: OwnershipCaseHandle;
  }
  const sessions = new Map<OwnershipCaseHandle, LiveEntry>();
  // Durable-row reads (real PG state, never an in-memory map) for setup and
  // `current`. Verdicts come from production: opens allocate through
  // `acquirePgInstanceOwnership`, `verify`/`guard` run the real session and
  // commit paths, `release` expires through `expirePgInstanceLease`.
  const readRow = async (module: string): Promise<{ instance: string; epoch: string; live: boolean } | null> => {
    const rows = await fixture.tx.run(true, (session) =>
      session.execute({
        text: `SELECT instance, epoch, holder_until, clock_timestamp() AS now FROM "${fixture.name}".instance_ownership WHERE module=$1`,
        values: [module],
      }),
    );
    if (rows.rows.length === 0) return null;
    const row = rows.rows[0]!;
    // timestamptz arrives as Date (same coercion as production `decodeLeaseMs`).
    const asMs = (value: unknown): number => new Date(value as string | Date).getTime();
    return {
      instance: decodePgText(row.instance),
      epoch: decodePgText(row.epoch),
      live: asMs(row.holder_until) > asMs(row.now),
    };
  };
  // Seeded setup rows go through DELETE+INSERT, never UPDATE: the deferred
  // lease backstop rejects any UPDATE that commits a dead lease.
  const seedExpired = async (module: string, epoch: string): Promise<void> => {
    await fixture.tx.run(false, async (session) => {
      await session.execute({
        text: `DELETE FROM "${fixture.name}".instance_ownership WHERE module=$1`,
        values: [module],
      });
      await session.execute({
        text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
          VALUES($1, $2, $3, clock_timestamp() - make_interval(secs => 3600))`,
        values: [module, `instance-${randomUUID()}`, epoch],
      });
    });
  };
  return {
    acquire: async (store, epoch) => {
      // Format validation mirrors the registry reference; newness is decided
      // by the durable row, and allocation by production open.
      if (epoch !== undefined && !isPositiveU64Counter(epoch)) {
        throw new CanonicalOwnershipError('stale-epoch', 'not a canonical u64 counter');
      }
      const module = forStore(store);
      if (epoch !== undefined) {
        const row = await readRow(module);
        if (row !== null && compareCanon(epoch, row.epoch) <= 0) {
          throw new CanonicalOwnershipError('stale-epoch', 'explicit epoch is not newer than the durable row');
        }
        if (epoch !== '1' && (row === null || row.epoch !== decrementCanon(epoch))) {
          await seedExpired(module, decrementCanon(epoch));
        }
      }
      const kernel = await createPostgresKernel({
        ...fixture.options,
        moduleId: module,
        canonicalOwnership: { leaseMs, registry },
      });
      const session = owned(kernel);
      const handle: OwnershipCaseHandle = {
        instanceId: session.handle.instanceId,
        storageEpoch: session.handle.storageEpoch,
        storeKey: store,
      };
      sessions.set(handle, { kernel, session, handle });
      return handle;
    },
    verify: async (handle) => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      // The kernel read path: production verify on a real read-only session.
      await fixture.tx.run(true, (txSession) => entry.session.verify(txSession));
    },
    release: async (handle) => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      await entry.session.release();
    },
    markTerminal: async (handle) => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      // Termination is DELETE+INSERT (never UPDATE: the lease backstop
      // rejects an UPDATE committing a dead lease).
      await fixture.tx.run(false, async (session) => {
        await session.execute({
          text: `DELETE FROM "${fixture.name}".instance_ownership WHERE module=$1 AND instance=$2 AND epoch=$3`,
          values: [forStore(handle.storeKey), handle.instanceId, handle.storageEpoch],
        });
        await session.execute({
          text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
            VALUES($1, 'terminated', $2, clock_timestamp())`,
          values: [forStore(handle.storeKey), handle.storageEpoch],
        });
      });
    },
    guard: (handle) => async () => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      // The real commit path through the kernel: the G-P0b hook renews on
      // the committing session, and a dead row refuses the commit.
      await commitAs(entry.kernel, `guard-${randomUUID()}`, 'hash-guard');
    },
    current: async (store) => {
      const row = await readRow(forStore(store));
      if (!row || !row.live) return null;
      return { instanceId: row.instance, storageEpoch: row.epoch, storeKey: store };
    },
  };
};

describe.skipIf(!pgEnabled)('postgres durable instance ownership', () => {
  const setupCase = async () => {
    const fixture = await createPgFixture();
    const registry = new CanonicalInstanceRegistry();
    return {
      driver: pgCaseDriver(fixture, registry, 60000),
      teardown: async () => {
        await fixture.close();
      },
    };
  };
  defineOwnershipSemantics('PostgreSQL durable', setupCase);

  it('refuses a second live opener promptly without queueing or takeover', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await withCanonical(fixture.options);
      assert.equal(owned(first).handle.storageEpoch, '1');
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'instance-busy',
      );
      // The refused open leaves the holder untouched: it still commits.
      await commitAs(first, 'holder-chain', 'hash-holder');
    } finally {
      await fixture.close();
    }
  });

  it('releases and reacquires with a monotone epoch and the same instance', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await withCanonical(fixture.options);
      const retained = { ...owned(first).handle };
      await owned(first).release();
      const second = await withCanonical(fixture.options);
      assert.equal(owned(second).handle.storageEpoch, '2');
      assert.equal(owned(second).handle.instanceId, retained.instanceId);
      // The released handle is stale even though the row still matches.
      await assert.rejects(
        commitAs(first, 'released-chain', 'hash-released'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch',
      );
      await commitAs(second, 'reacquired-chain', 'hash-reacquired');
    } finally {
      await fixture.close();
    }
  });

  it('lets an idle-expired lease be taken over, revoking the old holder', async () => {
    const fixture = await createPgFixture();
    try {
      const first = await withCanonical(fixture.options, { canonicalOwnership: { leaseMs: 300 } });
      const retained = { ...owned(first).handle };
      await new Promise((resolve) => setTimeout(resolve, 900));
      const second = await withCanonical(fixture.options, { canonicalOwnership: { leaseMs: 300 } });
      assert.equal(owned(second).handle.storageEpoch, '2');
      assert.equal(owned(second).handle.instanceId, retained.instanceId);
      await assert.rejects(
        commitAs(first, 'expired-chain', 'hash-expired'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch',
      );
      await commitAs(second, 'takenover-chain', 'hash-takenover');
    } finally {
      await fixture.close();
    }
  });

  it('revokes readers once the retained session lapses', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options, { canonicalOwnership: { leaseMs: 300 } });
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await new Promise((resolve) => setTimeout(resolve, 900));
      await assert.rejects(
        bound.readHead('any-chain'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss',
      );
    } finally {
      await fixture.close();
    }
  });

  it('treats a swapped instance row as terminal loss', async () => {
    const fixture = await createPgFixture();
    try {
      const kernel = await withCanonical(fixture.options);
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET instance='intruder' WHERE module='comments'`,
          values: [],
        }),
      );
      await assert.rejects(
        commitAs(kernel, 'swapped-chain', 'hash-swapped'),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss',
      );
    } finally {
      await fixture.close();
    }
  });

  it('carries exact u64 epochs past 2^53 without Number conversion', async () => {
    const fixture = await createPgFixture();
    // Bumped-epoch setup goes through DELETE+INSERT (never UPDATE: the
    // deferred lease backstop rejects an UPDATE committing a dead lease).
    const expireWithEpoch = async (instance: string, epoch: string): Promise<void> => {
      await fixture.tx.run(false, async (session) => {
        await session.execute({
          text: `DELETE FROM "${fixture.name}".instance_ownership WHERE module='comments'`,
          values: [],
        });
        await session.execute({
          text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
            VALUES('comments', $1, $2, clock_timestamp() - make_interval(secs => 3600))`,
          values: [instance, epoch],
        });
      });
    };
    try {
      const first = await withCanonical(fixture.options);
      assert.equal(owned(first).handle.storageEpoch, '1');
      await expireWithEpoch(owned(first).handle.instanceId, '9007199254740992');
      const second = await withCanonical(fixture.options);
      assert.equal(owned(second).handle.storageEpoch, '9007199254740993');
      assert.equal(owned(second).handle.instanceId, owned(first).handle.instanceId);
      await expireWithEpoch(owned(second).handle.instanceId, '18446744073709551614');
      const top = await withCanonical(fixture.options);
      assert.equal(owned(top).handle.storageEpoch, '18446744073709551615');
      await owned(top).release();
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch',
      );
    } finally {
      await fixture.close();
    }
  });

  it('isolates ownership per module and per store', async () => {
    const fixture = await createPgFixture();
    const other = await createPgFixture();
    try {
      const comments = await withCanonical(fixture.options);
      const live = await withCanonical({ ...fixture.options, moduleId: 'engram-live' });
      assert.equal(owned(comments).handle.storageEpoch, '1');
      assert.equal(owned(live).handle.storageEpoch, '1');
      assert.notEqual(owned(live).handle.instanceId, owned(comments).handle.instanceId);
      assert.notEqual(owned(live).handle.storeKey, owned(comments).handle.storeKey);
      assert.equal(owned(live).handle.storeKey, resolvePgStoreKey(fixture.name, 'engram-live'));
      const alone = await withCanonical(other.options);
      assert.equal(owned(alone).handle.storageEpoch, '1');
      assert.notEqual(owned(alone).handle.instanceId, owned(comments).handle.instanceId);
    } finally {
      await fixture.close();
      await other.close();
    }
  });

  it('reports instance-busy for concurrent opens, never a lock error', async () => {
    const fixture = await createPgFixture();
    try {
      const results = await Promise.allSettled([withCanonical(fixture.options), withCanonical(fixture.options)]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(reason instanceof CanonicalOwnershipError && reason.code === 'instance-busy', `concurrent loser: ${String(reason)}`);
    } finally {
      await fixture.close();
    }
  });

  it('refuses opt-in open when the ownership table is not installed', async () => {
    const legacy = (await loadPgAssets()).filter((asset) => asset.toVersion <= 7);
    assert.ok(legacy.length === 7);
    const fixture = await createPgFixture({ assets: legacy });
    try {
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
      );
    } finally {
      await fixture.close();
    }
  });

  it('refuses opt-in open on a 007-only store without touching Comments behavior', async () => {
    const legacy = (await loadPgAssets()).filter((asset) => asset.toVersion <= 7);
    const fixture = await createPgFixture({ assets: legacy });
    try {
      // No opt-in flag: a legacy store opens exactly as before.
      const kernel = await fixture.open();
      await commitAs(kernel, 'legacy-chain', 'hash-legacy');
      // Opt-in on the same legacy store is refused (installation incomplete).
      await assert.rejects(
        withCanonical(fixture.options),
        (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'open-refused',
      );
    } finally {
      await fixture.close();
    }
  });
});
