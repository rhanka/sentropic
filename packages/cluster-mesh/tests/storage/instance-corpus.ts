// Shared CanonicalInstanceOwnershipV1 semantic corpus: backend-agnostic
// cases run against the neutral registry, and for real against PostgreSQL
// (via a test adapter over opt-in kernels). Every backend asserts the same
// outcomes with the same CanonicalOwnershipError codes.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  CANONICAL_INSTANCE_OWNERSHIP_CONTRACT,
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  commitPossessionGuard,
  type CanonicalInstanceHandle,
  type CanonicalOwnershipCode,
} from '../../src/storage/instance-ownership.js';

export interface OwnershipCaseHandle {
  readonly instanceId: string;
  readonly storageEpoch: string;
  readonly storeKey: string;
}

export interface OwnershipCaseDriver {
  acquire(storeKey: string, epoch?: string): Promise<OwnershipCaseHandle>;
  verify(handle: OwnershipCaseHandle): Promise<void>;
  release(handle: OwnershipCaseHandle): Promise<void>;
  markTerminal(handle: OwnershipCaseHandle): Promise<void>;
  guard(handle: OwnershipCaseHandle): () => Promise<void> | void;
  current(storeKey: string): Promise<OwnershipCaseHandle | null>;
}

export interface OwnershipCaseSetup {
  driver: OwnershipCaseDriver;
  teardown: () => Promise<void>;
}

const rejectsCode = async (promise: Promise<unknown>, code: CanonicalOwnershipCode): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => error instanceof CanonicalOwnershipError && error.code === code);
};

export const defineOwnershipSemantics = (
  label: string,
  setup: () => Promise<OwnershipCaseSetup>,
): void => {
  describe(`canonical instance ownership: ${label}`, () => {
    let driver: OwnershipCaseDriver;
    let teardown = async (): Promise<void> => {};
    beforeEach(async () => {
      const setupResult = await setup();
      driver = setupResult.driver;
      teardown = setupResult.teardown;
    });
    afterEach(async () => {
      await teardown();
    });

    it('carries a versioned digest contract', () => {
      assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.name, 'CanonicalInstanceOwnershipV1');
      assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.version, '1');
      assert.match(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.digest, /^[0-9a-f]{64}$/);
    });

    it('refuses a second live holder and supersedes monotonically', async () => {
      const first = await driver.acquire('store-a');
      assert.equal(first.storageEpoch, '1');
      await rejectsCode(driver.acquire('store-a'), 'instance-busy');
      await driver.release(first);
      await rejectsCode(driver.acquire('store-a', '1'), 'stale-epoch');
      const second = await driver.acquire('store-a');
      assert.equal(second.storageEpoch, '2');
      await rejectsCode(driver.verify(first), 'stale-epoch');
      await driver.verify(second);
      await driver.guard(second)();
    });

    it('makes loss terminal and revokes the holder', async () => {
      const holder = await driver.acquire('store-b');
      await driver.markTerminal(holder);
      assert.equal(await driver.current('store-b'), null);
      await rejectsCode(driver.verify(holder), 'terminal-loss');
      await rejectsCode(driver.guard(holder)(), 'terminal-loss');
    });

    it('carries exact u64 epochs across 2^53 and 2^63 without Number conversion', async () => {
      const first = await driver.acquire('store-u64', '9007199254740991');
      assert.equal(first.storageEpoch, '9007199254740991');
      await driver.release(first);
      const second = await driver.acquire('store-u64', '9007199254740992');
      assert.equal(second.storageEpoch, '9007199254740992');
      assert.notEqual(first.storageEpoch, second.storageEpoch);
      await driver.release(second);
      const third = await driver.acquire('store-u64', '9223372036854775808');
      assert.equal(third.storageEpoch, '9223372036854775808');
      await driver.verify(third);
    });

    it('refuses zero, malformed, stale and exhausted u64 epochs with existing codes', async () => {
      for (const bad of ['0', '01', '', 'not-a-counter', '18446744073709551616', '-1']) {
        await rejectsCode(driver.acquire(`store-bad-${bad}`, bad), 'stale-epoch');
      }
      const holder = await driver.acquire('store-exhaust');
      assert.equal(holder.storageEpoch, '1');
      await driver.release(holder);
      await rejectsCode(driver.acquire('store-exhaust', '1'), 'stale-epoch');
      const top = await driver.acquire('store-top', '18446744073709551615');
      assert.equal(top.storageEpoch, '18446744073709551615');
      await driver.release(top);
      await rejectsCode(driver.acquire('store-top'), 'stale-epoch');
    });

    it('a stale release cannot clear its successor', async () => {
      const first = await driver.acquire('store-stale');
      assert.equal(first.storageEpoch, '1');
      await driver.release(first);
      const second = await driver.acquire('store-stale');
      assert.equal(second.storageEpoch, '2');
      // The stale handle no longer matches the durable row: releasing it
      // must leave the successor untouched on every backend.
      await driver.release(first);
      await driver.verify(second);
      await driver.guard(second)();
      const current = await driver.current('store-stale');
      assert.equal(current?.storageEpoch, '2');
      assert.equal(current?.instanceId, second.instanceId);
    });
  });
};

/** Neutral-registry driver: the contract reference implementation. */
export const registryDriver = (registry = new CanonicalInstanceRegistry()): OwnershipCaseDriver => ({
  acquire: async (storeKey, epoch) => registry.acquire(storeKey, epoch),
  verify: async (handle) => registry.verify(handle as CanonicalInstanceHandle),
  release: async (handle) => registry.release(handle as CanonicalInstanceHandle),
  markTerminal: async (handle) => registry.markTerminal(handle as CanonicalInstanceHandle),
  // Async so a synchronous registry refusal surfaces as a rejection that
  // `assert.rejects` can match, like the async PG commit guard.
  guard: (handle) => async () => {
    commitPossessionGuard(registry, handle as CanonicalInstanceHandle)();
  },
  current: async (storeKey) => registry.current(storeKey),
});
