// Shared staged-unit corpus (L3a v4.1 frozen §7, §16.1): fragment sequencing,
// hidden state, atomic publication, base conflicts and recovery.
// Backend-agnostic: only backend-minted handles, seals and cursors flow back;
// every refusal asserts a typed code, never a reference message (§5.2).

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit, CommitOptions } from '../../src/storage/atomic.js';
import type { StorageModuleId, StorageScope, WorkLimits, WriterFence } from '../../src/storage/contracts.js';
import { stagedCommitRoots, stagedFragmentDigest } from '../../src/storage/staged-codec.js';
import type { StagedCommitRoot, StagedUnitStatus } from '../../src/storage/staged-units.js';

export interface StagedCorpusHandle {
  readonly unitId: string;
  readonly operationKey: string;
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
}

export interface StagedCorpusSeal {
  readonly unitId: string;
  readonly commitRoot: StagedCommitRoot;
}

export interface StagedCorpusRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface StagedCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  readChain(chainId: string): Awaitable<readonly StagedCorpusRecord[]>;
  readRecord(key: string): Awaitable<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  indexGet(key: string): Awaitable<{ readonly digest: string; readonly resultIds: readonly string[]; readonly resultHash: string | null } | null>;
  commitAtomic(unit: AtomicUnit, options?: CommitOptions): Awaitable<{ readonly commitId: string }>;
  disposeChain(chainId: string): Awaitable<void>;
  beginStaged(input: { readonly operationKey: string; readonly inputDigest: string; readonly contractDigest: string; readonly sourceBoundary: string; readonly fence: WriterFence }): Awaitable<StagedCorpusHandle>;
  stageFragment(input: { readonly unit: StagedCorpusHandle; readonly ordinal: string; readonly predecessorHash: string | null; readonly fragmentDigest: string; readonly effects: AtomicUnit; readonly fence: WriterFence; readonly limits?: WorkLimits }): Awaitable<{ readonly unitId: string; readonly ordinal: string; readonly fragmentDigest: string }>;
  sealStaged(input: { readonly unit: StagedCorpusHandle; readonly root: StagedCommitRoot }): Awaitable<StagedCorpusSeal>;
  commitStaged(input: { readonly seal: StagedCorpusSeal; readonly fence: WriterFence }): Awaitable<{ readonly commitId: string }>;
  inspectStaged(operationKey: string): Awaitable<StagedUnitStatus>;
  abortStaged(input: { readonly unit: StagedCorpusHandle }): Awaitable<void>;
}

export interface StagedCorpusHooks {
  breakAuthority(): Awaitable<void>;
}

export type StagedCorpusForeign = StagedCorpusStore;

const FENCE: WriterFence = { fenceId: 'fence-k2b', epoch: '1' };

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

const appendUnit = (chainId: string, id: string, hash: string, head: string | null): AtomicUnit => ({
  ...emptyUnit(),
  appends: [
    {
      chainId,
      record: { id, bytes: `{"id":"${id}"}`, hash },
      expectation: head === null ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: head },
    },
  ],
});

const CONTRACT = 'contract-k2b';
const BOUNDARY = 'boundary-k2b';

/** Fragment digest recomputed from the shared codec (MAJEUR-N1, N1). */
export const stagedDigestOf = (
  unit: StagedCorpusHandle,
  ordinal: string,
  predecessorHash: string | null,
  effects: AtomicUnit,
  contractDigest: string = CONTRACT,
  sourceBoundary: string = BOUNDARY,
): string =>
  stagedFragmentDigest(
    { moduleId: unit.moduleId, scope: unit.scope, operationId: unit.operationKey, contractDigest, sourceBoundary, ordinal, predecessorHash },
    effects,
  );

/** Seal root over the ordered fragment effects, every field recomputed. */
export const stagedSealRoot = (
  unit: StagedCorpusHandle,
  fragments: readonly AtomicUnit[],
  contractDigest: string = CONTRACT,
  sourceBoundary: string = BOUNDARY,
): StagedCommitRoot => {
  let predecessor: string | null = null;
  for (const [index, effects] of fragments.entries()) {
    predecessor = stagedDigestOf(unit, String(index), predecessor, effects, contractDigest, sourceBoundary);
  }
  return {
    operationId: unit.operationKey,
    contractDigest,
    sourceBoundary,
    finalFragmentHash: predecessor ?? '',
    fragmentCount: String(fragments.length),
    ...stagedCommitRoots(fragments.map((effects, index) => ({ ordinal: String(index), effects }))),
  };
};

export const runStagedCorpus = async (
  bound: StagedCorpusStore,
  hooks: StagedCorpusHooks,
  foreign?: StagedCorpusForeign,
): Promise<void> => {
  const unit = await bound.beginStaged({
    operationKey: 'op-staged-1',
    inputDigest: 'input-1',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  assert.ok(unit.unitId.length > 0);
  assert.deepEqual(await bound.inspectStaged('op-staged-1'), {
    state: 'staging',
    acceptedFragments: '0',
  });

  const e0 = appendUnit('chain-s1', 's1', 'hash-s1', null);
  const d0 = stagedDigestOf(unit, '0', null, e0);
  const first = await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: d0, effects: e0, fence: FENCE });
  assert.equal(first.fragmentDigest, d0);

  const retry = await bound.stageFragment({
    unit,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: d0,
    effects: appendUnit('chain-s1', 's1', 'hash-s1', null),
    fence: FENCE,
  });
  assert.deepEqual(retry, first, 'K2b-RED staged: an identical retry returns the same fragment receipt');

  const gap = appendUnit('chain-s1', 's1b', 'hash-s1b', null);
  await expectCode(
    async () =>
      bound.stageFragment({ unit, ordinal: '2', predecessorHash: d0, fragmentDigest: stagedDigestOf(unit, '2', d0, gap), effects: gap, fence: FENCE }),
    'invalid-command',
    'K2b-RED staged: gaps cannot advance the frontier',
  );

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: '0',
        predecessorHash: null,
        fragmentDigest: 'digest-changed',
        effects: appendUnit('chain-s1', 's1', 'hash-s1', null),
        fence: FENCE,
      }),
    'idempotency-conflict',
    'K2b-RED staged: changed bytes at an accepted ordinal conflict',
  );

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: '0',
        predecessorHash: null,
        fragmentDigest: d0,
        effects: appendUnit('chain-s1', 's1-divergent', 'hash-s1-divergent', null),
        fence: FENCE,
      }),
    'idempotency-conflict',
    'K2b-RED staged: changed effects under a repeated digest conflict',
  );

  await expectCode(
    async () =>
      bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: d0, effects: appendUnit('chain-s1', 's1', 'hash-s1', 'hash-elsewhere'), fence: FENCE }),
    'idempotency-conflict',
    'K2b-RED staged: a changed dependency under a repeated digest conflicts',
  );

  const e1: AtomicUnit = {
    ...appendUnit('chain-s2', 's2', 'hash-s2', null),
    records: [{ key: 'rec-hidden-1', bytes: { format: 'utf8', data: 'hidden' }, contentHash: 'h-hidden-1' }],
    indexWrites: [{ key: 'staged-idx-1', digest: 'd1', resultIds: ['r1'], resultHash: null }],
  };
  const other = appendUnit('chain-s2', 's2-other', 'hash-s2-other', null);
  await expectCode(
    async () =>
      bound.stageFragment({ unit, ordinal: '1', predecessorHash: d0, fragmentDigest: stagedDigestOf(unit, '1', d0, other), effects: e1, fence: FENCE }),
    'invalid-command',
    'K2b-RED staged: a declared digest of other effects cannot stage a new ordinal',
  );

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: '1',
        predecessorHash: 'digest-wrong',
        fragmentDigest: stagedDigestOf(unit, '1', 'digest-wrong', e1),
        effects: e1,
        fence: FENCE,
      }),
    'invalid-command',
    'K2b-RED staged: a predecessor off the accepted frontier cannot advance',
  );

  await expectCode(
    async () =>
      bound.stageFragment({ unit, ordinal: 'x', predecessorHash: d0, fragmentDigest: 'digest-x', effects: e1, fence: FENCE }),
    'invalid-command',
    'K2b-RED staged: a corrupt ordinal cannot advance',
  );

  const d1 = stagedDigestOf(unit, '1', d0, e1);
  await bound.stageFragment({ unit, ordinal: '1', predecessorHash: d0, fragmentDigest: d1, effects: e1, fence: FENCE });

  assert.equal(
    await bound.readHead('chain-s1'),
    null,
    'K2b-RED staged: staged effects stay invisible to head lookup',
  );
  assert.deepEqual(await bound.readChain('chain-s2'), []);
  assert.equal(
    await bound.readRecord('rec-hidden-1'),
    null,
    'K2b-RED staged: staged records stay invisible to direct lookup',
  );
  assert.equal(
    await bound.indexGet('staged-idx-1'),
    null,
    'K2b-RED staged: staged index writes stay invisible to command-result lookup',
  );
  assert.ok(
    !('commitId' in first),
    'K2b-RED staged: a staging receipt is never a canonical commit receipt',
  );
  await expectCode(
    async () =>
      bound.beginStaged({
        operationKey: 'op-staged-bad-fence',
        inputDigest: 'input-bad',
        contractDigest: 'contract-k2b',
        sourceBoundary: 'boundary-k2b',
        fence: { fenceId: '', epoch: '1' },
      }),
    'invalid-command',
    'K2b-RED staged: a malformed fence cannot open a unit',
  );

  const staleWriter = await bound.beginStaged({
    operationKey: 'op-staged-stale',
    inputDigest: 'input-stale',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const stale = appendUnit('chain-stale', 'st1', 'hash-st1', null);
  await bound.stageFragment({ unit: staleWriter, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(staleWriter, '0', null, stale), effects: stale, fence: FENCE });
  const staleSeal = await bound.sealStaged({ unit: staleWriter, root: stagedSealRoot(staleWriter, [stale]) });
  await expectCode(
    async () => bound.commitStaged({ seal: staleSeal, fence: { fenceId: 'fence-k2b', epoch: '0' } }),
    'invalid-command',
    'K2b-RED staged: a stale writer cannot publish',
  );
  assert.equal(await bound.readHead('chain-stale'), null);
  const freshReceipt = await bound.commitStaged({ seal: staleSeal, fence: FENCE });
  assert.equal(await bound.readHead('chain-stale'), 'hash-st1');
  assert.ok(freshReceipt.commitId.length > 0);

  const immutableUnit = await bound.beginStaged({
    operationKey: 'op-staged-immutable',
    inputDigest: 'input-immutable',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const mutableEffects = appendUnit('chain-immutable', 'im1', 'hash-im1', null);
  const pristine = appendUnit('chain-immutable', 'im1', 'hash-im1', null);
  await bound.stageFragment({
    unit: immutableUnit,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(immutableUnit, '0', null, pristine),
    effects: mutableEffects,
    fence: FENCE,
  });
  const immutableSeal = await bound.sealStaged({ unit: immutableUnit, root: stagedSealRoot(immutableUnit, [pristine]) });
  mutableEffects.appends.push(
    ...appendUnit('chain-mutated', 'mu1', 'hash-mu1', null).appends,
  );
  await bound.commitStaged({ seal: immutableSeal, fence: FENCE });
  assert.equal(await bound.readHead('chain-immutable'), 'hash-im1');
  assert.equal(
    await bound.readHead('chain-mutated'),
    null,
    'K2b-RED staged: buffers are immutable after acceptance',
  );
  mutableEffects.appends[0].record.bytes = '{"tampered":true}';
  assert.equal(await bound.readHead('chain-immutable'), 'hash-im1');
  const tamperedReceipt = await bound.commitStaged({ seal: immutableSeal, fence: FENCE });
  const receiptCopy = tamperedReceipt.commitId;
  (tamperedReceipt as { commitId: string }).commitId = 'tampered-commit';
  const recoveredImmutable = await bound.commitStaged({ seal: immutableSeal, fence: FENCE });
  assert.equal(recoveredImmutable.commitId, receiptCopy, 'K2b-RED staged: stored receipts stay immutable after delivery');

  const sameBegin = await bound.beginStaged({
    operationKey: 'op-staged-1',
    inputDigest: 'input-1',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  assert.equal(sameBegin.unitId, unit.unitId);
  for (const divergent of [
    { inputDigest: 'input-other', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b' },
    { inputDigest: 'input-1', contractDigest: 'contract-other', sourceBoundary: 'boundary-k2b' },
    { inputDigest: 'input-1', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-other' },
  ]) {
    await expectCode(
      async () => bound.beginStaged({ operationKey: 'op-staged-1', fence: FENCE, ...divergent }),
      'idempotency-conflict',
      'K2b-RED staged: a divergent begin conflicts',
    );
  }
  const unitRoot = stagedSealRoot(unit, [e0, e1]);
  await expectCode(
    async () => bound.sealStaged({ unit, root: { ...unitRoot, fragmentCount: '5' } }),
    'invalid-command',
    'K2b-RED staged: wrong counts cannot seal',
  );
  await expectCode(
    async () => bound.sealStaged({ unit, root: { ...unitRoot, finalFragmentHash: 'digest-wrong' } }),
    'invalid-command',
    'K2b-RED staged: truncated chains cannot seal',
  );
  const foreignRoots = stagedSealRoot(unit, [e0, other]);
  for (const [label, changed] of [
    ['operation', { operationId: 'op-other' }],
    ['contract', { contractDigest: 'contract-other' }],
    ['boundary', { sourceBoundary: 'boundary-other' }],
    ['dependencies', { dependencyRoot: 'dep-other' }],
    ['effects', { effectRoot: 'eff-other' }],
    ['self-consistent dependencies', { dependencyRoot: foreignRoots.dependencyRoot }],
    ['self-consistent effects', { effectRoot: foreignRoots.effectRoot }],
  ] as const) {
    const candidate = await bound.beginStaged({ operationKey: `bad-seal-${label}`, inputDigest: 'input-1', contractDigest: CONTRACT, sourceBoundary: BOUNDARY, fence: FENCE });
    let predecessorHash: string | null = null;
    for (const [index, effects] of [e0, e1].entries()) {
      const fragmentDigest = stagedDigestOf(candidate, String(index), predecessorHash, effects);
      await bound.stageFragment({ unit: candidate, ordinal: String(index), predecessorHash, fragmentDigest, effects, fence: FENCE });
      predecessorHash = fragmentDigest;
    }
    const root = { ...stagedSealRoot(candidate, [e0, e1]), ...changed };
    await expectCode(
      async () => bound.sealStaged({ unit: candidate, root }),
      'invalid-command',
      `K2b-RED staged: a divergent seal ${label} cannot seal`,
    );
  }
  const seal = await bound.sealStaged({ unit, root: unitRoot });
  const tamperedRoot = { ...seal.commitRoot, dependencyRoot: 'tampered-root' };
  await expectCode(
    async () => bound.commitStaged({ seal: { ...seal, commitRoot: tamperedRoot }, fence: FENCE }),
    'invalid-command',
    'K2b-RED staged: a mutated seal cannot publish',
  );
  (seal.commitRoot as { dependencyRoot: string }).dependencyRoot = 'tampered-root';
  const freshSeal = { ...seal, commitRoot: stagedSealRoot(unit, [e0, e1]) };
  assert.deepEqual(await bound.inspectStaged('op-staged-1'), { state: 'sealed', seal: freshSeal });

  const e3 = appendUnit('chain-s3', 's3', 'hash-s3', null);
  await expectCode(
    async () =>
      bound.stageFragment({ unit, ordinal: '2', predecessorHash: d1, fragmentDigest: stagedDigestOf(unit, '2', d1, e3), effects: e3, fence: FENCE }),
    'invalid-command',
    'K2b-RED staged: sealing freezes fragment input',
  );

  const receipt = await bound.commitStaged({ seal: freshSeal, fence: FENCE });
  assert.deepEqual(await bound.inspectStaged('op-staged-1'), { state: 'committed', commitId: receipt.commitId });
  assert.equal(await bound.readHead('chain-s1'), 'hash-s1');
  assert.equal(await bound.readHead('chain-s2'), 'hash-s2');
  assert.deepEqual(
    await bound.readRecord('rec-hidden-1'),
    { bytes: { format: 'utf8', data: 'hidden' }, contentHash: 'h-hidden-1' },
    'K2b-RED staged: staged records publish atomically with their unit',
  );
  assert.deepEqual(
    await bound.indexGet('staged-idx-1'),
    { digest: 'd1', resultIds: ['r1'], resultHash: null },
    'K2b-RED staged: staged index writes publish atomically with their unit',
  );

  const recovered = await bound.commitStaged({ seal: freshSeal, fence: FENCE });
  assert.equal(
    recovered.commitId,
    receipt.commitId,
    'K2b-RED staged: commit before response recovers the same receipt',
  );
  await expectCode(
    async () =>
      bound.beginStaged({
        operationKey: 'op-staged-1',
        inputDigest: 'input-divergent-after-commit',
        contractDigest: 'contract-k2b',
        sourceBoundary: 'boundary-k2b',
        fence: FENCE,
      }),
    'idempotency-conflict',
    'K2b-RED staged: a divergent begin conflicts after completion',
  );

  const guarded = await bound.beginStaged({
    operationKey: 'op-staged-base',
    inputDigest: 'input-base',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const guardedEffects: AtomicUnit = {
    ...emptyUnit(),
    guards: [{ kind: 'head', chainId: 'chain-s1', hash: 'hash-s1' }],
    appends: appendUnit('chain-base', 'b1', 'hash-b1', null).appends,
  };
  await bound.stageFragment({
    unit: guarded,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(guarded, '0', null, guardedEffects),
    effects: guardedEffects,
    fence: FENCE,
  });
  const guardedSeal = await bound.sealStaged({ unit: guarded, root: stagedSealRoot(guarded, [guardedEffects]) });
  await expectCode(
    async () =>
      bound.commitStaged({
        seal: { unitId: guardedSeal.unitId, commitRoot: { ...guardedSeal.commitRoot, dependencyRoot: 'tampered-root' } },
        fence: FENCE,
      }),
    'invalid-command',
    'K2b-RED staged: a substituted seal cannot publish',
  );
  await bound.appendChain('chain-s1', { id: 's1-rival', bytes: '{}', hash: 'hash-s1-rival' }, { kind: 'head', hash: 'hash-s1' });
  await expectCode(
    async () => bound.commitStaged({ seal: guardedSeal, fence: FENCE }),
    'cas-conflict',
    'K2b-RED staged: a changed base produces a conflict without publication',
  );
  assert.equal(await bound.readHead('chain-base'), null);

  const indexed = await bound.beginStaged({
    operationKey: 'op-staged-index-race',
    inputDigest: 'input-index-race',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const indexedEffects: AtomicUnit = {
    ...emptyUnit(),
    indexWrites: [{ key: 'idx-race', digest: 'd-race', resultIds: ['r1'], resultHash: null }],
  };
  await bound.stageFragment({
    unit: indexed,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(indexed, '0', null, indexedEffects),
    effects: indexedEffects,
    fence: FENCE,
  });
  const indexedSeal = await bound.sealStaged({ unit: indexed, root: stagedSealRoot(indexed, [indexedEffects]) });
  await bound.commitAtomic({
    ...emptyUnit(),
    indexWrites: [{ key: 'idx-race', digest: 'd-race', resultIds: ['r2'], resultHash: null }],
  });
  await expectCode(
    async () => bound.commitStaged({ seal: indexedSeal, fence: FENCE }),
    'cas-conflict',
    'K2b-RED staged: an unguarded index replacement conflicts without publication',
  );

  const aborted = await bound.beginStaged({
    operationKey: 'op-staged-abort',
    inputDigest: 'input-abort',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const abortedEffects = appendUnit('chain-abandoned', 'x1', 'hash-x1', null);
  await bound.stageFragment({
    unit: aborted,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(aborted, '0', null, abortedEffects),
    effects: abortedEffects,
    fence: FENCE,
  });
  await bound.abortStaged({ unit: aborted });
  assert.equal(
    (await bound.inspectStaged('op-staged-abort')).state,
    'aborted',
    'K2b-RED staged: abandoned units report abortion',
  );
  assert.equal(await bound.readHead('chain-abandoned'), null);
  await expectCode(
    async () => bound.sealStaged({ unit: aborted, root: stagedSealRoot(aborted, [abortedEffects]) }),
    'invalid-command',
    'K2b-RED staged: abandoned units cannot seal',
  );

  const limits: WorkLimits = { maxRecords: 128, maxAppends: 2, maxEncodedBytes: 524288 };
  const grouped = await bound.beginStaged({
    operationKey: 'op-staged-group',
    inputDigest: 'input-group',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const oversized: AtomicUnit = {
    ...emptyUnit(),
    appends: [
      ...appendUnit('chain-lg-0', 'lg0', 'hash-lg-0', null).appends,
      ...appendUnit('chain-lg-1', 'lg1', 'hash-lg-1', null).appends,
      ...appendUnit('chain-lg-2', 'lg2', 'hash-lg-2', null).appends,
    ],
  };
  await expectCode(
    async () =>
      bound.stageFragment({
        unit: grouped,
        ordinal: '0',
        predecessorHash: null,
        fragmentDigest: stagedDigestOf(grouped, '0', null, oversized),
        effects: oversized,
        fence: FENCE,
        limits,
      }),
    'invalid-command',
    'K2b-RED staged: a fragment over atomic limits cannot stage',
  );
  const groupEffects: AtomicUnit[] = [];
  let predecessor: string | null = null;
  for (let n = 0; n < 12; n += 1) {
    const effects = appendUnit(`chain-lg-${n}`, `lg${n}`, `hash-lg-${n}`, null);
    const digest = stagedDigestOf(grouped, String(n), predecessor, effects);
    await bound.stageFragment({
      unit: grouped,
      ordinal: String(n),
      predecessorHash: predecessor,
      fragmentDigest: digest,
      effects,
      fence: FENCE,
      limits,
    });
    groupEffects.push(effects);
    predecessor = digest;
  }
  const groupedSeal = await bound.sealStaged({ unit: grouped, root: stagedSealRoot(grouped, groupEffects) });
  await bound.commitStaged({ seal: groupedSeal, fence: FENCE });
  for (let n = 0; n < 12; n += 1) {
    assert.equal(await bound.readHead(`chain-lg-${n}`), `hash-lg-${n}`);
  }

  const dependent = await bound.beginStaged({
    operationKey: 'op-staged-dependent',
    inputDigest: 'input-dependent',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const depEffects = [
    appendUnit('chain-dep', 'd0', 'hash-dep-0', null),
    appendUnit('chain-dep', 'd1', 'hash-dep-1', 'hash-dep-0'),
    appendUnit('chain-dep', 'd2', 'hash-dep-2', 'hash-dep-1'),
  ];
  let depPredecessor: string | null = null;
  for (const [index, effects] of depEffects.entries()) {
    const digest = stagedDigestOf(dependent, String(index), depPredecessor, effects);
    await bound.stageFragment({ unit: dependent, ordinal: String(index), predecessorHash: depPredecessor, fragmentDigest: digest, effects, fence: FENCE });
    depPredecessor = digest;
  }
  const depSeal = await bound.sealStaged({ unit: dependent, root: stagedSealRoot(dependent, depEffects) });
  await bound.commitStaged({ seal: depSeal, fence: FENCE });
  assert.equal(await bound.readHead('chain-dep'), 'hash-dep-2');
  assert.deepEqual(
    (await bound.readChain('chain-dep')).map((entry) => entry.hash),
    ['hash-dep-0', 'hash-dep-1', 'hash-dep-2'],
    'K2b-RED staged: successive fragments publish the full ordered history',
  );

  const unresolved = await bound.beginStaged({
    operationKey: 'op-staged-unresolved',
    inputDigest: 'input-unresolved',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const unresolvedEffects = appendUnit('chain-unresolved', 'u1', 'hash-u1', 'hash-missing');
  await bound.stageFragment({
    unit: unresolved,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(unresolved, '0', null, unresolvedEffects),
    effects: unresolvedEffects,
    fence: FENCE,
  });
  await expectCode(
    async () => bound.sealStaged({ unit: unresolved, root: stagedSealRoot(unresolved, [unresolvedEffects]) }),
    'invalid-command',
    'K2b-RED staged: a self-consistent fragment with an unresolved dependency cannot seal',
  );
  assert.equal(await bound.readHead('chain-unresolved'), null);

  if (foreign) {
    const local = await bound.beginStaged({
      operationKey: 'op-collide',
      inputDigest: 'input-collide',
      contractDigest: 'contract-k2b',
      sourceBoundary: 'boundary-k2b',
      fence: FENCE,
    });
    const remote = await foreign.beginStaged({
      operationKey: 'op-collide',
      inputDigest: 'input-collide',
      contractDigest: 'contract-k2b',
      sourceBoundary: 'boundary-k2b',
      fence: FENCE,
    });
    const collide = appendUnit('chain-collide', 'c1', 'hash-c1', null);
    await expectCode(
      async () =>
        foreign.stageFragment({ unit: local, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(local, '0', null, collide), effects: collide, fence: FENCE }),
      'invalid-command',
      'K2b-RED staged: a foreign handle cannot stage',
    );
    await expectCode(
      async () =>
        bound.stageFragment({ unit: remote, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(remote, '0', null, collide), effects: collide, fence: FENCE }),
      'invalid-command',
      'K2b-RED staged: a foreign handle cannot stage',
    );
    await foreign.stageFragment({ unit: remote, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(remote, '0', null, collide), effects: collide, fence: FENCE });
    const remoteSeal = await foreign.sealStaged({ unit: remote, root: stagedSealRoot(remote, [collide]) });
    await expectCode(
      async () => bound.commitStaged({ seal: remoteSeal, fence: FENCE }),
      'invalid-command',
      'K2b-RED staged: a foreign seal cannot publish',
    );
    await expectCode(
      async () => foreign.abortStaged({ unit: local }),
      'invalid-command',
      'K2b-RED staged: a foreign handle cannot abort',
    );
    await foreign.abortStaged({ unit: remote });
  }

  const doomed = await bound.beginStaged({
    operationKey: 'op-staged-auth',
    inputDigest: 'input-auth',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  const doomedEffects = appendUnit('chain-auth', 'a1', 'hash-a1', null);
  await bound.stageFragment({
    unit: doomed,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: stagedDigestOf(doomed, '0', null, doomedEffects),
    effects: doomedEffects,
    fence: FENCE,
  });
  const doomedSeal = await bound.sealStaged({ unit: doomed, root: stagedSealRoot(doomed, [doomedEffects]) });
  await hooks.breakAuthority();
  await expectCode(
    async () => bound.commitStaged({ seal: doomedSeal, fence: FENCE }),
    'denied',
    'K2b-RED staged: changed authority denies publication',
  );
};
