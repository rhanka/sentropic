// Shared staged-unit corpus (L3a v4.1 frozen §7, §16.1): fragment sequencing,
// hidden state, atomic publication, base conflicts and recovery.
// Backend-agnostic: only backend-minted handles, seals and cursors flow back;
// every refusal asserts a typed code, never a reference message (§5.2).

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit, CommitOptions } from '../../src/storage/atomic.js';
import type { WorkLimits, WriterFence } from '../../src/storage/contracts.js';
import type { StagedCommitRoot, StagedUnitStatus } from '../../src/storage/staged-units.js';

export interface StagedCorpusHandle {
  readonly unitId: string;
  readonly operationKey: string;
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

const sealRoot = (operationId: string, finalFragmentHash: string, fragmentCount: string): StagedCommitRoot => ({
  operationId,
  contractDigest: 'contract-k2b',
  sourceBoundary: 'boundary-k2b',
  finalFragmentHash,
  fragmentCount,
  dependencyRoot: 'dep-root-k2b',
  effectRoot: 'eff-root-k2b',
});

export const runStagedCorpus = async (bound: StagedCorpusStore, hooks: StagedCorpusHooks): Promise<void> => {
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

  const first = await bound.stageFragment({
    unit,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-0',
    effects: appendUnit('chain-s1', 's1', 'hash-s1', null),
    fence: FENCE,
  });
  assert.equal(first.fragmentDigest, 'digest-0');

  const retry = await bound.stageFragment({
    unit,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-0',
    effects: appendUnit('chain-s1', 's1', 'hash-s1', null),
    fence: FENCE,
  });
  assert.deepEqual(retry, first, 'K2b-RED staged: an identical retry returns the same fragment receipt');

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: '2',
        predecessorHash: 'digest-0',
        fragmentDigest: 'digest-2',
        effects: appendUnit('chain-s1', 's1b', 'hash-s1b', null),
        fence: FENCE,
      }),
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
        ordinal: '1',
        predecessorHash: 'digest-wrong',
        fragmentDigest: 'digest-1',
        effects: appendUnit('chain-s2', 's2', 'hash-s2', null),
        fence: FENCE,
      }),
    'invalid-command',
    'K2b-RED staged: a predecessor off the accepted frontier cannot advance',
  );

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: 'x',
        predecessorHash: 'digest-0',
        fragmentDigest: 'digest-x',
        effects: appendUnit('chain-s2', 's2', 'hash-s2', null),
        fence: FENCE,
      }),
    'invalid-command',
    'K2b-RED staged: a corrupt ordinal cannot advance',
  );

  await bound.stageFragment({
    unit,
    ordinal: '1',
    predecessorHash: 'digest-0',
    fragmentDigest: 'digest-1',
    effects: appendUnit('chain-s2', 's2', 'hash-s2', null),
    fence: FENCE,
  });

  assert.equal(
    await bound.readHead('chain-s1'),
    null,
    'K2b-RED staged: staged effects stay invisible to head lookup',
  );
  assert.deepEqual(await bound.readChain('chain-s2'), []);

  await expectCode(
    async () => bound.sealStaged({ unit, root: sealRoot('op-staged-1', 'digest-1', '5') }),
    'invalid-command',
    'K2b-RED staged: wrong counts cannot seal',
  );
  await expectCode(
    async () => bound.sealStaged({ unit, root: sealRoot('op-staged-1', 'digest-wrong', '2') }),
    'invalid-command',
    'K2b-RED staged: truncated chains cannot seal',
  );
  const seal = await bound.sealStaged({ unit, root: sealRoot('op-staged-1', 'digest-1', '2') });
  assert.deepEqual(await bound.inspectStaged('op-staged-1'), { state: 'sealed', seal });

  await expectCode(
    async () =>
      bound.stageFragment({
        unit,
        ordinal: '2',
        predecessorHash: 'digest-1',
        fragmentDigest: 'digest-2',
        effects: appendUnit('chain-s3', 's3', 'hash-s3', null),
        fence: FENCE,
      }),
    'invalid-command',
    'K2b-RED staged: sealing freezes fragment input',
  );

  const receipt = await bound.commitStaged({ seal, fence: FENCE });
  assert.deepEqual(await bound.inspectStaged('op-staged-1'), { state: 'committed', commitId: receipt.commitId });
  assert.equal(await bound.readHead('chain-s1'), 'hash-s1');
  assert.equal(await bound.readHead('chain-s2'), 'hash-s2');

  const recovered = await bound.commitStaged({ seal, fence: FENCE });
  assert.equal(
    recovered.commitId,
    receipt.commitId,
    'K2b-RED staged: commit before response recovers the same receipt',
  );

  const guarded = await bound.beginStaged({
    operationKey: 'op-staged-base',
    inputDigest: 'input-base',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: guarded,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-base-0',
    effects: {
      ...emptyUnit(),
      guards: [{ kind: 'head', chainId: 'chain-s1', hash: 'hash-s1' }],
      appends: appendUnit('chain-base', 'b1', 'hash-b1', null).appends,
    },
    fence: FENCE,
  });
  const guardedSeal = await bound.sealStaged({
    unit: guarded,
    root: sealRoot('op-staged-base', 'digest-base-0', '1'),
  });
  await bound.appendChain('chain-s1', { id: 's1-rival', bytes: '{}', hash: 'hash-s1-rival' }, { kind: 'head', hash: 'hash-s1' });
  await expectCode(
    async () => bound.commitStaged({ seal: guardedSeal, fence: FENCE }),
    'cas-conflict',
    'K2b-RED staged: a changed base produces a conflict without publication',
  );
  assert.equal(await bound.readHead('chain-base'), null);

  const aborted = await bound.beginStaged({
    operationKey: 'op-staged-abort',
    inputDigest: 'input-abort',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: aborted,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-abort-0',
    effects: appendUnit('chain-abandoned', 'x1', 'hash-x1', null),
    fence: FENCE,
  });
  await bound.abortStaged({ unit: aborted });
  assert.deepEqual(await bound.inspectStaged('op-staged-abort'), { state: 'aborted', reason: 'aborted by caller' });
  assert.equal(await bound.readHead('chain-abandoned'), null);
  await expectCode(
    async () => bound.sealStaged({ unit: aborted, root: sealRoot('op-staged-abort', 'digest-abort-0', '1') }),
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
  await expectCode(
    async () =>
      bound.stageFragment({
        unit: grouped,
        ordinal: '0',
        predecessorHash: null,
        fragmentDigest: 'digest-group-oversized',
        effects: {
          ...emptyUnit(),
          appends: [
            ...appendUnit('chain-lg-0', 'lg0', 'hash-lg-0', null).appends,
            ...appendUnit('chain-lg-1', 'lg1', 'hash-lg-1', null).appends,
            ...appendUnit('chain-lg-2', 'lg2', 'hash-lg-2', null).appends,
          ],
        },
        fence: FENCE,
        limits,
      }),
    'invalid-command',
    'K2b-RED staged: a fragment over atomic limits cannot stage',
  );
  let predecessor: string | null = null;
  for (let n = 0; n < 12; n += 1) {
    const digest = `digest-group-${n}`;
    await bound.stageFragment({
      unit: grouped,
      ordinal: String(n),
      predecessorHash: predecessor,
      fragmentDigest: digest,
      effects: appendUnit(`chain-lg-${n}`, `lg${n}`, `hash-lg-${n}`, null),
      fence: FENCE,
      limits,
    });
    predecessor = digest;
  }
  const groupedSeal = await bound.sealStaged({
    unit: grouped,
    root: sealRoot('op-staged-group', 'digest-group-11', '12'),
  });
  await bound.commitStaged({ seal: groupedSeal, fence: FENCE });
  for (let n = 0; n < 12; n += 1) {
    assert.equal(await bound.readHead(`chain-lg-${n}`), `hash-lg-${n}`);
  }

  const doomed = await bound.beginStaged({
    operationKey: 'op-staged-auth',
    inputDigest: 'input-auth',
    contractDigest: 'contract-k2b',
    sourceBoundary: 'boundary-k2b',
    fence: FENCE,
  });
  await bound.stageFragment({
    unit: doomed,
    ordinal: '0',
    predecessorHash: null,
    fragmentDigest: 'digest-auth-0',
    effects: appendUnit('chain-auth', 'a1', 'hash-a1', null),
    fence: FENCE,
  });
  const doomedSeal = await bound.sealStaged({
    unit: doomed,
    root: sealRoot('op-staged-auth', 'digest-auth-0', '1'),
  });
  await hooks.breakAuthority();
  await expectCode(
    async () => bound.commitStaged({ seal: doomedSeal, fence: FENCE }),
    'denied',
    'K2b-RED staged: changed authority denies publication',
  );
};
