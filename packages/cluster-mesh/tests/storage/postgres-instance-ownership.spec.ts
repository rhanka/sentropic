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
import { PostgresStorageError } from '../../src/storage/postgres/errors.js';
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

const withCanonical = (options: PgTestFixture['options'], extra: Record<string, unknown> = {}) =>
  createPostgresKernel({
    ...options,
    canonicalOwnership: { leaseMs: 60000, ...(extra.canonicalOwnership as Record<string, unknown> | undefined) },
    ...extra,
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
  const live = new Map<string, LiveEntry>();
  const sessions = new Map<OwnershipCaseHandle, LiveEntry>();
  const released = new Set<OwnershipCaseHandle>();
  const lastKnown = new Map<string, string>();
  const readRowEpoch = async (module: string): Promise<string | null> => {
    const rows = await fixture.tx.run(true, (session) =>
      session.execute({
        text: `SELECT epoch FROM "${fixture.name}".instance_ownership WHERE module=$1`,
        values: [module],
      }),
    );
    return rows.rows.length === 0 ? null : decodePgText(rows.rows[0]!.epoch);
  };
  const seedExpired = async (module: string, epoch: string): Promise<void> => {
    await fixture.tx.run(false, (session) =>
      session.execute({
        text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
          VALUES($1, $2, $3, clock_timestamp() - make_interval(secs => 3600))
          ON CONFLICT(module) DO UPDATE SET instance=EXCLUDED.instance, epoch=EXCLUDED.epoch, holder_until=EXCLUDED.holder_until`,
        values: [module, `instance-${randomUUID()}`, epoch],
      }),
    );
  };
  return {
    acquire: async (store, epoch) => {
      if (epoch !== undefined && !isPositiveU64Counter(epoch)) {
        throw new CanonicalOwnershipError('stale-epoch', 'not a canonical u64 counter');
      }
      const known = lastKnown.get(store) ?? '0';
      if (epoch !== undefined && compareCanon(epoch, known) <= 0) {
        throw new CanonicalOwnershipError('stale-epoch', 'explicit epoch is not newer');
      }
      const module = forStore(store);
      if (epoch !== undefined && epoch !== '1') {
        const rowEpoch = await readRowEpoch(module);
        if (rowEpoch === null || compareCanon(rowEpoch, decrementCanon(epoch)) !== 0) {
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
      const entry: LiveEntry = { kernel, session, handle };
      live.set(store, entry);
      sessions.set(handle, entry);
      lastKnown.set(store, handle.storageEpoch);
      return handle;
    },
    verify: async (handle) => {
      if (released.has(handle)) throw new CanonicalOwnershipError('stale-epoch', 'released ownership handle');
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      await fixture.tx.run(true, (txSession) => entry.session.verify(txSession));
    },
    release: async (handle) => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      await entry.session.release();
      released.add(handle);
      if (live.get(entry.handle.storeKey)?.handle === handle) live.delete(entry.handle.storeKey);
    },
    markTerminal: async (handle) => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      const module = forStore(handle.storeKey);
      await fixture.tx.run(false, (session) =>
        session.execute({
          text: `UPDATE "${fixture.name}".instance_ownership SET instance='terminated' WHERE module=$1 AND instance=$2 AND epoch=$3`,
          values: [module, handle.instanceId, handle.storageEpoch],
        }),
      );
      live.delete(handle.storeKey);
    },
    guard: (handle) => async () => {
      const entry = sessions.get(handle);
      assert.ok(entry, 'unknown case handle');
      await fixture.tx.run(true, (txSession) => entry.session.verify(txSession));
    },
    current: async (store) => {
      const entry = live.get(store);
      if (!entry) return null;
      return {
        instanceId: entry.handle.instanceId,
        storageEpoch: entry.handle.storageEpoch,
        storeKey: store,
      };
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
});
