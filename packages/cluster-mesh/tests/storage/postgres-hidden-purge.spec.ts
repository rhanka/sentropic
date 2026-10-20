import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('purge of unpublished dependent payloads', () => {
  it('erases staged and prepared bytes using hidden indexed coverage before reporting completion', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      await bound.configureLifecycle('optional'); await bound.appendChain('parent', { id: 'parent', hash: 'parent', bytes: 'parent payload' }, { kind: 'absent', allocation: '0' });
      const fence = { fenceId: 'hidden', epoch: '1' }; await root.provisionFence(grant, fence);
      const unit = await bound.beginStaged({ operationKey: 'hidden', inputDigest: 'i', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
      const effects = { ...emptyEffects(), records: [{ key: 'new-child', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'hidden-private-body' } }],
        relationships: [{ kind: 'add' as const, relation: 'coverage-parent-v1', from: 'parent', to: 'new-child' }] };
      await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
      await bound.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence, limits: { maxRecords: 1, maxAppends: 1, maxEncodedBytes: 4096 } });
      expect(await bound.readRecord('new-child')).toBeNull();
      await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'parent', reason: 'deleted' }], purgeIntents: [{ target: 'parent', intentId: 'purge', authorizedBy: grant.principalId }] });
      expect((await bound.completePurge('purge')).state).toBe('complete');
      await fixture.tx.run(true, async (session) => {
        expect((await session.execute({ text: `SELECT bytes FROM "${fixture.name}".staged_items WHERE target='new-child' AND bytes IS NOT NULL`, values: [] })).rows, 'hidden staged descendant bytes must be erased').toHaveLength(0);
        expect((await session.execute({ text: `SELECT bytes FROM "${fixture.name}".payloads WHERE target='new-child' AND bytes IS NOT NULL`, values: [] })).rows, 'hidden prepared descendant bytes must be erased').toHaveLength(0);
      });
    } finally { await fixture.close(); }
  });
});
