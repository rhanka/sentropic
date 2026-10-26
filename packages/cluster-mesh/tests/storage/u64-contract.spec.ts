// E1 exact-u64 contract: new helpers plus frozen legacy counters.
// No PG migration, no common-contract widening, no Number conversion.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  compareU64Counter,
  isU64Counter,
  maxU64Counter,
  nextU64Counter,
  parseU64Counter,
} from '../../src/storage/u64.js';
import {
  compareConsumedCounter,
  isConsumedCounter,
  isConsumedVersion,
  isDecimalCounter,
  isStorageModuleId,
  nextConsumedCounter,
  parseConsumedCounter,
  parseConsumedVersion,
  parseDecimalCounter,
} from '../../src/storage/contracts.js';
import {
  compareU64Allocation,
  compareU64Version,
  isU64Version,
  nextU64Allocation,
  nextU64Version,
  validateU64AggregateUpdate,
  validateU64ChainExpectation,
  validateU64RegisteredGuard,
} from '../../src/storage/atomic.js';
import {
  compareBackendAllocationU64,
  incrementBackendAllocation,
  incrementBackendAllocationU64,
} from '../../src/storage/backend.js';
import { runU64CounterCorpus, U64_MAX } from './u64-corpus.js';
import { U64_ATOMIC_ALLOCATION_VECTORS, assertU64AllocationOpaque } from './atomic-corpus.js';
import { U64_CHAIN_ALLOCATION_VECTORS } from './chain-corpus.js';
import { U64_READ_BOUNDARY_VECTORS } from './read-corpus.js';

describe('storage exact u64 counters', () => {
  it('should accept exact boundaries without Number round-trips', () => {
    runU64CounterCorpus({
      isU64Counter,
      parseU64Counter,
      compareU64Counter,
      nextU64Counter,
      maxU64Counter,
    });
    assert.equal(parseU64Counter('9007199254740992'), 9007199254740992n);
    assert.equal(parseU64Counter(U64_MAX), 18446744073709551615n);
    assert.equal(maxU64Counter(), U64_MAX);
  });

  it('should order and exhaust exactly across 2^53 and 2^63', () => {
    assert.equal(compareU64Counter('9007199254740991', '9007199254740992'), -1);
    assert.equal(compareU64Counter('9223372036854775807', '9223372036854775808'), -1);
    assert.equal(nextU64Counter('9007199254740991'), '9007199254740992');
    assert.equal(nextU64Counter('18446744073709551614'), U64_MAX);
    assert.equal(nextU64Counter(U64_MAX), undefined);
  });

  it('should freeze legacy decimal counters to the safe-integer domain', () => {
    assert.equal(isDecimalCounter('9007199254740991'), true);
    assert.equal(isDecimalCounter('9007199254740992'), false);
    assert.equal(parseDecimalCounter('9007199254740991'), 9007199254740991);
    assert.equal(parseDecimalCounter('9007199254740992'), null);
  });

  it('should keep generic memory registration while exposing opt-in consumed paths', () => {
    assert.equal(isStorageModuleId('engram-memory'), true);
    assert.equal(isConsumedCounter('9007199254740992'), true);
    assert.equal(parseConsumedCounter('9007199254740992'), 9007199254740992n);
    assert.equal(compareConsumedCounter('9007199254740991', '9007199254740992'), -1);
    assert.equal(nextConsumedCounter('9007199254740991'), '9007199254740992');
  });

  it('should validate atomic u64 comparison and allocation paths', () => {
    assert.deepEqual(validateU64ChainExpectation({ kind: 'absent', allocation: '9007199254740992' }), { ok: true, errors: [] });
    assert.equal(validateU64ChainExpectation({ kind: 'absent', allocation: '01' }).ok, false);
    assert.equal(compareU64Allocation('9007199254740991', '9007199254740992'), -1);
    assert.equal(nextU64Allocation(U64_MAX), undefined);
  });

  it('should keep the safe backend allocation while adding exact u64 allocation', () => {
    assert.equal(incrementBackendAllocation('41'), '42');
    assert.throws(() => incrementBackendAllocation('9007199254740992'), /invalid allocation/);
    assert.equal(incrementBackendAllocationU64('9007199254740991'), '9007199254740992');
    assert.equal(incrementBackendAllocationU64(U64_MAX), undefined);
    assert.equal(compareBackendAllocationU64('9223372036854775807', '9223372036854775808'), -1);
  });

  it('should drive the atomic chain and read corpus u64 vectors', () => {
    for (const allocation of U64_ATOMIC_ALLOCATION_VECTORS) {
      assertU64AllocationOpaque(allocation);
      assert.deepEqual(validateU64ChainExpectation({ kind: 'absent', allocation }), { ok: true, errors: [] });
    }
    for (const allocation of U64_CHAIN_ALLOCATION_VECTORS) {
      assert.deepEqual(validateU64ChainExpectation({ kind: 'absent', allocation }), { ok: true, errors: [] });
      assert.equal(compareU64Allocation(allocation, U64_MAX) <= 0, true);
    }
    for (const boundary of U64_READ_BOUNDARY_VECTORS) {
      assert.equal(isU64Counter(boundary), true);
      assert.equal(parseU64Counter(boundary), BigInt(boundary));
    }
    assert.equal(compareU64Allocation('9007199254740991', '9007199254740992'), -1);
    assert.equal(nextU64Allocation('18446744073709551614'), U64_MAX);
    assert.equal(nextU64Allocation(U64_MAX), undefined);
  });

  it('should validate u64 aggregate versions guards and consumed versions', () => {
    const value = { format: 'utf8', data: 'v1' } as const;
    assert.deepEqual(validateU64AggregateUpdate({ key: 'agg-1', version: '9007199254740992', value }), { ok: true, errors: [] });
    assert.equal(validateU64AggregateUpdate({ key: 'agg-1', version: '01', value }).ok, false);
    assert.equal(validateU64AggregateUpdate({ key: '', version: '1', value }).ok, false);
    assert.equal(validateU64AggregateUpdate({ key: 'agg-1', version: '1', value: { format: 'utf8' } }).ok, false);
    assert.deepEqual(validateU64RegisteredGuard({ kind: 'aggregate-version', key: 'agg-1', version: '18446744073709551615' }), { ok: true, errors: [] });
    assert.equal(validateU64RegisteredGuard({ kind: 'aggregate-version', key: 'agg-1', version: 'bad' }).ok, false);
    assert.deepEqual(validateU64RegisteredGuard({ kind: 'head', chainId: 'c', hash: 'h' }), { ok: true, errors: [] });
    assert.equal(validateU64RegisteredGuard({ kind: 'nope' }).ok, false);
    assert.equal(isU64Version('9007199254740992'), true);
    assert.equal(isU64Version('01'), false);
    assert.equal(compareU64Version('9223372036854775807', '9223372036854775808'), -1);
    assert.equal(nextU64Version('18446744073709551614'), U64_MAX);
    assert.equal(nextU64Version(U64_MAX), undefined);
    assert.equal(isConsumedVersion('9007199254740992'), true);
    assert.equal(parseConsumedVersion('9007199254740992'), 9007199254740992n);
    assert.equal(parseConsumedVersion('18446744073709551616'), null);
  });
});
