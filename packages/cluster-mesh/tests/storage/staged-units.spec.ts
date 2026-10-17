// K4 gate: staged units, journal, barriers and lifecycle against the neutral
// K4 runtime (L3a v4.1 frozen §7, §10, §13, §17.1 K4). Test-first RED: imports
// the K4 staged runtime before it exists. G5: a tombstoned import writes its
// barrier in the same published unit.

import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { createStagedTestKernel as createStagedKernel } from './staged-client.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import { runAtomicCorpus, expectCode } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';
import { stagedDigestOf, stagedSealRoot, runStagedCorpus } from './staged-corpus.js';
import { runReplayCorpus } from './replay-corpus.js';
import { runBarrierCorpus } from './barrier-corpus.js';
import { runLifecycleCorpus } from './lifecycle-corpus.js';

let tokenSeq = 0;
const stagedGrant = () =>
  grantFor({ token: `token-k4-${(tokenSeq += 1)}`, operations: ['read', 'write', 'maintain'] });

const bindStaged = () => {
  const kernel = createStagedKernel({ moduleId: 'comments' });
  const bound = kernel.bindNew(stagedGrant());
  return { kernel, bound };
};

const FENCE: WriterFence = { fenceId: 'fence-k4', epoch: '1' };

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

describe('K4 runtime: shared K2b corpora', () => {
  it('K4-RED staged corpus holds on the K4 runtime', async () => {
    const { kernel, bound } = bindStaged();
    const grant = bound.grant;
    await runStagedCorpus(bound, {
      breakAuthority: async () => {
        kernel.revoke(grant.token);
      },
    });
  });

  it('K4-RED replay corpus holds on the K4 runtime', async () => {
    const kernel = createStagedKernel({ moduleId: 'comments' });
    const primary = kernel.bindNew(stagedGrant());
    const foreign = kernel.bindNew(
      grantFor({
        token: `token-k4-foreign-${(tokenSeq += 1)}`,
        operations: ['read', 'write', 'maintain'],
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
      }),
    );
    await runReplayCorpus(primary, foreign, {
      rebind: async () => kernel.bindNew(stagedGrant()),
      bindWithoutMaintain: async () => kernel.bindNew(grantFor({ token: 'weak-replay', operations: ['read', 'write'] })),
    });
  });

  it('K4-RED barrier corpus holds on the K4 runtime', async () => {
    const { bound } = bindStaged();
    await runBarrierCorpus(bound);
  });

  it('K4-RED lifecycle corpus holds on the K4 runtime', async () => {
    const kernel = createStagedKernel({ moduleId: 'comments' });
    const primary = kernel.bindNew(stagedGrant());
    await runLifecycleCorpus(primary, {
      rebind: async () => kernel.bindNew(stagedGrant()),
      bindWithoutMaintain: async () => kernel.bindNew(grantFor({ token: 'weak-purge', operations: ['read', 'write'] })),
    });
  });

  it('K4-RED atomic corpus holds with barrier, purge and relationship positives', async () => {
    const { bound } = bindStaged();
    await runAtomicCorpus(bound, {
      visibilityBarriers: true,
      purgeJobs: true,
      predicates: true,
      relationships: true,
    });
  });
});

describe('K4 runtime: G5 same-unit tombstone and barrier publication', () => {
  it('K4-RED an imported tombstoned payload and its barrier publish in one unit', async () => {
    const { bound } = bindStaged();
    await bound.declareCoverage('imported-1', 'rec-imported');
    const unit = await bound.beginStaged({
      operationKey: 'op-g5-import',
      inputDigest: 'input-g5',
      contractDigest: 'contract-g5',
      sourceBoundary: 'boundary-g5',
      fence: FENCE,
    });
    const effects: AtomicUnit = {
        ...emptyUnit(),
        appends: [
          {
            chainId: 'lifecycle-g5',
            record: { id: 'tombstone-g5', bytes: '{"tombstone":"imported-1"}', hash: 'hash-g5' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
        records: [{ key: 'rec-imported', bytes: { format: 'utf8', data: 'payload' }, contentHash: 'h-g5' }],
        barriers: [{ boundary: 'imported-1', reason: 'tombstone-import-1' }],
      };
    const digest = stagedDigestOf(unit, '0', null, effects, 'contract-g5', 'boundary-g5');
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: digest, effects, fence: FENCE });
    const seal = await bound.sealStaged({
      unit,
      root: stagedSealRoot(unit, [effects], 'contract-g5', 'boundary-g5'),
    });
    assert.equal(await bound.readHead('lifecycle-g5'), null);
    const receipt = await bound.commitStaged({ seal, fence: FENCE });
    assert.equal((await bound.readChain('lifecycle-g5')).length, 1);
    await expectCode(
      async () => bound.readRecord('rec-imported'),
      'denied',
      'K4-RED G5: the imported payload is denied by its barrier in the same unit',
    );
    const journal = await bound.journalRead('c-g5', 0, 10);
    const segment = journal.events.find((event) => event.operationKey === 'op-g5-import');
    assert.ok(segment);
    assert.equal(segment.commitId, receipt.commitId);
  });
});

describe('K4 runtime: bounded seal validation steps', () => {
  it('K4-RED a small unit seals in one step', async () => {
    const { bound } = bindStaged();
    const unit = await bound.beginStaged({
      operationKey: 'op-sealstep-small',
      inputDigest: 'input-small',
      contractDigest: 'contract-g5',
      sourceBoundary: 'boundary-g5',
      fence: FENCE,
    });
    const effects: AtomicUnit = {
        ...emptyUnit(),
        appends: [
          {
            chainId: 'chain-small',
            record: { id: 's1', bytes: '{}', hash: 'hash-small-1' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
      };
    const digest = stagedDigestOf(unit, '0', null, effects, 'contract-g5', 'boundary-g5');
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: digest, effects, fence: FENCE });
    const outcome = await bound.sealStep({
      unit,
      root: stagedSealRoot(unit, [effects], 'contract-g5', 'boundary-g5'),
      limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 },
      fence: FENCE,
    });
    assert.equal(outcome.state, 'sealed');
    if (outcome.state === 'sealed') {
      const receipt = await bound.commitStaged({ seal: outcome.seal, fence: FENCE });
      expect(receipt.commitId.length).toBeGreaterThan(0);
    }
  });

  it('K4-RED a large unit reports validating progress before sealing', async () => {
    const { bound } = bindStaged();
    const unit = await bound.beginStaged({
      operationKey: 'op-sealstep-large',
      inputDigest: 'input-large',
      contractDigest: 'contract-g5',
      sourceBoundary: 'boundary-g5',
      fence: FENCE,
    });
    const stagedEffects: AtomicUnit[] = [];
    let predecessor: string | null = null;
    for (let n = 0; n < 12; n += 1) {
      const effects: AtomicUnit = {
          ...emptyUnit(),
          appends: [
            {
              chainId: `chain-large-${n}`,
              record: { id: `l${n}`, bytes: '{}', hash: `hash-large-${n}` },
              expectation: { kind: 'absent', allocation: '0' },
            },
          ],
        };
      stagedEffects.push(effects);
      const digest = stagedDigestOf(unit, String(n), predecessor, effects, 'contract-g5', 'boundary-g5');
      await bound.stageFragment({ unit, ordinal: String(n), predecessorHash: predecessor, fragmentDigest: digest, effects, fence: FENCE });
      predecessor = digest;
    }
    const root = stagedSealRoot(unit, stagedEffects, 'contract-g5', 'boundary-g5');
    const limits = { maxRecords: 8, maxAppends: 8, maxEncodedBytes: 524288 };
    const first = await bound.sealStep({ unit, root, limits, fence: FENCE });
    assert.equal(first.state, 'validating');
    if (first.state === 'validating') {
      assert.ok(Number(first.progress.checked) < Number(first.progress.total));
    }
    assert.deepEqual(await bound.inspectStaged('op-sealstep-large'), {
      state: 'sealing',
      acceptedFragments: '12',
    });
    let outcome = first;
    while (outcome.state === 'validating') {
      outcome = await bound.sealStep({ unit, root, limits, fence: FENCE });
    }
    assert.equal(outcome.state, 'sealed');
    if (outcome.state === 'sealed') {
      await bound.commitStaged({ seal: outcome.seal, fence: FENCE });
      assert.equal(await bound.readHead('chain-large-0'), 'hash-large-0');
      assert.equal(await bound.readHead('chain-large-11'), 'hash-large-11');
    }
  });
});
