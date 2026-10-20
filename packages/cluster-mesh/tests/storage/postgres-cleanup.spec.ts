import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('bounded terminal Postgres preparation cleanup', () => {
  it('erases aborted hidden payloads across restarts while retaining terminal identity and published data', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const bound = await root.bindNew(grant); const fence = { fenceId: 'cleanup', epoch: '1' };
      await root.provisionFence(grant, fence);
      const record = (key: string) => ({ key, contentHash: key, bytes: { format: 'utf8' as const, data: 'private-content' } });
      await bound.commitAtomic({ ...emptyEffects(), records: [record('published')] });
      const begin = { operationKey: 'aborted', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence };
      const unit = await bound.beginStaged(begin); const effects = { ...emptyEffects(), records: Array.from({ length: 4 }, (_, i) => record(`hidden-${i}`)) };
      await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
      const limits = { maxRecords: 1, maxAppends: 1, maxEncodedBytes: 4096 };
      await bound.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence, limits });
      const cleanup = { operationKey: 'aborted', limits, fence };
      await expect(bound.cleanupStaged(cleanup)).rejects.toMatchObject({ code: 'invalid-command' });
      await bound.abortStaged({ unit, fence, reason: 'cancelled' });
      let complete = false; let steps = 0;
      while (!complete && steps++ < 16) {
        const next = await (await (await fixture.open()).bind(grant)).cleanupStaged(cleanup);
        expect(next.work.items).toBeLessThanOrEqual(1); expect(next.work.bytes).toBeLessThanOrEqual(4096); complete = next.complete;
      }
      expect(complete, 'cleanup must finish without replaying the hidden unit').toBe(true);
      await fixture.tx.run(true, async (session) => {
        expect((await session.execute({ text: `SELECT 1 FROM "${fixture.name}".staged_items WHERE unit_id=$1`, values: [unit.unitId] })).rows).toHaveLength(0);
        expect((await session.execute({ text: `SELECT 1 FROM "${fixture.name}".payloads WHERE prepared_unit=$1`, values: [unit.unitId] })).rows).toHaveLength(0);
      });
      expect((await bound.readRecord('published'))?.bytes.data).toBe('private-content');
      expect(await bound.readRecord('hidden-0')).toBeNull();
      expect(await bound.inspectStaged('aborted')).toEqual({ state: 'aborted', reason: 'cancelled' });
      expect((await bound.beginStaged(begin)).state).toBe('aborted');
    } finally { await fixture.close(); }
  });
});
