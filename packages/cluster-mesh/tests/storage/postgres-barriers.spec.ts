import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedFragmentDigest } from '../../src/storage/staged-codec.js';
describe.skipIf(!pgEnabled)('Postgres dependent barriers and actual purge', () => {
  it('denies full and paged reads while physical erasure is still pending', async () => {
    const fixture = await createPgFixture({ limits: { maxRecords: 1, maxAppends: 1, maxEncodedBytes: 524288 } });
    try {
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await (await fixture.open()).bindNew(grant);
      await bound.configureLifecycle('optional');
      for (let n = 0; n < 3; n += 1) await bound.appendChain('partial', { id: `r${n}`, hash: `h${n}`, bytes: `private${n}` }, n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `h${n - 1}` });
      await bound.commitAtomic({ ...emptyEffects(), purgeIntents: [{ target: 'partial', intentId: 'partial', authorizedBy: grant.principalId }] });
      expect(await bound.completePurge('partial')).toMatchObject({ state: 'pending', outcomeId: null });
      await expect(bound.readHead('partial')).rejects.toMatchObject({ code: 'denied' });
      expect(await bound.readPage('partial', 1, null, 4096)).toMatchObject({ outcome: 'inaccessible', records: [] });
    } finally { await fixture.close(); }
  });
  it('hides children immediately, respects holds and erases bytes before one terminal outcome', async () => {
    const fixture = await createPgFixture();
    try {
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await (await fixture.open()).bindNew(grant);
      await bound.appendChain('child', { id: 'r', hash: 'h', bytes: 'private content' }, { kind: 'absent', allocation: '0' });
      await bound.declareCoverage('parent', 'child'); await bound.configureLifecycle('required');
      await expect(bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'parent', reason: 'removed' }] })).rejects.toMatchObject({ code: 'invalid-command' });
      await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'parent', reason: 'removed' }], purgeIntents: [{ target: 'parent', intentId: 'purge', authorizedBy: grant.principalId }] });
      await expect(bound.readHead('child')).rejects.toMatchObject({ code: 'denied' });
      expect(await bound.readPage('child', 1, null, 4096)).toMatchObject({ outcome: 'inaccessible', records: [], nextCursor: null });
      await bound.holdTarget('child', 'legal hold');
      expect(await bound.completePurge('purge')).toMatchObject({ state: 'held', payloadDisposition: null });
      await bound.holdTarget('child', null);
      let result = await bound.completePurge('purge');
      for (let n = 0; result.state !== 'complete' && n < 10; n += 1) result = await bound.completePurge('purge');
      expect(result).toMatchObject({ state: 'complete', payloadDisposition: 'erased' });
      expect(await bound.completePurge('purge')).toEqual(result);
      const root = await fixture.open(); const fence = { fenceId: 'late', epoch: '1' }; await root.provisionFence(grant, fence);
      const begin = { operationKey: 'late', inputDigest: 'late', contractDigest: 'contract', sourceBoundary: 'source', fence };
      const unit = await bound.beginStaged(begin);
      const effects = { ...emptyEffects(), appends: [{ chainId: 'child', record: { id: 'late', hash: 'late', bytes: 'reintroduced' }, expectation: { kind: 'head' as const, hash: 'h' } }] };
      const fragmentDigest = stagedFragmentDigest({ ...begin, moduleId: 'comments', scope: grant.scope, operationId: 'late', ordinal: '0', predecessorHash: null }, effects);
      await expect(bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest, effects, fence })).rejects.toMatchObject({ code: 'invalid-command' });
      await fixture.tx.run(true, async (session) => {
        const rows = await session.execute({ text: `SELECT bytes,erased FROM "${fixture.name}".payloads WHERE target=$1`, values: ['child'] });
        expect(rows.rows).toEqual([{ bytes: null, erased: true }]);
      });
    } finally { await fixture.close(); }
  });
});
