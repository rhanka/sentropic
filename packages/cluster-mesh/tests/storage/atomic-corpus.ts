// Shared atomic corpus for every backend (L3a v4 §5, §16.1).
// Runs against the test-only reference here; real SQLite/Postgres later.

import assert from 'node:assert/strict';
import type { TestBoundStore } from './reference-store.js';

const record = (id: string, n: number) => ({ id, bytes: `{"n":${n}}`, hash: `hash-${id}-${n}` });

export const runAtomicCorpus = async (bound: TestBoundStore): Promise<void> => {
  const first = bound.appendChain('chain-a', record('a', 1), { kind: 'absent', allocation: '0' });
  assert.equal(first.seq, 0);
  assert.equal(first.replayed, false);

  const second = bound.appendChain('chain-a', record('a', 2), { kind: 'head', hash: 'hash-a-1' });
  assert.equal(second.seq, 1);

  await assert.rejects(
    async () => bound.appendChain('chain-a', record('a', 2), { kind: 'head', hash: 'hash-a-1' }),
    /stale head/,
    'K2a-RED atomic: repeated bytes under a stale head still conflict (CAS first)',
  );

  const replayed = bound.genesis('submission', 'sub-1', 'digest-1', { v: 1 });
  assert.equal(replayed.replayed, false);
  const replay = bound.genesis('submission', 'sub-1', 'digest-1', { v: 1 });
  assert.equal(replay.replayed, true);
  await assert.rejects(
    async () => bound.genesis('submission', 'sub-1', 'digest-2', { v: 2 }),
    /conflict/,
    'K2a-RED atomic: same genesis id with a different hash conflicts',
  );

  assert.equal(
    bound.indexPut('cmd-1', { digest: 'd1', resultIds: ['r1'], resultHash: null }),
    'insert',
  );
  assert.equal(
    bound.indexPut('cmd-1', { digest: 'd1', resultIds: ['r2'], resultHash: null }),
    'replace',
  );
  await assert.rejects(
    async () => bound.indexPut('cmd-1', { digest: 'd2', resultIds: ['r3'], resultHash: null }),
    /conflict/,
    'K2a-RED atomic: different digest under the same command key conflicts',
  );

  const receipt = bound.commitAtomic(
    {
      guards: [{ kind: 'head', chainId: 'chain-a', hash: 'hash-a-2' }],
      records: [],
      appends: [
        {
          chainId: 'chain-a',
          record: record('a', 3),
          expectation: { kind: 'head', hash: 'hash-a-2' },
        },
        {
          chainId: 'chain-b',
          record: record('b', 1),
          expectation: { kind: 'absent', allocation: '0' },
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    },
    { idempotencyKey: 'unit-1' },
  );
  assert.equal(receipt.effectiveAppends, 2);

  const sameReceipt = bound.commitAtomic(
    {
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'chain-a',
          record: record('a', 99),
          expectation: { kind: 'head', hash: 'hash-a-3' },
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    },
    { idempotencyKey: 'unit-1' },
  );
  assert.equal(sameReceipt.commitId, receipt.commitId);
  assert.equal(bound.readHead('chain-a'), 'hash-a-3');

  const before = bound.readChain('chain-a').length;
  await assert.rejects(
    async () =>
      bound.commitAtomic({
        guards: [{ kind: 'head', chainId: 'chain-a', hash: 'wrong-head' }],
        records: [],
        appends: [
          {
            chainId: 'chain-a',
            record: record('a', 4),
            expectation: { kind: 'head', hash: 'hash-a-3' },
          },
        ],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      }),
    /guard/,
    'K2a-RED atomic: a failing guard rolls back the whole unit',
  );
  assert.equal(bound.readChain('chain-a').length, before);

  await assert.rejects(
    async () =>
      bound.commitAtomic({
        guards: [],
        records: [],
        appends: [],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      }),
    /empty/,
    'K2a-RED atomic: an empty unit is rejected',
  );
};
