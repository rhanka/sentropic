// Shared barrier corpus (L3a v4.1 frozen §10.2, §15, §16.1, §16.2): one parent
// barrier over more descendants than atomic limits, concurrent child
// insertion, and G1 denial — covered full getters throw denied and pages
// return inaccessible, before and after physical disposal. Absence stays
// distinct; a raw tombstone without a barrier changes nothing.
// Backend-agnostic: typed codes and page outcomes only, never messages.

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { WorkLimits, WriterFence } from '../../src/storage/contracts.js';
import type { StagedCorpusHandle, StagedCorpusSeal } from './staged-corpus.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';

export interface BarrierCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  readChain(chainId: string): Awaitable<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]>;
  readRecord(key: string): Awaitable<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Awaitable<{ readonly outcome: 'page' | 'incomplete' | 'inaccessible'; readonly records: readonly { readonly id: string }[]; readonly nextCursor: unknown }>;
  commitAtomic(unit: AtomicUnit, options?: { readonly limits?: WorkLimits }): Awaitable<{ readonly commitId: string }>;
  disposeChain(chainId: string): Awaitable<void>;
  declareCoverage(parent: string, child: string): Awaitable<void>;
  beginStaged(input: { readonly operationKey: string; readonly inputDigest: string; readonly contractDigest: string; readonly sourceBoundary: string; readonly fence: WriterFence }): Awaitable<StagedCorpusHandle>;
  stageFragment(input: { readonly unit: StagedCorpusHandle; readonly ordinal: string; readonly predecessorHash: string | null; readonly fragmentDigest: string; readonly effects: AtomicUnit; readonly fence: WriterFence; readonly limits?: WorkLimits }): Awaitable<{ readonly unitId: string; readonly ordinal: string; readonly fragmentDigest: string }>;
  sealStaged(input: { readonly unit: StagedCorpusHandle; readonly root: StagedCommitRoot }): Awaitable<StagedCorpusSeal>;
  commitStaged(input: { readonly seal: StagedCorpusSeal; readonly fence: WriterFence }): Awaitable<{ readonly commitId: string }>;
}

const FENCE: WriterFence = { fenceId: 'fence-k2b', epoch: '1' };
const LIMITS: WorkLimits = { maxRecords: 128, maxAppends: 2, maxEncodedBytes: 524288 };

const emptyUnit = (): AtomicUnit => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const commentAppend = (n: number) => ({
  chainId: `comment-${n}`,
  record: { id: `c${n}`, bytes: `{"comment":${n}}`, hash: `hash-comment-${n}` },
  expectation: { kind: 'absent', allocation: '0' } as const,
});

const expectDenied = async (operation: () => unknown, message: string): Promise<void> => {
  await expectCode(operation, 'denied', message);
};

export const runBarrierCorpus = async (bound: BarrierCorpusStore): Promise<void> => {
  const overLimit: AtomicUnit = {
    ...emptyUnit(),
    appends: [commentAppend(100), commentAppend(101), commentAppend(102)],
  };
  await expectCode(
    async () => bound.commitAtomic(overLimit, { limits: LIMITS }),
    'invalid-command',
    'K2b-RED barriers: one atomic unit cannot cover more than atomic limits',
  );

  const publishing = await bound.beginStaged({
    operationKey: 'op-barrier-thread',
    inputDigest: 'input-thread',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const fragments = [
    { ordinal: '0', digest: 'digest-thread-0', appends: [commentAppend(0), commentAppend(1)] },
    { ordinal: '1', digest: 'digest-thread-1', appends: [commentAppend(2), commentAppend(3)] },
    { ordinal: '2', digest: 'digest-thread-2', appends: [commentAppend(4), commentAppend(5)] },
    { ordinal: '3', digest: 'digest-thread-3', appends: [commentAppend(6), commentAppend(7)] },
    { ordinal: '4', digest: 'digest-thread-4', appends: [commentAppend(8), commentAppend(9)] },
    { ordinal: '5', digest: 'digest-thread-5', appends: [commentAppend(10), commentAppend(11)] },
  ];
  for (const fragment of fragments) {
    await bound.stageFragment({
      unit: publishing,
      ordinal: fragment.ordinal,
      predecessorHash: fragment.ordinal === '0' ? null : `digest-thread-${Number(fragment.ordinal) - 1}`,
      fragmentDigest: fragment.digest,
      effects: { ...emptyUnit(), appends: fragment.appends },
      fence: FENCE,
      limits: LIMITS,
    });
  }
  const threadSeal = await bound.sealStaged({
    unit: publishing,
    root: {
      operationId: 'op-barrier-thread',
      contractDigest: 'contract-k2b',
      sourceBoundary: 'boundary-k2b',
      finalFragmentHash: 'digest-thread-5',
      fragmentCount: '6',
      dependencyRoot: 'dep-root-k2b',
      effectRoot: 'eff-root-k2b',
    },
  });
  await bound.commitStaged({ seal: threadSeal, fence: FENCE });
  for (let n = 0; n < 12; n += 1) {
    await bound.declareCoverage('thread-1', `comment-${n}`);
  }
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [
      {
        chainId: 'thread-1',
        record: { id: 'thread', bytes: '{"thread":1}', hash: 'hash-thread-1' },
        expectation: { kind: 'absent', allocation: '0' },
      },
    ],
    records: [{ key: 'rec-covered', bytes: { format: 'utf8', data: 'covered' }, contentHash: 'h-covered' }],
  });
  await bound.declareCoverage('thread-1', 'rec-covered');

  await bound.appendChain('retained-chain', { id: 'rc1', bytes: '{"retained":1}', hash: 'hash-retained-1' }, { kind: 'absent', allocation: '0' });
  await bound.appendChain('retained-chain', { id: 'rc2', bytes: '{"retained":2}', hash: 'hash-retained-2' }, { kind: 'head', hash: 'hash-retained-1' });
  const retained = await bound.readPage('retained-chain', 1, null, 4096);
  assert.equal(retained.outcome, 'page');
  assert.equal(retained.records.length, 1);
  assert.notEqual(
    retained.nextCursor,
    null,
    'K2b-RED barriers: a two-record chain read with limit 1 mints a real retained cursor',
  );
  await bound.declareCoverage('thread-1', 'retained-chain');

  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [
      {
        chainId: 'lifecycle-1',
        record: { id: 'tombstone-1', bytes: '{"tombstone":"thread-1"}', hash: 'hash-tombstone-1' },
        expectation: { kind: 'absent', allocation: '0' },
      },
    ],
    barriers: [{ boundary: 'thread-1', reason: 'tombstone-thread-1' }],
  });
  for (let n = 0; n < 12; n += 1) {
    await expectDenied(
      async () => bound.readHead(`comment-${n}`),
      `K2b-RED barriers G1: covered comment ${n} head throws denied before purge`,
    );
    await expectDenied(
      async () => bound.readChain(`comment-${n}`),
      `K2b-RED barriers G1: covered comment ${n} chain throws denied before purge`,
    );
    const page = await bound.readPage(`comment-${n}`, 10, null, 4096);
    assert.equal(page.outcome, 'inaccessible');
    assert.equal(page.records.length, 0);
  }
  await expectDenied(
    async () => bound.readHead('thread-1'),
    'K2b-RED barriers G1: the barrier boundary itself throws denied',
  );
  await expectDenied(
    async () => bound.readRecord('rec-covered'),
    'K2b-RED barriers G1: a covered record throws denied',
  );
  const retainedPage = await bound.readPage('retained-chain', 1, retained.nextCursor, 4096);
  assert.equal(
    retainedPage.outcome,
    'inaccessible',
    'K2b-RED barriers: a retained root cannot bypass the current barrier',
  );
  assert.equal(retainedPage.records.length, 0);
  assert.equal(
    retainedPage.nextCursor,
    null,
    'K2b-RED barriers: an inaccessible page leaks no retained cursor',
  );
  const lifecycle = await bound.readChain('lifecycle-1');
  assert.equal(lifecycle.length, 1);

  assert.equal(await bound.readHead('never-existed'), null);
  const absent = await bound.readPage('never-existed', 10, null, 4096);
  assert.equal(absent.outcome, 'page');
  assert.equal(absent.records.length, 0);

  await bound.appendChain('thread-2', { id: 'thread', bytes: '{"thread":2}', hash: 'hash-thread-2' }, { kind: 'absent', allocation: '0' });
  await bound.appendChain('comment-orphan', { id: 'orphan', bytes: '{}', hash: 'hash-orphan' }, { kind: 'absent', allocation: '0' });
  await bound.declareCoverage('thread-2', 'comment-orphan');
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [
      {
        chainId: 'lifecycle-2',
        record: { id: 'tombstone-2', bytes: '{"tombstone":"raw"}', hash: 'hash-tombstone-2' },
        expectation: { kind: 'absent', allocation: '0' },
      },
    ],
  });
  assert.equal(
    await bound.readHead('comment-orphan'),
    'hash-orphan',
    'K2b-RED barriers: coverage without a barrier ancestor plus a raw tombstone leaves reads unaffected',
  );
  await bound.declareCoverage('thread-1', 'comment-orphan');
  await expectDenied(
    async () => bound.readHead('comment-orphan'),
    'K2b-RED barriers: coverage links the orphan chain to its barrier scope',
  );

  await bound.declareCoverage('thread-1', 'comment-12');
  await expectCode(
    async () =>
      bound.appendChain('comment-12', { id: 'c12', bytes: '{}', hash: 'hash-comment-12' }, { kind: 'absent', allocation: '0' }),
    'invalid-command',
    'K2b-RED barriers: a concurrent child cannot escape its barrier',
  );
  await expectCode(
    async () =>
      bound.commitAtomic({
        ...emptyUnit(),
        appends: [
          {
            chainId: 'comment-12',
            record: { id: 'c12', bytes: '{}', hash: 'hash-comment-12' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
      }),
    'invalid-command',
    'K2b-RED barriers: a committed child cannot escape its barrier',
  );

  await bound.disposeChain('comment-3');
  await expectDenied(
    async () => bound.readHead('comment-3'),
    'K2b-RED barriers G1: covered content stays denied after physical disposal',
  );
  const disposed = await bound.readPage('comment-3', 10, null, 4096);
  assert.equal(disposed.outcome, 'inaccessible');
  assert.equal(disposed.records.length, 0);
  assert.equal(disposed.nextCursor, null);

  await bound.appendChain('disposed-plain', { id: 'dp1', bytes: '{"plain":1}', hash: 'hash-disposed-plain-1' }, { kind: 'absent', allocation: '0' });
  await bound.disposeChain('disposed-plain');
  await expectDenied(
    async () => bound.readHead('disposed-plain'),
    'K2b-RED barriers G1: disposed content without coverage throws denied',
  );
  await expectDenied(
    async () => bound.readChain('disposed-plain'),
    'K2b-RED barriers G1: a disposed chain without coverage throws denied',
  );
  const disposedPlain = await bound.readPage('disposed-plain', 10, null, 4096);
  assert.equal(disposedPlain.outcome, 'inaccessible');
  assert.equal(disposedPlain.records.length, 0);
  assert.equal(disposedPlain.nextCursor, null);
};
