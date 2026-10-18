import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf } from './staged-corpus.js';
describe.skipIf(!pgEnabled)('same-session installed hidden preparation', () => {
  it('rolls back accepted fragments with module preparation and emits no canonical event', async () => {
    let fail = true; const fence = { fenceId: 'installed', epoch: '1' };
    const fixture = await createPgFixture({ operations: { prepare: { operation: 'write', execute: async (_input, context) => {
      const unit = await context.beginStaged({ operationKey: 'installed', inputDigest: 'i', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
      const effects = { ...emptyEffects(), records: [{ key: 'hidden', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'private' } }] };
      await context.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
      if (fail) throw new Error('rollback installed preparation');
      context.replayed(); return { unitId: unit.unitId };
    } } } });
    try {
      const root = await fixture.open(); const grant = grantFor(); const bound = await root.bindNew(grant); await root.provisionFence(grant, fence);
      await expect(bound.invoke('prepare', {})).rejects.toThrow(/rollback installed preparation/);
      await expect(bound.inspectStaged('installed')).rejects.toMatchObject({ code: 'invalid-command' });
      fail = false; await bound.invoke('prepare', {});
      expect(await bound.inspectStaged('installed')).toEqual({ state: 'staging', acceptedFragments: '1' });
      expect(await bound.readRecord('hidden')).toBeNull();
      expect((await bound.journalRead(0, 100)).events).toHaveLength(0);
    } finally { await fixture.close(); }
  });
});
