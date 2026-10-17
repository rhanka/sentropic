import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('durable Postgres authority and ownership recovery', () => {
  it('keeps unknown-token revocation terminal and uses database time for leases', async () => {
    const fixture = await createPgFixture({ now: () => '1999-01-01T00:00:00.000Z' });
    try {
      const root = await fixture.open(); await root.revoke('never-issued');
      await expect((await fixture.open()).bindNew(grantFor({ token: 'never-issued' }))).rejects.toMatchObject({ code: 'denied' });
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      const fence = { fenceId: 'expired', epoch: '1' }; await root.provisionFence(grant, fence, '2000-01-01T00:00:00Z');
      await expect(bound.beginStaged({ operationKey: 'expired', inputDigest: 'i', contractDigest: 'c', sourceBoundary: 's', fence })).rejects.toMatchObject({ code: 'invalid-command' });
    } finally { await fixture.close(); }
  });
  it('moves active ownership only by explicit maintain-authorized CAS and rotates capabilities', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const old = await root.bindNew(grant);
      const recipient = grantFor({ token: 'recipient', principalId: 'recipient', operations: ['read', 'write', 'maintain'] }); const next = await root.bindNew(recipient);
      const fence = { fenceId: 'owner', epoch: '1' }; await root.provisionFence(grant, fence);
      const begin = { operationKey: 'recover', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence };
      const unit = await old.beginStaged(begin);
      const effects = { ...emptyEffects(), records: [{ key: 'recovered', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'retained' } }] };
      await old.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
      const fresh = { ...fence, epoch: '2' }; await root.provisionFence(recipient, fresh);
      const recovered = await root.recoverStaged(grant, { operationKey: begin.operationKey, expectedOwner: grant.principalId, recipient, fence: fresh, reason: 'worker handoff' });
      expect(recovered.unit.capability).not.toBe(unit.capability);
      await expect(next.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence: fresh })).rejects.toMatchObject({ code: 'invalid-command' });
      let seal;
      do { seal = (await next.sealStep({ unit: recovered.unit, root: stagedSealRoot(unit, [effects]), fence: fresh, limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 } })).seal; } while (!seal);
      await next.commitStaged(seal, fresh);
      expect((await next.readRecord('recovered'))?.bytes.data).toBe('retained');
      await expect(root.recoverStaged(grant, { operationKey: begin.operationKey, expectedOwner: grant.principalId, recipient, fence: fresh, reason: 'repeat' })).rejects.toMatchObject({ code: 'cas-conflict' });
    } finally { await fixture.close(); }
  });
});
