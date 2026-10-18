// K4 gate: shared visibility-root discipline on the neutral K4 runtime
// (L3a v4.1 frozen §7.5, §17.1 K4). Test-first RED: imports the K4 staged
// runtime and visibility root before they exist.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
import { createStagedTestKernel as createStagedKernel } from './staged-client.js';
import { stagedRootFixture } from './staged-root-fixture.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import { expectCode } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';

let tokenSeq = 0;
const stagedGrant = () =>
  grantFor({ token: `token-k4v-${(tokenSeq += 1)}`, operations: ['read', 'write', 'maintain'] });

const bindStaged = () => {
  const kernel = createStagedKernel({ moduleId: 'comments' });
  const bound = kernel.bindNew(stagedGrant());
  return { kernel, bound };
};

const FENCE: WriterFence = { fenceId: 'fence-k4v', epoch: '1' };

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

const appendUnit = (chainId: string, id: string, hash: string): AtomicUnit => ({
  ...emptyUnit(),
  appends: [
    {
      chainId,
      record: { id, bytes: `{"id":"${id}"}`, hash },
      expectation: { kind: 'absent', allocation: '0' },
    },
  ],
});

describe('K4 visibility root: versions and base conflicts', () => {
  it('K4-RED a fresh root starts at version zero', () => {
    const fixture = stagedRootFixture();
    const root = fixture.coordinator.capture(fixture.bound.scope);
    assert.equal(root.version, '0');
  });

  it('K4-RED every publication bumps the scope root version', async () => {
    const { bound } = bindStaged();
    await bound.commitAtomic(appendUnit('vis-a', 'a1', 'hash-vis-a1'));
    const first = await bound.journalRead('c-vis', 0, 10);
    assert.equal(first.events[0].rootVersion, '1');
    await bound.appendChain('vis-b', { id: 'b1', bytes: '{}', hash: 'hash-vis-b1' }, { kind: 'absent', allocation: '0' });
    await bound.commitAtomic(appendUnit('vis-c', 'c1', 'hash-vis-c1'));
    const second = await bound.journalRead('c-vis', 0, 10);
    assert.equal(second.events[second.events.length - 1].rootVersion, '3');
    assert.equal(await bound.readHead('vis-a'), 'hash-vis-a1');
  });

  it('K4-RED a changed base conflicts without publication', async () => {
    const { bound } = bindStaged();
    await bound.commitAtomic(appendUnit('vis-base', 'v1', 'hash-vis-base-1'));
    const unit = await bound.beginStaged({
      operationKey: 'op-vis-base',
      inputDigest: 'input-vis',
      contractDigest: 'contract-k4v',
      sourceBoundary: 'boundary-k4v',
      fence: FENCE,
    });
    const effects: AtomicUnit = {
        ...emptyUnit(),
        guards: [{ kind: 'head', chainId: 'vis-base', hash: 'hash-vis-base-1' }],
        appends: appendUnit('vis-guarded', 'g1', 'hash-vis-g1').appends,
      };
    const digest = stagedDigestOf(unit, '0', null, effects, 'contract-k4v', 'boundary-k4v');
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: digest, effects, fence: FENCE });
    const seal = await bound.sealStaged({
      unit,
      root: stagedSealRoot(unit, [effects], 'contract-k4v', 'boundary-k4v'),
    });
    await bound.appendChain(
      'vis-base',
      { id: 'v2', bytes: '{}', hash: 'hash-vis-base-2' },
      { kind: 'head', hash: 'hash-vis-base-1' },
    );
    await expectCode(
      async () => bound.commitStaged({ seal, fence: FENCE }),
      'cas-conflict',
      'K4-RED visibility: a changed base produces a conflict without publication',
    );
    assert.equal(await bound.readHead('vis-guarded'), null);
  });

  it('K4-RED a fresh seal after a rival commit publishes', async () => {
    const { bound } = bindStaged();
    await bound.commitAtomic(appendUnit('vis-rebase', 'v1', 'hash-vis-rebase-1'));
    await bound.appendChain(
      'vis-rebase',
      { id: 'v2', bytes: '{}', hash: 'hash-vis-rebase-2' },
      { kind: 'head', hash: 'hash-vis-rebase-1' },
    );
    const unit = await bound.beginStaged({
      operationKey: 'op-vis-rebase',
      inputDigest: 'input-rebase',
      contractDigest: 'contract-k4v',
      sourceBoundary: 'boundary-k4v',
      fence: FENCE,
    });
    const effects: AtomicUnit = {
        ...emptyUnit(),
        guards: [{ kind: 'head', chainId: 'vis-rebase', hash: 'hash-vis-rebase-2' }],
        appends: appendUnit('vis-rebased', 'r1', 'hash-vis-r1').appends,
      };
    const digest = stagedDigestOf(unit, '0', null, effects, 'contract-k4v', 'boundary-k4v');
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: digest, effects, fence: FENCE });
    const seal = await bound.sealStaged({
      unit,
      root: stagedSealRoot(unit, [effects], 'contract-k4v', 'boundary-k4v'),
    });
    await bound.commitStaged({ seal, fence: FENCE });
    assert.equal(await bound.readHead('vis-rebased'), 'hash-vis-r1');
  });
});

describe('K4 visibility root: denial without cursor leaks', () => {
  it('K4-RED covered reads deny while absence stays distinct', async () => {
    const { bound } = bindStaged();
    await bound.appendChain('vis-open', { id: 'o1', bytes: '{}', hash: 'hash-vis-open-1' }, { kind: 'absent', allocation: '0' });
    await bound.commitAtomic({
      ...appendUnit('vis-tomb', 't1', 'hash-vis-t1'),
      barriers: [{ boundary: 'vis-parent', reason: 'tombstone-vis' }],
    });
    await bound.declareCoverage('vis-parent', 'vis-open');
    await expectCode(
      async () => bound.readHead('vis-open'),
      'denied',
      'K4-RED visibility: a covered head throws denied',
    );
    const page = await bound.readPage('vis-open', 10, null, 4096);
    assert.equal(page.outcome, 'inaccessible');
    assert.equal(page.records.length, 0);
    assert.equal(page.nextCursor, null);
    assert.equal(await bound.readHead('never-existed'), null);
    const absent = await bound.readPage('never-existed', 10, null, 4096);
    assert.equal(absent.outcome, 'page');
    assert.equal(absent.records.length, 0);
  });

  it('K4-RED a retained cursor cannot bypass a later barrier', async () => {
    const { bound } = bindStaged();
    await bound.appendChain('vis-retained', { id: 'r1', bytes: '{}', hash: 'hash-vis-retained-1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain(
      'vis-retained',
      { id: 'r2', bytes: '{}', hash: 'hash-vis-retained-2' },
      { kind: 'head', hash: 'hash-vis-retained-1' },
    );
    const before = await bound.readPage('vis-retained', 1, null, 4096);
    assert.equal(before.outcome, 'page');
    assert.notEqual(before.nextCursor, null);
    await bound.commitAtomic({
      ...appendUnit('vis-tomb-2', 't2', 'hash-vis-t2'),
      barriers: [{ boundary: 'vis-parent-2', reason: 'tombstone-vis-2' }],
    });
    await bound.declareCoverage('vis-parent-2', 'vis-retained');
    const after = await bound.readPage('vis-retained', 1, before.nextCursor, 4096);
    assert.equal(after.outcome, 'inaccessible');
    assert.equal(after.records.length, 0);
    assert.equal(after.nextCursor, null);
  });

  it('K4-RED disposed content without coverage stays denied', async () => {
    const { bound } = bindStaged();
    await bound.appendChain('vis-doomed', { id: 'd1', bytes: '{}', hash: 'hash-vis-doomed-1' }, { kind: 'absent', allocation: '0' });
    await bound.disposeChain('vis-doomed');
    await expectCode(
      async () => bound.readHead('vis-doomed'),
      'denied',
      'K4-RED visibility: disposed content without coverage throws denied',
    );
    await expectCode(
      async () => bound.readChain('vis-doomed'),
      'denied',
      'K4-RED visibility: a disposed chain without coverage throws denied',
    );
    const page = await bound.readPage('vis-doomed', 10, null, 4096);
    assert.equal(page.outcome, 'inaccessible');
    assert.equal(page.nextCursor, null);
  });
});
