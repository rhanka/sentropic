import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('callable frozen Postgres capabilities', () => {
  it('executes advertised ports and refuses profiles without their implementation', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      expect(Object.isFrozen(bound.profiles)).toBe(true);
      for (const claim of bound.profiles) expect(claim.digest).not.toBe(createHash('sha256').update(claim.profile).digest('hex'));
      expect(() => bound.capability('generations-v1')).toThrow(); expect(() => bound.capability('scope-outbox-v1')).toThrow();
      const atomic = bound.capability('atomic-units-v1').port;
      expect(Object.isFrozen(atomic)).toBe(true);
      await atomic.commitAtomic({ ...emptyEffects(), records: [{ key: 'record', bytes: { format: 'utf8', data: 'value' }, contentHash: 'h' }] });
      await atomic.transact({}, async (tx) => { await tx.apply({ ...emptyEffects(), indexWrites: [{ key: 'index', digest: 'd', resultIds: [], resultHash: null }] }); });
      const chain = bound.capability('immutable-chains-v1').port;
      await chain.appendChain('chain', { id: 'r', hash: 'r', bytes: '{}' }, { kind: 'absent', allocation: '0' }); expect(await chain.readChain('chain')).toHaveLength(1);
      const boundary = bound.capability('immutable-boundaries-v1').port;
      const captured = await boundary.captureManifest({ selections: ['chain'] }); expect(await boundary.verifyManifest(captured.digest)).toEqual(captured.manifest);
      expect((await boundary.readPage('chain', 1, null, 4096)).records).toHaveLength(1); expect((await boundary.readManifestPage(captured.digest, 'chain', 1, null, 4096)).records).toHaveLength(1);
      const fenced = bound.capability('fenced-writers-v1').port; const fence = await fenced.journalFence();
      const staged = bound.capability('staged-units-v1').port;
      const begin = { operationKey: 'profile', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence };
      const unit = await staged.begin(begin); const effects = { ...emptyEffects(), records: [{ key: 'staged', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'staged' } }] };
      await staged.stage({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
      let seal;
      do { seal = (await staged.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence, limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 } })).seal; } while (!seal);
      const receipt = await fenced.commitStaged({ seal, fence }); expect(await staged.commit({ seal, fence })).toEqual(receipt); expect(await staged.inspect('profile')).toMatchObject({ state: 'committed' });
      const aborted = await staged.begin({ ...begin, operationKey: 'abort' }); await staged.abort({ unit: aborted, fence, reason: 'profile validation' });
      const visibility = bound.capability('visibility-barriers-v1').port;
      await visibility.declareCoverage('parent', 'chain'); expect(await visibility.readHead('chain')).toBe('r');
      const purge = bound.capability('purge-jobs-v1').port; await purge.configure('optional');
      await atomic.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'parent', reason: 'removed' }], purgeIntents: [{ target: 'parent', intentId: 'purge', authorizedBy: grant.principalId }] });
      await purge.hold('chain', 'held'); expect(await purge.step('purge')).toMatchObject({ state: 'held' }); await purge.hold('chain', null);
      expect(await purge.step('purge')).toMatchObject({ state: 'complete', payloadDisposition: 'erased' }); expect(await purge.progress('purge')).toMatchObject({ state: 'complete' }); expect((await purge.read('jobs', { limit: 10 })).records).toHaveLength(1);
      await expect(visibility.readHead('chain')).rejects.toMatchObject({ code: 'denied' });
    } finally { await fixture.close(); }
  });
});
