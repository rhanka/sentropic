// Shared CanonicalInstanceOwnershipV1 semantic corpus: backend-agnostic
// registry cases. The neutral registry, the SQLite backend and the PostgreSQL
// backend all assert these same outcomes; PG durability/guard cases live in
// postgres-instance-{ownership,guard}.spec.ts.
import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  CANONICAL_INSTANCE_OWNERSHIP_CONTRACT,
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  commitPossessionGuard,
} from '../../src/storage/instance-ownership.js';

export const defineRegistrySemantics = (create: () => CanonicalInstanceRegistry): void => {
  it('carries a versioned digest contract', () => {
    assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.name, 'CanonicalInstanceOwnershipV1');
    assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.version, '1');
    assert.match(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.digest, /^[0-9a-f]{64}$/);
  });

  it('refuses a second live holder and supersedes monotonically', () => {
    const registry = create();
    const first = registry.acquire('store-a');
    assert.equal(first.storageEpoch, '1');
    assert.throws(() => registry.acquire('store-a'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'instance-busy');
    registry.release(first);
    assert.throws(() => registry.acquire('store-a', '1'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    const second = registry.acquire('store-a');
    assert.equal(second.storageEpoch, '2');
    assert.throws(() => registry.verify(first), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    registry.verify(second);
    commitPossessionGuard(registry, second)();
  });

  it('makes loss terminal and revokes the holder', () => {
    const registry = create();
    const holder = registry.acquire('store-b');
    registry.markTerminal(holder);
    assert.equal(registry.current('store-b'), null);
    assert.throws(() => registry.verify(holder), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss');
    assert.throws(() => commitPossessionGuard(registry, holder)(), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss');
  });

  it('should carry exact u64 epochs across 2^53 and 2^63 without Number conversion', () => {
    const registry = create();
    const first = registry.acquire('store-u64', '9007199254740991');
    assert.equal(first.storageEpoch, '9007199254740991');
    registry.release(first);
    const second = registry.acquire('store-u64', '9007199254740992');
    assert.equal(second.storageEpoch, '9007199254740992');
    assert.notEqual(first.storageEpoch, second.storageEpoch);
    registry.release(second);
    const third = registry.acquire('store-u64', '9223372036854775808');
    assert.equal(third.storageEpoch, '9223372036854775808');
    registry.verify(third);
  });

  it('should refuse zero, malformed, stale and exhausted u64 epochs with existing codes', () => {
    const registry = create();
    for (const bad of ['0', '01', '', 'not-a-counter', '18446744073709551616', '-1']) {
      assert.throws(() => registry.acquire(`store-bad-${bad}`, bad), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    }
    const holder = registry.acquire('store-exhaust');
    assert.equal(holder.storageEpoch, '1');
    registry.release(holder);
    assert.throws(() => registry.acquire('store-exhaust', '1'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    const top = registry.acquire('store-top', '18446744073709551615');
    assert.equal(top.storageEpoch, '18446744073709551615');
    registry.release(top);
    assert.throws(() => registry.acquire('store-top'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
  });
};
