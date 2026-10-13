// Shared read corpus (L3a v4.1 frozen §8): immutable boundaries without
// clock-only expiry, stable exact heads, page bounds and explicit
// unavailability. Backend-agnostic: cursors are opaque values minted by the
// backend and never inspected or forged here; every refusal asserts a typed
// code or page outcome, never a reference message (§5.2).

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';

export type ReadCursor = unknown;

export interface ReadCorpusRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface ReadCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readPage(chainId: string, limit: number, cursor: ReadCursor, maxEncodedBytes: number): Awaitable<{ readonly outcome: 'page' | 'incomplete' | 'inaccessible'; readonly records: readonly ReadCorpusRecord[]; readonly nextCursor: ReadCursor }>;
  disposeChain(chainId: string): Awaitable<void>;
}

const hashes = (records: readonly ReadCorpusRecord[]): readonly string[] => records.map((entry) => entry.hash);

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
  assert.deepEqual(hashes(first.records), ['hash-e-1', 'hash-e-2']);

  const second = await bound.readPage('readable', 2, first.nextCursor, 4096);
  assert.equal(second.outcome, 'page');
  assert.deepEqual(hashes(second.records), ['hash-e-3', 'hash-e-4']);

  const stable = await bound.readPage('readable', 2, null, 4096);
  assert.deepEqual(
    hashes(stable.records),
    hashes(first.records),
    'K2a-RED reads: unrelated writes do not move an exact-head cursor',
  );

  const window = await bound.readPage('readable', 4, null, 4096);
  assert.deepEqual(hashes(window.records), ['hash-e-1', 'hash-e-2', 'hash-e-3', 'hash-e-4']);

  await bound.appendChain('readable', { id: 'e6', bytes: '{"n":6}', hash: 'hash-e-6' }, { kind: 'head', hash: 'hash-e-5' });
  const continued = await bound.readPage('readable', 10, second.nextCursor, 4096);
  assert.deepEqual(
    hashes(continued.records),
    ['hash-e-5'],
    'K2aC-RED reads: a retained head boundary never picks up later appends',
  );

  const tail = await bound.readPage('readable', 10, window.nextCursor, 4096);
  assert.deepEqual(
    hashes(tail.records),
    ['hash-e-5'],
    'K2aR3-RED reads: a retained window boundary still ends at its own head',
  );
  const exhausted = await bound.readPage('readable', 10, null, 1);
  assert.equal(exhausted.outcome, 'incomplete');

  await bound.appendChain('tiny', { id: 't1', bytes: 'x', hash: 'hash-t-1' }, { kind: 'absent', allocation: '0' });
  const encodedTiny = await bound.readPage('tiny', 10, null, 2);
  assert.equal(encodedTiny.outcome, 'incomplete');
  assert.equal(encodedTiny.records.length, 0);

  const envelope = await bound.readPage('tiny', 10, null, 49);
  assert.equal(
    envelope.outcome,
    'incomplete',
    'K2aR3-RED reads: the budget covers the full encoded page, not the record alone',
  );
  assert.equal(envelope.records.length, 0);

  await bound.appendChain('heavy', { id: 'big', bytes: `{"pad":"${'x'.repeat(200)}"}`, hash: 'hash-big-1' }, { kind: 'absent', allocation: '0' });
  const over = await bound.readPage('heavy', 10, null, 16);
  assert.equal(over.outcome, 'incomplete');
  assert.equal(over.records.length, 0);

  await expectCode(
    async () => bound.readPage('readable', 2, 'forged-cursor', 4096),
    'invalid-command',
    'K2aR3-RED reads: a forged cursor is explicitly rejected',
  );

  await bound.appendChain('doomed-read', { id: 'd1', bytes: '{}', hash: 'hash-d-1' }, { kind: 'absent', allocation: '0' });
  await bound.appendChain('doomed-read', { id: 'd2', bytes: '{}', hash: 'hash-d-2' }, { kind: 'head', hash: 'hash-d-1' });
  const acquired = await bound.readPage('doomed-read', 1, null, 4096);
  assert.equal(acquired.outcome, 'page');
  assert.equal(acquired.records.length, 1);
  assert.notEqual(
    acquired.nextCursor,
    null,
    'K2aR3-RED reads: the first page retains a boundary for recovery',
  );
  await bound.disposeChain('doomed-read');
  const unavailable = await bound.readPage('doomed-read', 1, acquired.nextCursor, 4096);
  assert.equal(unavailable.outcome, 'inaccessible');
  assert.equal(unavailable.records.length, 0);

  const fresh = await bound.readPage('doomed-read', 1, null, 4096);
  assert.equal(fresh.outcome, 'inaccessible');
  assert.equal(fresh.records.length, 0);

  const missing = await bound.readPage('no-such-chain', 10, null, 4096);
  assert.equal(missing.outcome, 'page');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.nextCursor, null);
};

// R3 remainder (§8.4, L3a v4.1 frozen): the returned cursor is part of the
// encoded page, so admission is measured with the effective returned cursor.
// Backend-agnostic: only backend-minted cursors are passed back; budgets are
// calibrated on the reference JSON envelope (same convention as the 49-byte
// envelope case above); the budget check measures the observed JSON encoding.
export const runReadCursorBudgetCorpus = async (bound: ReadCorpusStore): Promise<void> => {
  const chainId = 'r3-cursor-budget';
  for (let n = 0; n <= 10; n += 1) {
    await bound.appendChain(
      chainId,
      { id: `r${n}`, bytes: 'x', hash: `h${n}` },
      n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `h${n - 1}` },
    );
  }

  const first = await bound.readPage(chainId, 9, null, 4096);
  assert.equal(first.outcome, 'page');
  assert.equal(first.records.length, 9);
  assert.notEqual(first.nextCursor, null);

  const tight = await bound.readPage(chainId, 1, first.nextCursor, 115);
  assert.equal(
    tight.outcome,
    'incomplete',
    'K2b-RED reads: the 9 to 10 page measured with its returned cursor exceeds 115',
  );
  assert.equal(tight.records.length, 0);
  assert.notEqual(
    tight.nextCursor,
    null,
    'K2b-RED reads: the over-budget page still carries a recovery cursor',
  );

  const resumed = await bound.readPage(chainId, 1, first.nextCursor, 116);
  assert.equal(resumed.outcome, 'page');
  assert.equal(resumed.records.length, 1);
  assert.equal(resumed.records[0].id, 'r9');
  const encodedBytes = Buffer.byteLength(
    JSON.stringify({ outcome: resumed.outcome, records: resumed.records, nextCursor: resumed.nextCursor }),
    'utf8',
  );
  assert.ok(
    encodedBytes <= 116,
    `K2b-RED reads: the resumed page with its returned cursor fits the budget (got ${encodedBytes} bytes for 116)`,
  );

  const tail = await bound.readPage(chainId, 2, resumed.nextCursor, 4096);
  assert.equal(tail.outcome, 'page');
  assert.deepEqual(
    tail.records.map((entry) => entry.id),
    ['r10'],
  );
  assert.equal(tail.nextCursor, null);
};
