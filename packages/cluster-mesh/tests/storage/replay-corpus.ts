// Shared journal/replay corpus (L3a v4.1 frozen §13, §16.1): commit ordering,
// durable watermark, checkpoint CAS, poison recovery, snapshot-bound resync,
// plus external-log interleave, same-log rollback and staged-segment
// visibility. Backend-agnostic: event ids and cursors are backend-minted and
// only replayed, never inspected; every refusal asserts a typed code.

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { StagedCorpusHandle, StagedCorpusSeal } from './staged-corpus.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
import type { WriterFence } from '../../src/storage/contracts.js';

export interface ReplayCorpusEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly commitId: string;
  readonly operationKey?: string;
  readonly segment?: { readonly operationKey: string; readonly from: number; readonly to: number };
}

export interface ReplayCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  commitAtomic(unit: AtomicUnit, options?: { readonly idempotencyKey?: string }): Awaitable<{ readonly commitId: string }>;
  beginStaged(input: { readonly operationKey: string; readonly inputDigest: string; readonly contractDigest: string; readonly sourceBoundary: string; readonly fence: WriterFence }): Awaitable<StagedCorpusHandle>;
  stageFragment(input: { readonly unit: StagedCorpusHandle; readonly ordinal: string; readonly predecessorHash: string | null; readonly fragmentDigest: string; readonly effects: AtomicUnit; readonly fence: WriterFence }): Awaitable<{ readonly unitId: string; readonly ordinal: string; readonly fragmentDigest: string }>;
  sealStaged(input: { readonly unit: StagedCorpusHandle; readonly root: StagedCommitRoot }): Awaitable<StagedCorpusSeal>;
  commitStaged(input: { readonly seal: StagedCorpusSeal; readonly fence: WriterFence }): Awaitable<{ readonly commitId: string }>;
  armExternalFailure(): Awaitable<void>;
  abortStaged(input: { readonly unit: StagedCorpusHandle }): Awaitable<void>;
  journalRead(consumer: string, after: number, limit: number): Awaitable<{ readonly events: readonly ReplayCorpusEvent[]; readonly watermark: number }>;
  journalCheckpoint(consumer: string, expected: number, next: number): Awaitable<void>;
  journalInspect(consumer: string): Awaitable<{ readonly cursor: number; readonly status: 'running' | 'stalled'; readonly failedEvent: string | null; readonly lag: number }>;
  journalMarkPoison(consumer: string, eventId: string, reason: string): Awaitable<void>;
  journalRetry(consumer: string, expectedFailure: string): Awaitable<void>;
  journalResync(consumer: string): Awaitable<{ readonly snapshotRoot: string; readonly journalSeq: number }>;
  snapshotRead(snapshotRoot: string, after: number, limit: number): Awaitable<{ readonly events: readonly ReplayCorpusEvent[]; readonly watermark: number }>;
  externalRead(after: number, limit: number): Awaitable<{ readonly events: readonly ReplayCorpusEvent[]; readonly watermark: number }>;
}

export interface ReplayCorpusForeign {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  commitAtomic(unit: AtomicUnit): Awaitable<{ readonly commitId: string }>;
}

export interface ReplayCorpusHooks {
  rebind(): Awaitable<ReplayCorpusStore>;
}

const FENCE: WriterFence = { fenceId: 'fence-k2b', epoch: '1' };

const commitOne = (bound: ReplayCorpusStore | ReplayCorpusForeign, chainId: string, n: number) =>
  bound.commitAtomic({
    guards: [],
    records: [],
    appends: [
      {
        chainId,
        record: { id: `j${n}`, bytes: `{"n":${n}}`, hash: `hash-j-${n}` },
        expectation: { kind: 'absent', allocation: '0' } as const,
      },
    ],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  });

export const runReplayCorpus = async (
  bound: ReplayCorpusStore,
  foreign: ReplayCorpusForeign,
  hooks: ReplayCorpusHooks,
): Promise<void> => {
  await commitOne(bound, 'journal-a', 1);
  await commitOne(bound, 'journal-b', 2);
  await commitOne(bound, 'journal-c', 3);

  const first = await bound.journalRead('c1', 0, 2);
  assert.equal(first.events.length, 2);
  assert.deepEqual(
    first.events.map((event) => event.seq),
    [1, 2],
    'K2b-RED replay: commits allocate journal order durably',
  );
  assert.notEqual(first.events[0].eventId, first.events[1].eventId);
  assert.notEqual(first.events[0].commitId, first.events[1].commitId);

  const rest = await bound.journalRead('c1', 2, 10);
  assert.equal(rest.events.length, 1);
  assert.equal(rest.watermark, 3);

  await bound.journalCheckpoint('c1', 0, 2);
  assert.equal((await bound.journalInspect('c1')).cursor, 2);
  await expectCode(
    async () => bound.journalCheckpoint('c1', 0, 3),
    'cas-conflict',
    'K2b-RED replay: a stale checkpoint expectation conflicts',
  );
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 1),
    'invalid-command',
    'K2b-RED replay: checkpoints are monotonic',
  );
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 99),
    'invalid-command',
    'K2b-RED replay: checkpoints cannot skip ahead of the log',
  );

  const rebound = await hooks.rebind();
  const reread = await rebound.journalRead('c1', 0, 10);
  assert.equal(reread.events.length, 3);
  assert.equal(reread.watermark, 3);

  const poisoned = reread.events[2].eventId;
  await bound.journalMarkPoison('c1', poisoned, 'poison-k2b');
  const stalled = await bound.journalInspect('c1');
  assert.equal(stalled.status, 'stalled', 'K2b-RED replay: poison stalls the consumer');
  await commitOne(foreign, 'journal-foreign-during-poison', 9);
  assert.equal(
    await foreign.readHead('journal-foreign-during-poison'),
    'hash-j-9',
    'K2b-RED replay: other scopes continue while one consumer is stalled',
  );
  const siblingRead = await bound.journalRead('c2', 0, 10);
  assert.deepEqual(
    siblingRead.events.map((event) => event.seq),
    [1, 2, 3],
    'K2b-RED replay: a sibling consumer still receives delivery while one consumer is stalled',
  );
  await bound.journalCheckpoint('c2', 0, 2);
  assert.equal(
    (await bound.journalInspect('c2')).cursor,
    2,
    'K2b-RED replay: a sibling consumer still checkpoints while one consumer is stalled',
  );
  assert.equal(stalled.failedEvent, poisoned);
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 3),
    'invalid-command',
    'K2b-RED replay: a checkpoint cannot pass an undelivered poisoned event',
  );
  await bound.journalRetry('c1', poisoned);
  assert.equal((await bound.journalInspect('c1')).status, 'running');
  const redelivered = await bound.journalRead('c1', 2, 10);
  assert.equal(
    redelivered.events[0].eventId,
    poisoned,
    'K2b-RED replay: retry preserves the failed event identity and order',
  );
  await bound.journalCheckpoint('c1', 2, 3);

  await commitOne(bound, 'journal-d', 4);
  await commitOne(bound, 'journal-e', 5);
  assert.equal((await bound.journalInspect('c1')).cursor, 3);
  const boundary = await bound.journalResync('c1');
  assert.equal(boundary.journalSeq, 5);
  assert.equal(
    (await bound.journalInspect('c1')).cursor,
    3,
    'K2b-RED replay: resync captures the snapshot boundary without advancing the checkpoint',
  );
  const outstanding = await bound.journalRead('c1', 3, 10);
  assert.deepEqual(
    outstanding.events.map((event) => event.seq),
    [4, 5],
  );
  await bound.journalCheckpoint('c1', 3, boundary.journalSeq);
  assert.equal((await bound.journalInspect('c1')).lag, 0);

  await commitOne(bound, 'journal-f', 6);
  await commitOne(bound, 'journal-g', 7);
  const stallScan = await bound.journalRead('c-stall', 0, 10);
  const poison6 = stallScan.events.find((event) => event.seq === 6)?.eventId;
  assert.ok(poison6);
  await bound.journalMarkPoison('c-stall', poison6, 'poison-stall');
  assert.equal((await bound.journalInspect('c-stall')).status, 'stalled');
  const stallCursor = (await bound.journalInspect('c-stall')).cursor;
  const stallBoundary = await bound.journalResync('c-stall');
  assert.equal(
    (await bound.journalInspect('c-stall')).status,
    'stalled',
    'K2b-RED replay: resync never clears a poison stall',
  );
  assert.equal((await bound.journalInspect('c-stall')).cursor, stallCursor);
  assert.equal((await bound.journalInspect('c-stall')).failedEvent, poison6);
  await expectCode(
    async () => bound.journalCheckpoint('c-stall', stallCursor, stallBoundary.journalSeq),
    'invalid-command',
    'K2b-RED replay: a checkpoint still cannot pass an undelivered poisoned event after resync',
  );
  await bound.journalRetry('c-stall', poison6);
  assert.equal((await bound.journalInspect('c-stall')).status, 'running');
  await bound.journalCheckpoint('c-stall', stallCursor, stallBoundary.journalSeq);
  assert.equal((await bound.journalInspect('c-stall')).lag, 0);

  const sealing = await bound.beginStaged({
    operationKey: 'op-replay-sealed',
    inputDigest: 'input-sealed',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: sealing,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-sealed-0',
    effects: {
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'journal-sealed',
          record: { id: 's1', bytes: '{}', hash: 'hash-sealed-1' },
          expectation: { kind: 'absent', allocation: '0' },
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    },
    fence: FENCE,
  });
  const sealed = await bound.sealStaged({
    unit: sealing,
    root: {
      operationId: 'op-replay-sealed',
      contractDigest: 'contract-k2b',
      sourceBoundary: 'boundary-k2b',
      finalFragmentHash: 'digest-sealed-0',
      fragmentCount: '1',
      dependencyRoot: 'dep-root-k2b',
      effectRoot: 'eff-root-k2b',
    },
  });
  const beforeCommit = await bound.journalRead('c1', 0, 100);
  assert.equal(
    beforeCommit.events.some((event) => event.operationKey === 'op-replay-sealed'),
    false,
    'K2b-RED replay: a sealed segment stays invisible before publication',
  );
  const sealedReceipt = await bound.commitStaged({ seal: sealed, fence: FENCE });
  const afterCommit = await bound.journalRead('c1', 0, 100);
  const segment = afterCommit.events.find((event) => event.operationKey === 'op-replay-sealed');
  assert.ok(segment);
  assert.equal(segment.commitId, sealedReceipt.commitId);
  assert.ok(segment.segment);
  assert.equal(segment.segment.from, segment.seq);
  assert.equal(segment.segment.to, segment.seq);

  const abandoned = await bound.beginStaged({
    operationKey: 'op-replay-abandoned',
    inputDigest: 'input-abandoned',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: abandoned,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-abandoned-0',
    effects: {
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'journal-abandoned',
          record: { id: 'x1', bytes: '{}', hash: 'hash-abandoned-1' },
          expectation: { kind: 'absent', allocation: '0' },
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    },
    fence: FENCE,
  });
  await bound.abortStaged({ unit: abandoned });
  const afterAbort = await bound.journalRead('c1', 0, 100);
  assert.equal(
    afterAbort.events.some((event) => event.operationKey === 'op-replay-abandoned'),
    false,
    'K2b-RED replay: an aborted unit leaves no journal entries on the same log',
  );
  const externalAfterAbort = await bound.externalRead(0, 100);
  assert.equal(
    externalAfterAbort.events.some((event) => event.operationKey === 'op-replay-abandoned'),
    false,
  );

  await foreign.commitAtomic({
    guards: [],
    records: [],
    appends: [
      {
        chainId: 'shared-id',
        record: { id: 'foreign-1', bytes: '{"scope":"b"}', hash: 'hash-foreign-1' },
        expectation: { kind: 'absent', allocation: '0' },
      },
    ],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  });
  await bound.commitAtomic({
    guards: [],
    records: [],
    appends: [
      {
        chainId: 'shared-id',
        record: { id: 'local-1', bytes: '{"scope":"a"}', hash: 'hash-local-1' },
        expectation: { kind: 'absent', allocation: '0' },
      },
    ],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  });
  assert.equal(await bound.readHead('shared-id'), 'hash-local-1');
  assert.equal(await foreign.readHead('shared-id'), 'hash-foreign-1');
  const interleaved = await bound.externalRead(0, 100);
  const colliding = interleaved.events.slice(-2);
  const scopes = colliding.map((event) => event.scope.workspaceId);
  assert.equal(scopes.length, 2);
  assert.ok(
    scopes[0].length > 0 && scopes[1].length > 0 && scopes[0] !== scopes[1],
    'K2b-RED replay: interleaved scopes with colliding ids stay separate on one log',
  );
  assert.equal(interleaved.watermark >= 2, true);

  const kernelEvents = await bound.journalRead('c1', 0, 100);
  const mirrorEvents = await bound.externalRead(0, 100);
  const kernelFirst = kernelEvents.events.slice(0, 3).map((event) => `${event.eventId}:${event.commitId}`);
  const mirrorFirst = mirrorEvents.events.slice(0, 3).map((event) => `${event.eventId}:${event.commitId}`);
  assert.deepEqual(
    mirrorFirst,
    kernelFirst,
    'K2b-RED replay: external mirrors preserve kernel identities and order',
  );
  const kernelCommits = kernelEvents.events.map((event) => event.commitId);
  const mirrorCommits = mirrorEvents.events
    .filter((event) => event.scope.workspaceId === kernelEvents.events[0].scope.workspaceId)
    .map((event) => event.commitId);
  assert.deepEqual(mirrorCommits.slice(0, 3), kernelCommits.slice(0, 3));

  const failing = await bound.beginStaged({
    operationKey: 'op-replay-fail',
    inputDigest: 'input-fail',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: failing,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-fail-0',
    effects: {
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'journal-fail',
          record: { id: 'f1', bytes: '{}', hash: 'hash-fail-1' },
          expectation: { kind: 'absent', allocation: '0' },
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    },
    fence: FENCE,
  });
  const failingSeal = await bound.sealStaged({
    unit: failing,
    root: {
      operationId: 'op-replay-fail',
      contractDigest: 'contract-k2b',
      sourceBoundary: 'boundary-k2b',
      finalFragmentHash: 'digest-fail-0',
      fragmentCount: '1',
      dependencyRoot: 'dep-root-k2b',
      effectRoot: 'eff-root-k2b',
    },
  });
  await bound.armExternalFailure();
  await expectCode(
    async () => bound.commitStaged({ seal: failingSeal, fence: FENCE }),
    'invalid-command',
    'K2b-RED replay: an external failure leaves no canonical effects',
  );
  assert.equal(await bound.readHead('journal-fail'), null);
  const afterFail = await bound.journalRead('c1', 0, 100);
  assert.equal(afterFail.events.some((event) => event.operationKey === 'op-replay-fail'), false);
  const afterFailExternal = await bound.externalRead(0, 100);
  assert.equal(afterFailExternal.events.some((event) => event.operationKey === 'op-replay-fail'), false);
  const failReceipt = await bound.commitStaged({ seal: failingSeal, fence: FENCE });
  const failJournal = (await bound.journalRead('c1', 0, 100)).events.find(
    (event) => event.operationKey === 'op-replay-fail',
  );
  const failExternal = (await bound.externalRead(0, 100)).events.find(
    (event) => event.operationKey === 'op-replay-fail',
  );
  assert.ok(failJournal);
  assert.ok(failExternal);
  assert.equal(failJournal.commitId, failReceipt.commitId);
  assert.equal(failExternal.commitId, failReceipt.commitId);
  assert.ok(failJournal.segment);
  assert.ok(failExternal.segment);
  assert.deepEqual(failExternal.segment, failJournal.segment);

  const snapBoundary = await bound.journalResync('c-snap');
  const snapCursorBefore = (await bound.journalInspect('c-snap')).cursor;
  await commitOne(bound, 'journal-snap-later', 8);
  const snapPage = await bound.snapshotRead(snapBoundary.snapshotRoot, 0, 100);
  assert.equal(snapPage.watermark, snapBoundary.journalSeq);
  assert.equal(
    snapPage.events.some((event) => event.commitId === failReceipt.commitId),
    true,
  );
  assert.equal(
    snapPage.events.some((event) => event.seq > snapBoundary.journalSeq),
    false,
    'K2b-RED replay: a snapshot excludes records committed after its boundary',
  );
  assert.equal((await bound.journalInspect('c-snap')).cursor, snapCursorBefore);
  await bound.journalCheckpoint('c-snap', snapCursorBefore, snapBoundary.journalSeq);
  assert.equal((await bound.journalInspect('c-snap')).lag, 1);
  for (const badRoot of ['', 'root-foreign', snapBoundary.snapshotRoot.replace(/^root:/, 'root:x:')]) {
    await expectCode(
      async () => bound.snapshotRead(badRoot, 0, 10),
      'invalid-command',
      'K2b-RED replay: a foreign or malformed snapshot root fails',
    );
  }
  await expectCode(
    async () => bound.snapshotRead(snapBoundary.snapshotRoot.replace(/:\d+$/, `:${snapBoundary.journalSeq + 1000}`), 0, 10),
    'invalid-command',
    'K2b-RED replay: a future snapshot root fails',
  );
};
