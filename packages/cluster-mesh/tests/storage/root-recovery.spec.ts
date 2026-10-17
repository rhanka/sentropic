import { describe, expect, it } from 'vitest';
import { createStagedKernel, MemoryBackend } from '../../src/storage/index.js';
import { createIndexedBackendScopeState } from '../../src/storage/backend.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { grantFor } from './authority-corpus.js';
import { FENCE, sealPublic, stagePublic } from './root-protocol-fixture.js';
import { stagedDigestOf } from './staged-corpus.js';

const effects = { ...emptyEffects(), records: [{ key: 'payload', contentHash: 'hash', bytes: { format: 'utf8' as const, data: 'value' } }] };
const grant = () => grantFor({ operations: ['read', 'write', 'maintain'] });
describe('backend-held staged recovery', () => {
  it('should recover fragment and commit receipts after response loss and runtime recreation', async () => {
    const backend = new MemoryBackend(createIndexedBackendScopeState);
    const root = createStagedKernel({ moduleId: 'comments', backend });
    const bound = root.bindNew(grant());
    root.provisionFence(bound.scope, bound.grant.principalId, FENCE);
    const unit = await bound.beginStaged({ operationKey: 'response-loss', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence: FENCE });
    const fragment = { unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence: FENCE };
    root.armFailure(bound.scope, 'stage-response');
    await expect(bound.stageFragment(fragment)).rejects.toMatchObject({ code: 'invalid-command' });
    const accepted = await bound.stageFragment(fragment);
    expect(accepted.ordinal).toBe('0');
    const { stagedSealRoot } = await import('./staged-corpus.js');
    const seal = await sealPublic(bound, { unit, root: stagedSealRoot(unit, [effects]), fence: FENCE });
    root.armFailure(bound.scope, 'commit-response');
    await expect(bound.commitStaged({ seal, fence: FENCE })).rejects.toMatchObject({ code: 'invalid-command' });
    const recreated = createStagedKernel({ moduleId: 'comments', backend }).bindNew(grant());
    const receipt = await recreated.commitStaged({ seal, fence: FENCE });
    expect(await recreated.commitStaged({ seal, fence: FENCE })).toEqual(receipt);
    expect((await recreated.journalRead('recovered', 0, 100)).events).toHaveLength(1);
  });
  it('should record explicit ownership recovery and invalidate old handles and seals', async () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const original = root.bindNew(grant());
    const nextGrant = grantFor({ token: 'new-owner', principalId: 'user-2', operations: ['read', 'write', 'maintain'] });
    const next = root.bindNew(nextGrant);
    const staged = await stagePublic(root, original, 'transfer', effects);
    const seal = await sealPublic(original, staged);
    const fence = { ...FENCE, epoch: '2' };
    root.rotateFence(original.scope, fence, 'user-2');
    const recovered = root.recoverOperation(original.grant, { operationKey: 'transfer', expectedOwnerId: 'user-1', expectedUnitId: staged.unit.unitId,
      newOwner: nextGrant, fence, reason: 'operator reassignment' });
    expect(recovered.unit.operationKey).toBe('transfer');
    await expect(original.abortStaged({ unit: staged.unit, fence: FENCE, reason: 'stale owner' })).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(next.commitStaged({ seal, fence })).rejects.toMatchObject({ code: 'invalid-command' });
    const receipt = await next.commitStaged({ seal: recovered.seal!, fence });
    expect(receipt.effectiveRecords).toBe(1);
    expect(root.recoveryEvidence(original.grant, 'transfer')).toMatchObject([{ from: 'user-1', to: 'user-2', reason: 'operator reassignment' }]);
  });
});
