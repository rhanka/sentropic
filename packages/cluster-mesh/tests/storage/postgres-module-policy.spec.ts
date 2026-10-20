import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { StorageDeniedError } from '../../src/storage/errors.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('installed staged module authority', () => {
  it('rechecks domain authorization before intake, publication and committed receipt recovery', async () => {
    let allowed = true;
    const fixture = await createPgFixture({ stagedModules: { 'contract-k2b': { authorize: async () => { if (!allowed) throw new StorageDeniedError('module authority denied'); }, policy: async () => undefined } } });
    try {
      const root = await fixture.open(); const grant = grantFor(); const bound = await root.bindNew(grant);
      const fence = { fenceId: 'module', epoch: '1' }; await root.provisionFence(grant, fence);
      const unit = await bound.beginStaged({ operationKey: 'module', inputDigest: 'i', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
      const effects = { ...emptyEffects(), records: [{ key: 'record', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'content' } }] };
      const fragment = { unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence };
      allowed = false; await expect(bound.stageFragment(fragment)).rejects.toMatchObject({ code: 'denied' });
      allowed = true; await bound.stageFragment(fragment); let seal;
      do { seal = (await bound.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence, limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 } })).seal; } while (!seal);
      allowed = false; await expect(bound.commitStaged({ seal, fence })).rejects.toMatchObject({ code: 'denied' }); expect(await bound.readRecord('record')).toBeNull();
      allowed = true; const receipt = await bound.commitStaged({ seal, fence }); expect(receipt.effectiveRecords).toBe(1);
      allowed = false; await expect(bound.commitStaged({ seal, fence })).rejects.toMatchObject({ code: 'denied' });
    } finally { await fixture.close(); }
  });
});
