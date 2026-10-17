import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
describe.skipIf(!pgEnabled)('Postgres dependent barriers and actual purge', () => {
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
      await fixture.tx.run(true, async (session) => {
        const rows = await session.execute({ text: `SELECT bytes,erased FROM "${fixture.name}".payloads WHERE target=$1`, values: ['child'] });
        expect(rows.rows).toEqual([{ bytes: null, erased: true }]);
      });
    } finally { await fixture.close(); }
  });
});
