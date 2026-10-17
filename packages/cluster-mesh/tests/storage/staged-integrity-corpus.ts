// Shared N2/C01/C03 probes: owned buffers, hidden audit, colliding ids and
// a fence that was valid at begin but is superseded before publication.
import assert from 'node:assert/strict';
import type { WriterFence } from '../../src/storage/contracts.js';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import { stagedDigestOf, stagedSealRoot, type StagedCorpusStore } from './staged-corpus.js';

export interface StagedIntegrityStore extends StagedCorpusStore {
  auditRead(): Awaitable<readonly unknown[]>;
}

const FENCE: WriterFence = { fenceId: 'fence-k2b', epoch: '1' };
const begin = (operationKey: string) => ({
  operationKey, inputDigest: operationKey, contractDigest: 'contract-k2b',
  sourceBoundary: 'boundary-k2b', fence: FENCE,
});
const effects = () => ({
  guards: [], records: [{ key: 'owned-record', contentHash: 'record-hash', bytes: { format: 'utf8' as const, data: 'accepted-record' } }],
  appends: [{ chainId: 'owned-chain', record: { id: 'owned', bytes: 'accepted-append', hash: 'owned-hash' }, expectation: { kind: 'absent' as const, allocation: '0' } }],
  updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [],
});

export const runStagedOwnershipCorpus = async (
  bound: StagedIntegrityStore, foreign: StagedIntegrityStore,
): Promise<void> => {
  const local = await bound.beginStaged(begin('owned-unit'));
  const remote = await foreign.beginStaged(begin('owned-unit'));
  const input = effects();
  // Force the foreign token to collide with an existing local identifier;
  // use the recipient's digest so digest validation cannot mask the probe.
  await expectCode(() => foreign.stageFragment({
    unit: { ...local, unitId: remote.unitId, ...('capability' in remote ? { capability: remote.capability } : {}) }, ordinal: '0', predecessorHash: null,
    fragmentDigest: stagedDigestOf(remote, '0', null, input), effects: input, fence: FENCE,
  }), 'invalid-command', 'C03: a colliding foreign handle cannot stage');
  assert.deepEqual(await foreign.inspectStaged('owned-unit'), { state: 'staging', acceptedFragments: '0' });
  assert.equal(await foreign.readHead('owned-chain'), null);
  const before = await bound.auditRead();
  const pristine = effects();
  await bound.stageFragment({
    unit: local, ordinal: '0', predecessorHash: null,
    fragmentDigest: stagedDigestOf(local, '0', null, input), effects: input, fence: FENCE,
  });
  assert.equal(await bound.readRecord('owned-record'), null);
  assert.deepEqual(await bound.auditRead(), before, 'C01: staged effects stay invisible to the audit reader');
  const seal = await bound.sealStaged({ unit: local, root: stagedSealRoot(local, [pristine]) });
  input.records[0].bytes.data = 'mutated-record';
  input.appends[0].record.bytes = 'mutated-append';
  await bound.commitStaged({ seal, fence: FENCE });
  assert.equal((await bound.readRecord('owned-record'))?.bytes.data, 'accepted-record', 'C01: nested record bytes are owned at acceptance');
  assert.equal((await bound.readChain('owned-chain'))[0].bytes, 'accepted-append', 'C01: nested append bytes are owned at acceptance');
  assert.equal((await bound.auditRead()).length, before.length + 1, 'C01: publication emits one audit outcome');
};

export const runStagedFenceRotationCorpus = async (
  bound: StagedIntegrityStore, rotate: (fence: WriterFence) => Awaitable<void>,
): Promise<void> => {
  const unit = await bound.beginStaged(begin('superseded-unit'));
  const input = effects();
  await bound.stageFragment({
    unit, ordinal: '0', predecessorHash: null,
    fragmentDigest: stagedDigestOf(unit, '0', null, input), effects: input, fence: FENCE,
  });
  const seal = await bound.sealStaged({ unit, root: stagedSealRoot(unit, [input]) });
  const pending = await bound.beginStaged(begin('superseded-pending'));
  const before = await bound.auditRead();
  await rotate({ fenceId: FENCE.fenceId, epoch: '2' });
  await expectCode(() => bound.commitStaged({ seal, fence: FENCE }), 'invalid-command', 'C03: a superseded fence cannot publish');
  await expectCode(() => bound.abortStaged({ unit }), 'invalid-command', 'C03: a superseded fence cannot abort');
  await expectCode(() => bound.stageFragment({
    unit: pending, ordinal: '0', predecessorHash: null,
    fragmentDigest: stagedDigestOf(pending, '0', null, input), effects: input, fence: FENCE,
  }), 'invalid-command', 'C03: a superseded fence cannot stage');
  assert.equal(await bound.readHead('owned-chain'), null);
  assert.equal(await bound.readRecord('owned-record'), null);
  assert.deepEqual(await bound.auditRead(), before, 'C03: stale operations leave no audit outcomes');
};
