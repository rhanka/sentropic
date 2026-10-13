// Shared atomic corpus for every backend (L3a v4.1 frozen §5, §16.1).
// Runs against the test-only reference here; real SQLite/Postgres later.
// Backend-agnostic: structural port-shaped operations, all awaited (§5.2).

import assert from 'node:assert/strict';
import { isStorageError } from '../../src/storage/errors.js';
import type { AtomicUnit, CommitOptions, CommitReceipt } from '../../src/storage/atomic.js';

export type Awaitable<T> = T | Promise<T>;

export const expectCode = async (operation: () => unknown, code: string, message: string): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const actual = isStorageError(error) ? error.code : error instanceof Error ? error.message : String(error);
    assert.equal(actual, code, message);
    return;
  }
  assert.fail(`${message}: expected rejection with ${code}, but the operation succeeded`);
};

export interface AtomicCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  genesis(kind: string, id: string, hash: string, value: unknown): Awaitable<{ readonly hash: string; readonly replayed: boolean }>;
  indexGet(key: string): Awaitable<{ readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null>;
  indexPut(key: string, entry: { readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null }): Awaitable<'insert' | 'replace'>;
  readHead(chainId: string): Awaitable<string | null>;
  readChain(chainId: string): Awaitable<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]>;
  readRecord(key: string): Awaitable<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  readAggregate(key: string): Awaitable<{ readonly version: number; readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string } } | null>;
  commitAtomic(unit: AtomicUnit, options?: CommitOptions): Awaitable<CommitReceipt>;
}

// Announced backend profiles (L3a v4.1 frozen §3.2, §16.1): rejections below
// apply only when the profile is absent. Positive predicate cases are owned
// by K3, positive relationship cases by K4, barrier and purge positives by
// K2b/S3/P2c. Defaults preserve the K2a reference limits.
export interface AtomicCorpusProfiles {
  readonly visibilityBarriers?: boolean;
  readonly purgeJobs?: boolean;
  readonly predicates?: boolean;
  readonly relationships?: boolean;
}

const record = (id: string, n: number) => ({ id, bytes: `{"n":${n}}`, hash: `hash-${id}-${n}` });

export const runAtomicCorpus = async (bound: AtomicCorpusStore, profiles: AtomicCorpusProfiles = {}): Promise<void> => {
  const first = await bound.appendChain('chain-a', record('a', 1), { kind: 'absent', allocation: '0' });
  assert.equal(first.seq, 0);
  assert.equal(first.replayed, false);

  const second = await bound.appendChain('chain-a', record('a', 2), { kind: 'head', hash: 'hash-a-1' });
  assert.equal(second.seq, 1);

  await expectCode(
    async () => bound.appendChain('chain-a', record('a', 2), { kind: 'head', hash: 'hash-a-1' }),
    'cas-conflict',
    'K2a-RED atomic: repeated bytes under a stale head still conflict (CAS first)',
  );

  const replayed = await bound.genesis('submission', 'sub-1', 'digest-1', { v: 1 });
  assert.equal(replayed.replayed, false);
  const replay = await bound.genesis('submission', 'sub-1', 'digest-1', { v: 1 });
  assert.equal(replay.replayed, true);
  await expectCode(
    async () => bound.genesis('submission', 'sub-1', 'digest-2', { v: 2 }),
    'idempotency-conflict',
    'K2a-RED atomic: same genesis id with a different hash conflicts',
  );

  assert.equal(
    await bound.indexPut('cmd-1', { digest: 'd1', resultIds: ['r1'], resultHash: null }),
    'insert',
  );
  assert.equal(
    await bound.indexPut('cmd-1', { digest: 'd1', resultIds: ['r2'], resultHash: null }),
    'replace',
  );
  await expectCode(
    async () => bound.indexPut('cmd-1', { digest: 'd2', resultIds: ['r3'], resultHash: null }),
    'idempotency-conflict',
    'K2a-RED atomic: different digest under the same command key conflicts',
  );

  const receipt = await bound.commitAtomic(
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

  const sameReceipt = await bound.commitAtomic(
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
  assert.equal(sameReceipt.commitId, receipt.commitId);
  assert.equal(await bound.readHead('chain-a'), 'hash-a-3');

  await expectCode(
    async () =>
      bound.commitAtomic(
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
      ),
    'idempotency-conflict',
    'K2aR3-RED atomic: the same idempotency key with a divergent unit conflicts',
  );
  assert.equal(await bound.readHead('chain-a'), 'hash-a-3');

  const before = (await bound.readChain('chain-a')).length;
  await expectCode(
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
    'cas-conflict',
    'K2a-RED atomic: a failing guard rolls back the whole unit',
  );
  assert.equal(
    (await bound.readChain('chain-a')).length,
    before,
    'K2aR3-RED atomic: a failing guard rolls back the whole unit',
  );

  await bound.indexPut('atomic-idx-1', { digest: 'd1', resultIds: ['r1'], resultHash: null });
  const headBeforeLate = await bound.readHead('chain-a');
  const lenBeforeLate = (await bound.readChain('chain-a')).length;
  await expectCode(
    async () =>
      bound.commitAtomic({
        guards: [],
        records: [{ key: 'rec-1', bytes: { format: 'utf8', data: 'hello' }, contentHash: 'h-rec-1' }],
        appends: [
          {
            chainId: 'chain-a',
            record: record('a', 4),
            expectation: { kind: 'head', hash: 'hash-a-3' },
          },
        ],
        updates: [{ key: 'agg-1', version: 1, value: { format: 'utf8', data: 'v1' } }],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [{ key: 'atomic-idx-1', digest: 'd2', resultIds: ['r2'], resultHash: null }],
      }),
    'idempotency-conflict',
    'K2aC-RED atomic: a late index conflict rolls back appends, records and updates',
  );
  assert.equal(await bound.readHead('chain-a'), headBeforeLate);
  assert.equal((await bound.readChain('chain-a')).length, lenBeforeLate);
  assert.equal((await bound.indexGet('atomic-idx-1'))?.digest, 'd1');
  assert.equal(await bound.readRecord('rec-1'), null);
  assert.equal(await bound.readAggregate('agg-1'), null);

  const fullReceipt = await bound.commitAtomic({
    guards: [],
    records: [{ key: 'rec-1', bytes: { format: 'utf8', data: 'hello' }, contentHash: 'h-rec-1' }],
    appends: [
      {
        chainId: 'chain-a',
        record: record('a', 4),
        expectation: { kind: 'head', hash: 'hash-a-3' },
      },
    ],
    updates: [{ key: 'agg-1', version: 1, value: { format: 'utf8', data: 'v1' } }],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [{ key: 'atomic-idx-1', digest: 'd1', resultIds: ['r2'], resultHash: null }],
  });
  assert.equal(fullReceipt.effectiveAppends, 1);
  assert.equal(await bound.readHead('chain-a'), 'hash-a-4');
  assert.deepEqual(
    await bound.readRecord('rec-1'),
    { bytes: { format: 'utf8', data: 'hello' }, contentHash: 'h-rec-1' },
    'K2aR3-RED atomic: persisted record values survive the commit',
  );
  assert.deepEqual(
    await bound.readAggregate('agg-1'),
    { version: 1, value: { format: 'utf8', data: 'v1' } },
    'K2aR3-RED atomic: persisted aggregate values survive the commit',
  );
  assert.deepEqual((await bound.indexGet('atomic-idx-1'))?.resultIds, ['r2']);

  const guardedReceipt = await bound.commitAtomic({
    guards: [{ kind: 'aggregate-version', key: 'agg-1', version: 1 }],
    records: [],
    appends: [
      {
        chainId: 'chain-a',
        record: record('a', 5),
        expectation: { kind: 'head', hash: 'hash-a-4' },
      },
    ],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  });
  assert.equal(guardedReceipt.effectiveAppends, 1);
  assert.equal(await bound.readHead('chain-a'), 'hash-a-5');

  await expectCode(
    async () =>
      bound.commitAtomic({
        guards: [{ kind: 'aggregate-version', key: 'agg-1', version: 999 }],
        records: [],
        appends: [
          {
            chainId: 'chain-a',
            record: record('a', 6),
            expectation: { kind: 'head', hash: 'hash-a-5' },
          },
        ],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      }),
    'cas-conflict',
    'K2aR3-RED atomic: a false aggregate-version guard rolls back the whole unit',
  );
  assert.equal(await bound.readHead('chain-a'), 'hash-a-5');
  assert.deepEqual(
    await bound.readAggregate('agg-1'),
    { version: 1, value: { format: 'utf8', data: 'v1' } },
    'K2aR3-RED atomic: a failed version guard leaves no effects behind',
  );

  if (!profiles.predicates) {
    await expectCode(
      async () =>
        bound.commitAtomic({
          guards: [{ kind: 'predicate', predicateId: 'pred-1', dependency: 'dep-1' }],
          records: [],
          appends: [
            {
              chainId: 'chain-a',
              record: record('a', 6),
              expectation: { kind: 'head', hash: 'hash-a-5' },
            },
          ],
          updates: [],
          relationships: [],
          barriers: [],
          purgeIntents: [],
          indexWrites: [],
        }),
      'invalid-command',
      'K2aR3-RED atomic: a predicate guard is explicitly rejected by the K2a reference',
    );
  }

  await expectCode(
    async () =>
      bound.commitAtomic({
        guards: [],
        records: [],
        appends: [],
        updates: [{ key: 'agg-1', version: 1, value: { format: 'utf8', data: 'v2' } }],
        relationships: [],
        barriers: [],
        purgeIntents: [],
        indexWrites: [],
      }),
    'cas-conflict',
    'K2aR3-RED atomic: a stale aggregate update rolls back the whole unit',
  );
  assert.deepEqual(
    await bound.readAggregate('agg-1'),
    { version: 1, value: { format: 'utf8', data: 'v1' } },
    'K2aR3-RED atomic: a failed stale update leaves no effects behind',
  );

  assert.equal(await bound.readHead('chain-a'), 'hash-a-5');

  if (profiles.relationships) {
    const related = await bound.commitAtomic({
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'rel-chain',
          record: record('rel', 1),
          expectation: { kind: 'absent', allocation: '0' },
        },
      ],
      updates: [],
      relationships: [{ kind: 'add', relation: 'rel-1', from: 'a', to: 'b' }],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    });
    assert.equal(related.effectiveAppends, 1);
    assert.equal(await bound.readHead('rel-chain'), 'hash-rel-1');
  } else {
    await expectCode(
      async () =>
        bound.commitAtomic({
          guards: [],
          records: [],
          appends: [
            {
              chainId: 'rel-chain',
              record: record('rel', 1),
              expectation: { kind: 'absent', allocation: '0' },
            },
          ],
          updates: [],
          relationships: [{ kind: 'add', relation: 'rel-1', from: 'a', to: 'b' }],
          barriers: [],
          purgeIntents: [],
          indexWrites: [],
        }),
      'invalid-command',
      'K2aR3-RED atomic: relationships are explicitly rejected by the K2a reference',
    );
    assert.equal(
      await bound.readHead('rel-chain'),
      null,
      'K2aR3-RED atomic: a rejected relationships unit leaves no carrier effects behind',
    );
  }

  await expectCode(
    async () =>
      bound.commitAtomic({
        guards: [],
        records: [],
        appends: [
          {
            chainId: 'barrier-chain',
            record: record('bar', 1),
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
        updates: [],
        relationships: [],
        barriers: [{ boundary: 'b1', reason: 'r1' }],
        purgeIntents: [],
        indexWrites: [],
      }),
    'unsupported-profile',
    'K2aR3-RED atomic: barriers are explicitly rejected by the K2a reference',
  );
  assert.equal(
    await bound.readHead('barrier-chain'),
    null,
    'K2aR3-RED atomic: a rejected barriers unit leaves no carrier effects behind',
  );

  await expectCode(
    async () =>
      bound.commitAtomic({
        guards: [],
        records: [],
        appends: [
          {
            chainId: 'purge-chain',
            record: record('p', 1),
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
        updates: [],
        relationships: [],
        barriers: [],
        purgeIntents: [{ target: 't1', intentId: 'i1', authorizedBy: 'auth-1' }],
        indexWrites: [],
      }),
    'unsupported-profile',
    'K2aR3-RED atomic: purge intents are explicitly rejected by the K2a reference',
  );
  assert.equal(
    await bound.readHead('purge-chain'),
    null,
    'K2aR3-RED atomic: a rejected purge unit leaves no carrier effects behind',
  );

  await expectCode(
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
    'invalid-command',
    'K2a-RED atomic: an empty unit is rejected',
  );
};
