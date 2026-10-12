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

  const first = bound.readPage('readable', 2, null, 4096);
  assert.equal(first.outcome, 'page');
  assert.equal(first.records.length, 2);
  assert.deepEqual(first.nextCursor, { position: 2, head: 'hash-e-5' });

  const second = bound.readPage('readable', 2, first.nextCursor, 4096);
  assert.equal(second.records.length, 2);

  const stable = bound.readPage('readable', 2, null, 4096);
  assert.deepEqual(
    stable.records.map((entry) => entry.hash),
    first.records.map((entry) => entry.hash),
    'K2a-RED reads: unrelated writes do not move an exact-head cursor',
  );

  bound.appendChain('readable', { id: 'e6', bytes: '{"n":6}', hash: 'hash-e-6' }, { kind: 'head', hash: 'hash-e-5' });
  const continued = bound.readPage('readable', 10, second.nextCursor, 4096);
  assert.deepEqual(
    continued.records.map((entry) => entry.hash),
    ['hash-e-5'],
    'K2aC-RED reads: a retained head boundary never picks up later appends',
  );

  const tail = bound.readPage('readable', 10, { position: 4, head: 'hash-e-5' }, 4096);
  assert.equal(tail.records.length, 1);
  const exhausted = bound.readPage('readable', 10, null, 1);
  assert.equal(exhausted.outcome, 'incomplete');

  bound.appendChain('tiny', { id: 't1', bytes: 'x', hash: 'hash-t-1' }, { kind: 'absent', allocation: '0' });
  const encodedTiny = bound.readPage('tiny', 10, null, 2);
  assert.equal(encodedTiny.outcome, 'incomplete');
  assert.equal(encodedTiny.records.length, 0);
  assert.notEqual(encodedTiny.nextCursor, null);

  bound.appendChain('heavy', { id: 'big', bytes: `{"pad":"${'x'.repeat(200)}"}`, hash: 'hash-big-1' }, { kind: 'absent', allocation: '0' });
  const over = bound.readPage('heavy', 10, null, 16);
  assert.equal(over.outcome, 'incomplete');
  assert.equal(over.records.length, 0);
  assert.notEqual(over.nextCursor, null);

  bound.appendChain('doomed-read', { id: 'd1', bytes: '{}', hash: 'hash-d-1' }, { kind: 'absent', allocation: '0' });
  const acquired = bound.readPage('doomed-read', 1, null, 4096);
  bound.disposeChain('doomed-read');
  const unavailable = bound.readPage('doomed-read', 1, acquired.nextCursor, 4096);
  assert.equal(unavailable.outcome, 'incomplete');
  assert.equal(unavailable.records.length, 0);

  const missing = bound.readPage('no-such-chain', 10, null, 4096);
  assert.equal(missing.outcome, 'page');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.nextCursor, null);
};
