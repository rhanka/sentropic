import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { RootMutationCoordinator } from '../../src/storage/mutation-coordinator.js';
import { ProjectionRuntime } from '../../src/storage/projection-runtime.js';
import { forkStagedRootData, lockStagedRootData, type StagedRootData } from '../../src/storage/staged-state.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { grantFor } from './authority-corpus.js';
import { expectCode } from './atomic-corpus.js';
import { FENCE, sealPublic, stagePublic } from './root-protocol-fixture.js';

const setup = () => {
  const root = createStagedKernel({ moduleId: 'comments', descriptor: {
    contractVersion: '1', contractDigest: 'd', schemaVersions: ['1'], requiredProfiles: [], optionalProfiles: [], chainKinds: ['r'],
    queryNames: ['links'], boundaries: ['p'], pageLimits: { maxRecords: 128, maxEncodedBytes: 524288 },
  }, queries: { links: (_input, context) => context.view.relationships('r', 'p', Number(context.cursor ?? 0), context.limit) } });
  return { root, bound: root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] })) };
};
const record = { key: 'payload', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'payload' } };
const barrierProbe = async () => {
  const { root, bound } = setup();
  const staged = await stagePublic(root, bound, 'barrier', { ...emptyEffects(), records: [record], barriers: [{ boundary: 'payload', reason: 'hidden' }] });
  const seal = await sealPublic(bound, staged);
  await bound.commitStaged({ seal, fence: FENCE });
  await expectCode(() => bound.readRecord('payload'), 'denied', 'C06: content and covering barrier share publication');
};
const projectionProbe = async () => {
  const { bound } = setup();
  await bound.commitAtomic({ ...emptyEffects(), relationships: [{ kind: 'add', relation: 'r', from: 'p', to: 'a' }] });
  assert.deepEqual((await bound.query('links', null, { limit: 2, maxEncodedBytes: 4096 })).records, ['a']);
  await expectCode(() => bound.commitAtomic({ ...emptyEffects(), records: [record], relationships: [0, 1].map(() => ({ kind: 'remove', relation: 'r', from: 'p', to: 'a' })) }),
    'invalid-command', 'C06: the second removal invalidates the whole prepared projection');
  assert.equal(await bound.readRecord('payload'), null);
  assert.deepEqual((await bound.query('links', null, { limit: 2, maxEncodedBytes: 4096 })).records, ['a']);
};
const baseProbe = async () => {
  const { root, bound } = setup();
  await bound.indexPut('rival', { digest: 'd', resultIds: ['old'], resultHash: null });
  const staged = await stagePublic(root, bound, 'base', { ...emptyEffects(), records: [record] });
  const seal = await sealPublic(bound, staged);
  await bound.indexPut('rival', { digest: 'd', resultIds: ['winner'], resultHash: null });
  await expectCode(() => bound.commitStaged({ seal, fence: FENCE }), 'cas-conflict', 'C08: a sealed root rejects the actual rival index replacement');
  assert.deepEqual((await bound.indexGet('rival'))?.resultIds, ['winner']);
  assert.equal(await bound.readRecord('payload'), null);
};
describe('K4 publication mutation qualification', () => {
  it('should qualify all three independent publication assertions', async () => { await barrierProbe(); await projectionProbe(); await baseProbe(); });
  it('should kill omission of barriers from the published successor', async () => {
    const publish = RootMutationCoordinator.prototype.publish;
    const mutant = vi.spyOn(RootMutationCoordinator.prototype, 'publish').mockImplementation(function (scope, base, prepared, verify) {
      const data = forkStagedRootData(prepared.attachment as StagedRootData);
      data.barriers.clear(); Object.assign(prepared, { attachment: lockStagedRootData(data) });
      publish.call(this, scope, base, prepared, verify);
    });
    try { await assert.rejects(barrierProbe, /C06: content and covering barrier share publication/); } finally { mutant.mockRestore(); }
  });
  it('should kill projection validation against a stale relationship view', async () => {
    const apply = ProjectionRuntime.prototype.applyRelationships;
    const mutant = vi.spyOn(ProjectionRuntime.prototype, 'applyRelationships').mockImplementation(function (changes) {
      for (const change of changes) {
        if (change.kind === 'remove' && !this.hasRelationship(change.relation, change.from, change.to)) continue;
        apply.call(this, [change]);
      }
    });
    try { await assert.rejects(projectionProbe, /C06: the second removal invalidates the whole prepared projection/); } finally { mutant.mockRestore(); }
  });
  it('should kill skipped staged-base CAS while retaining the rival index results', async () => {
    const publish = RootMutationCoordinator.prototype.publish;
    const mutant = vi.spyOn(RootMutationCoordinator.prototype, 'publish').mockImplementation(function (scope, base, prepared, verify) {
      const data = prepared.attachment as StagedRootData;
      const before = base.attachment as StagedRootData | undefined;
      if (data.unitRoots.size > (before?.unitRoots.size ?? 0)) {
        const current = this.backend.scopeState(scope);
        prepared.index = current.index;
        publish.call(this, scope, current, prepared, verify);
      } else publish.call(this, scope, base, prepared, verify);
    });
    try { await assert.rejects(baseProbe, /C08: a sealed root rejects the actual rival index replacement/); } finally { mutant.mockRestore(); }
  });
});
