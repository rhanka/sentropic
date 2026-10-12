// Shared read corpus (L3a v4 §8): immutable boundaries without clock-only
// expiry, stable exact heads, page bounds and explicit unavailability.

import assert from 'node:assert/strict';
import type { TestBoundStore } from './reference-store.js';

export const runReadCorpus = async (bound: TestBoundStore): Promise<void> => {
  for (let n = 1; n <= 5; n += 1) {
    bound.appendChain(
      'readable',
      { id: `e${n}`, bytes: `{"n":${n}}`, hash: `hash-e-${n}` },
      n === 1 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hash-e-${n - 1}` },
    );
  }
  bound.appendChain('unrelated', { id: 'u1', bytes: '{}', hash: 'hash-u-1' }, { kind: 'absent', allocation: '0' });

  const first = bound.readPage('readable', 2, null, 1024);
  assert.equal(first.outcome, 'page');
  assert.equal(first.records.length, 2);
  assert.equal(first.nextCursor, 2);

  const second = bound.readPage('readable', 2, first.nextCursor, 1024);
  assert.equal(second.records.length, 2);

  const stable = bound.readPage('readable', 2, null, 1024);
  assert.deepEqual(
    stable.records.map((entry) => entry.hash),
    first.records.map((entry) => entry.hash),
    'K2a-RED reads: unrelated writes do not move an exact-head cursor',
  );

  const tail = bound.readPage('readable', 10, 4, 1024);
  assert.equal(tail.records.length, 1);
  const exhausted = bound.readPage('readable', 10, null, 1);
  assert.equal(exhausted.outcome, 'incomplete');

  bound.appendChain('heavy', { id: 'big', bytes: `{"pad":"${'x'.repeat(200)}"}`, hash: 'hash-big-1' }, { kind: 'absent', allocation: '0' });
  const over = bound.readPage('heavy', 10, null, 16);
  assert.equal(over.outcome, 'incomplete');
  assert.equal(over.records.length, 0);
  assert.notEqual(over.nextCursor, null);

  const missing = bound.readPage('no-such-chain', 10, null, 1024);
  assert.equal(missing.outcome, 'page');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.nextCursor, null);
};
