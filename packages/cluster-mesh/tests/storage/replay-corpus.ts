// Shared journal/replay corpus (L3a v4.1 frozen §13, §16.1): commit ordering,
// durable watermark, checkpoint CAS, poison recovery, snapshot-bound resync,
// plus external-log interleave, same-log rollback and staged-segment
// visibility. Backend-agnostic: event ids and cursors are backend-minted and
// only replayed, never inspected; every refusal asserts a typed code.

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { stagedDigestOf, stagedSealRoot, type StagedCorpusHandle, type StagedCorpusSeal } from './staged-corpus.js';
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

export interface ReplayFence extends WriterFence {
  readonly incarnation: string;
  readonly ownerId: string;
}

export interface ReplaySnapshotRow {
  readonly kind: 'chain' | 'index' | 'record' | 'aggregate' | 'genesis';
  readonly key: string;
  readonly value: unknown;
}
export interface ReplaySnapshotPage {
  readonly rows: readonly ReplaySnapshotRow[];
  readonly watermark: number;
  readonly next: number | null;
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
  journalFence(): Awaitable<ReplayFence>;
  journalCheckpoint(consumer: string, expected: number, next: number, fence: ReplayFence): Awaitable<void>;
  journalInspect(consumer: string): Awaitable<{ readonly cursor: number; readonly status: 'running' | 'stalled' | 'paused'; readonly failedEvent: string | null; readonly lag: number }>;
  journalPause(consumer: string, fence: ReplayFence): Awaitable<void>;
  journalMarkPoison(consumer: string, eventId: string, reason: string): Awaitable<void>;
  journalRetry(consumer: string, expectedFailure: string | null, fence: ReplayFence): Awaitable<void>;
  journalResync(consumer: string, fence: ReplayFence): Awaitable<{ readonly snapshotRoot: string; readonly journalSeq: number }>;
  snapshotRead(snapshotRoot: string, after: number, limit: number): Awaitable<ReplaySnapshotPage>;
  externalRead(after: number, limit: number): Awaitable<{ readonly events: readonly ReplayCorpusEvent[]; readonly watermark: number }>;
}

export interface ReplayCorpusForeign {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  commitAtomic(unit: AtomicUnit): Awaitable<{ readonly commitId: string }>;
  externalRead(after: number, limit: number): Awaitable<{ readonly events: readonly ReplayCorpusEvent[]; readonly watermark: number }>;
  snapshotRead(snapshotRoot: string, after: number, limit: number): Awaitable<ReplaySnapshotPage>;
}

export interface ReplayCorpusHooks {
  rebind(): Awaitable<ReplayCorpusStore>;
  bindWithoutMaintain(): Awaitable<ReplayCorpusStore>;
}

const consumeSnapshot = async (bound: ReplayCorpusStore, root: string): Promise<readonly ReplaySnapshotRow[]> => {
  const rows: ReplaySnapshotRow[] = [];
  let after = 0;
  for (;;) {
    const page = await bound.snapshotRead(root, after, 2);
    assert.ok(page.rows.length <= 2, 'C13: snapshot enumeration obeys its item bound');
    rows.push(...page.rows);
    if (page.next === null) return rows;
    assert.ok(page.next > after, 'C13: snapshot enumeration advances its retained position');
    after = page.next;
  }
};

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
  const fence = await bound.journalFence();
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

  const weak = await hooks.bindWithoutMaintain();
  for (const [name, action] of [
    ['checkpoint', () => weak.journalCheckpoint('c1', 0, 2, fence)],
    ['pause', () => weak.journalPause('c1', fence)],
    ['retry', () => weak.journalRetry('c1', null, fence)],
    ['resync', () => weak.journalResync('c1', fence)],
  ] as const) {
    await expectCode(action, 'denied', `C12: ${name} requires maintain authority`);
  }
  for (const [name, invalid] of [
    ['stale', { ...fence, epoch: '0' }],
    ['incarnation', { ...fence, incarnation: `${fence.incarnation}-foreign` }],
    ['owner', { ...fence, ownerId: `${fence.ownerId}-foreign` }],
  ] as const) {
    await expectCode(() => bound.journalCheckpoint('c1', 0, 2, invalid), 'invalid-command', `C12: checkpoint rejects a wrong ${name} fence`);
    assert.equal((await bound.journalInspect('c1')).cursor, 0);
  }
  await bound.journalPause('c-paused', fence);
  await bound.journalResync('c-paused', fence);
  assert.equal((await bound.journalInspect('c-paused')).status, 'paused', 'C12: resync preserves an operator pause');
  assert.deepEqual((await bound.journalRead('c-paused', 0, 10)).events, [], 'C12: a paused consumer receives no delivery');
  await bound.journalRetry('c-paused', null, fence);
  assert.equal((await bound.journalInspect('c-paused')).status, 'running');

  await bound.journalCheckpoint('c1', 0, 2, fence);
  assert.equal((await bound.journalInspect('c1')).cursor, 2);
  await expectCode(
    async () => bound.journalCheckpoint('c1', 0, 3, fence),
    'cas-conflict',
    'K2b-RED replay: a stale checkpoint expectation conflicts',
  );
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 1, fence),
    'invalid-command',
    'K2b-RED replay: checkpoints are monotonic',
  );
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 99, fence),
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
  await bound.journalCheckpoint('c2', 0, 2, fence);
  assert.equal(
    (await bound.journalInspect('c2')).cursor,
    2,
    'K2b-RED replay: a sibling consumer still checkpoints while one consumer is stalled',
  );
  assert.equal(stalled.failedEvent, poisoned);
  await expectCode(
    async () => bound.journalCheckpoint('c1', 2, 3, fence),
    'invalid-command',
    'K2b-RED replay: a checkpoint cannot pass an undelivered poisoned event',
  );
  await bound.journalRetry('c1', poisoned, fence);
  assert.equal((await bound.journalInspect('c1')).status, 'running');
  const redelivered = await bound.journalRead('c1', 2, 10);
  assert.equal(
    redelivered.events[0].eventId,
    poisoned,
    'K2b-RED replay: retry preserves the failed event identity and order',
  );
  await bound.journalCheckpoint('c1', 2, 3, fence);

  await commitOne(bound, 'journal-d', 4);
  await commitOne(bound, 'journal-e', 5);
  assert.equal((await bound.journalInspect('c1')).cursor, 3);
  const boundary = await bound.journalResync('c1', fence);
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
  await bound.journalCheckpoint('c1', 3, boundary.journalSeq, fence);
  assert.equal((await bound.journalInspect('c1')).lag, 0);

  await commitOne(bound, 'journal-f', 6);
  await commitOne(bound, 'journal-g', 7);
  const stallScan = await bound.journalRead('c-stall', 0, 10);
  const poison6 = stallScan.events.find((event) => event.seq === 6)?.eventId;
  assert.ok(poison6);
  await bound.journalMarkPoison('c-stall', poison6, 'poison-stall');
  assert.equal((await bound.journalInspect('c-stall')).status, 'stalled');
  const stallCursor = (await bound.journalInspect('c-stall')).cursor;
  const stallBoundary = await bound.journalResync('c-stall', fence);
  assert.equal(
    (await bound.journalInspect('c-stall')).status,
    'stalled',
    'K2b-RED replay: resync never clears a poison stall',
  );
  assert.equal((await bound.journalInspect('c-stall')).cursor, stallCursor);
  assert.equal((await bound.journalInspect('c-stall')).failedEvent, poison6);
  await consumeSnapshot(bound, stallBoundary.snapshotRoot);
  assert.equal((await bound.journalInspect('c-stall')).status, 'stalled', 'C12: consuming a snapshot does not discharge poison');
  await expectCode(
    async () => bound.journalCheckpoint('c-stall', stallCursor, stallBoundary.journalSeq, fence),
    'invalid-command',
    'K2b-RED replay: a checkpoint still cannot pass an undelivered poisoned event after resync',
  );
  await bound.journalRetry('c-stall', poison6, fence);
  assert.equal((await bound.journalInspect('c-stall')).status, 'running');
  const deliveredAgain = await bound.journalRead('c-stall', 5, 100);
  assert.equal(deliveredAgain.events[0].eventId, poison6, 'C12: snapshot consumption preserves poison redelivery');
  await bound.journalCheckpoint('c-stall', stallCursor, stallBoundary.journalSeq, fence);
  assert.equal((await bound.journalInspect('c-stall')).lag, 0);

  const sealing = await bound.beginStaged({
    operationKey: 'op-replay-sealed',
    inputDigest: 'input-sealed',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence,
  });
  const sealingEffects: AtomicUnit = {
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
  };
  await bound.stageFragment({
    unit: sealing,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(sealing, '0', null, sealingEffects),
    effects: sealingEffects,
    fence,
  });
  const sealed = await bound.sealStaged({
    unit: sealing,
    root: stagedSealRoot(sealing, [sealingEffects]),
  });
  const beforeCommit = await bound.journalRead('c1', 0, 100);
  assert.equal(
    beforeCommit.events.some((event) => event.operationKey === 'op-replay-sealed'),
    false,
    'K2b-RED replay: a sealed segment stays invisible before publication',
  );
  const sealedReceipt = await bound.commitStaged({ seal: sealed, fence });
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
    fence,
  });
  const abandonedEffects: AtomicUnit = {
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
  };
  await bound.stageFragment({
    unit: abandoned,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(abandoned, '0', null, abandonedEffects),
    effects: abandonedEffects,
    fence,
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
  const foreignEvents = await foreign.externalRead(0, 100);
  assert.ok(interleaved.events.every((event) => event.scope.workspaceId === first.events[0].scope.workspaceId), 'C11: an external stream reveals only its own scope');
  assert.ok(foreignEvents.events.every((event) => event.scope.workspaceId !== first.events[0].scope.workspaceId), 'C11: the sibling stream reveals only its own scope');
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
    fence,
  });
  const failingEffects: AtomicUnit = {
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
  };
  await bound.stageFragment({
    unit: failing,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(failing, '0', null, failingEffects),
    effects: failingEffects,
    fence,
  });
  const failingSeal = await bound.sealStaged({
    unit: failing,
    root: stagedSealRoot(failing, [failingEffects]),
  });
  await bound.armExternalFailure();
  await expectCode(
    async () => bound.commitStaged({ seal: failingSeal, fence }),
    'invalid-command',
    'K2b-RED replay: an external failure leaves no canonical effects',
  );
  assert.equal(await bound.readHead('journal-fail'), null);
  const afterFail = await bound.journalRead('c1', 0, 100);
  assert.equal(afterFail.events.some((event) => event.operationKey === 'op-replay-fail'), false);
  const afterFailExternal = await bound.externalRead(0, 100);
  assert.equal(afterFailExternal.events.some((event) => event.operationKey === 'op-replay-fail'), false);
  const failReceipt = await bound.commitStaged({ seal: failingSeal, fence });
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

  await bound.commitAtomic({
    guards: [], records: [], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [],
    indexWrites: [{ key: 'snapshot-index', digest: 'snapshot-digest', resultIds: ['captured'], resultHash: null }],
  });
  const snapBoundary = await bound.journalResync('c-snap', fence);
  const snapCursorBefore = (await bound.journalInspect('c-snap')).cursor;
  await commitOne(bound, 'journal-snap-later', 8);
  const snapPage = await bound.snapshotRead(snapBoundary.snapshotRoot, 0, 100);
  assert.equal(snapPage.watermark, snapBoundary.journalSeq);
  assert.equal(
    snapPage.rows.some((row) => row.kind === 'chain' && row.key === 'journal-fail'), true,
    'C13: snapshot consumption reads committed canonical heads',
  );
  assert.deepEqual(snapPage.rows.find((row) => row.kind === 'index' && row.key === 'snapshot-index')?.value,
    { digest: 'snapshot-digest', resultIds: ['captured'], resultHash: null }, 'C13: snapshot consumption reads captured command indexes');
  assert.equal(
    snapPage.rows.some((row) => row.key === 'journal-snap-later'),
    false,
    'K2b-RED replay: a snapshot excludes records committed after its boundary',
  );
  assert.equal((await bound.journalInspect('c-snap')).cursor, snapCursorBefore);
  await bound.journalCheckpoint('c-snap', snapCursorBefore, snapBoundary.journalSeq, fence);
  assert.equal((await bound.journalInspect('c-snap')).lag, 1);
  for (const badRoot of ['', 'root-foreign', `${snapBoundary.snapshotRoot}:uncaptured`]) {
    await expectCode(
      async () => bound.snapshotRead(badRoot, 0, 10),
      'invalid-command',
      'K2b-RED replay: a foreign or malformed snapshot root fails',
    );
  }
  await expectCode(
    async () => foreign.snapshotRead(snapBoundary.snapshotRoot, 0, 10),
    'invalid-command',
    'C13: a captured snapshot root cannot cross scopes',
  );
};
