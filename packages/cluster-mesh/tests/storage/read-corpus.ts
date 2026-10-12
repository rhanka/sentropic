// Shared read corpus (L3a v4 §8): immutable boundaries without clock-only
// expiry, stable exact heads, page bounds and explicit unavailability.
// Backend-agnostic: structural port-shaped operations, all awaited (§5.2).

import assert from 'node:assert/strict';
import type { Awaitable } from './atomic-corpus.js';
import type { ChainPageCursor } from './reference-store.js';

export interface ReadCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readPage(chainId: string, limit: number, cursor: ChainPageCursor | null, maxEncodedBytes: number): Awaitable<{ readonly outcome: 'page' | 'incomplete'; readonly records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]; readonly nextCursor: ChainPageCursor | null }>;
  disposeChain(chainId: string): Awaitable<void>;
}

export const runReadCorpus = async (bound: ReadCorpusStore): Promise<void> => {
  for (let n = 1; n <= 5; n += 1) {
    await bound.appendChain(
      'readable',
      { id: `e${n}`, bytes: `{"n":${n}}`, hash: `hash-e-${n}` },
      n === 1 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hash-e-${n - 1}` },
    );
  }
  await bound.appendChain('unrelated', { id: 'u1', bytes: '{}', hash: 'hash-u-1' }, { kind: 'absent', allocation: '0' });

  const first = await bound.readPage('readable', 2, null, 4096);
  assert.equal(first.outcome, 'page');
  assert.equal(first.records.length, 2);
  assert.deepEqual(first.nextCursor, { position: 2, head: 'hash-e-5' });

  const second = await bound.readPage('readable', 2, first.nextCursor, 4096);
  assert.equal(second.records.length, 2);

  const stable = await bound.readPage('readable', 2, null, 4096);
  assert.deepEqual(
    stable.records.map((entry) => entry.hash),
    first.records.map((entry) => entry.hash),
    'K2a-RED reads: unrelated writes do not move an exact-head cursor',
  );

  await bound.appendChain('readable', { id: 'e6', bytes: '{"n":6}', hash: 'hash-e-6' }, { kind: 'head', hash: 'hash-e-5' });
  const continued = await bound.readPage('readable', 10, second.nextCursor, 4096);
  assert.deepEqual(
    continued.records.map((entry) => entry.hash),
    ['hash-e-5'],
    'K2aC-RED reads: a retained head boundary never picks up later appends',
  );

  const tail = await bound.readPage('readable', 10, { position: 4, head: 'hash-e-5' }, 4096);
  assert.equal(tail.records.length, 1);
  const exhausted = await bound.readPage('readable', 10, null, 1);
  assert.equal(exhausted.outcome, 'incomplete');

  await bound.appendChain('tiny', { id: 't1', bytes: 'x', hash: 'hash-t-1' }, { kind: 'absent', allocation: '0' });
  const encodedTiny = await bound.readPage('tiny', 10, null, 2);
  assert.equal(encodedTiny.outcome, 'incomplete');
  assert.equal(encodedTiny.records.length, 0);
  assert.notEqual(encodedTiny.nextCursor, null);

  await bound.appendChain('heavy', { id: 'big', bytes: `{"pad":"${'x'.repeat(200)}"}`, hash: 'hash-big-1' }, { kind: 'absent', allocation: '0' });
  const over = await bound.readPage('heavy', 10, null, 16);
  assert.equal(over.outcome, 'incomplete');
  assert.equal(over.records.length, 0);
  assert.notEqual(over.nextCursor, null);

  await bound.appendChain('doomed-read', { id: 'd1', bytes: '{}', hash: 'hash-d-1' }, { kind: 'absent', allocation: '0' });
  const acquired = await bound.readPage('doomed-read', 1, null, 4096);
  await bound.disposeChain('doomed-read');
  const unavailable = await bound.readPage('doomed-read', 1, acquired.nextCursor, 4096);
  assert.equal(unavailable.outcome, 'incomplete');
  assert.equal(unavailable.records.length, 0);

  const missing = await bound.readPage('no-such-chain', 10, null, 4096);
  assert.equal(missing.outcome, 'page');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.nextCursor, null);
};
