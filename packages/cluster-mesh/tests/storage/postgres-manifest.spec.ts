import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
describe.skipIf(!pgEnabled)('retained authorized Postgres manifests', () => {
  it('derives actual heads, survives restart and denies current covered content', async () => {
    const fixture = await createPgFixture({ cursorSecret: 'restart-qualified' });
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      await bound.appendChain('a', { id: 'a0', hash: 'repeated', bytes: '{}' }, { kind: 'absent', allocation: '0' });
      await bound.appendChain('a', { id: 'a1', hash: 'repeated', bytes: '{}' }, { kind: 'head', hash: 'repeated' });
      const captured = await bound.captureManifest({ selections: ['a'] });
      expect(captured.manifest.heads.a).toEqual({ head: 'repeated', allocation: '2', terminalSeq: '1' });
      await bound.appendChain('a', { id: 'later', hash: 'later', bytes: '{}' }, { kind: 'head', hash: 'repeated' });
      const page = await bound.manifestReadPage(captured.digest, 'a', 1, null, 4096);
      const restartedKernel = await fixture.open();
      const restarted = await restartedKernel.bind(grant);
      const tail = await restarted.manifestReadPage(captured.digest, 'a', 10, page.nextCursor, 4096);
      expect(tail.records.map((row) => row.id)).toEqual(['a1']); expect(tail.nextCursor).toBeNull();
      const other = await root.bindNew(grantFor({ token: 'another', principalId: 'another', operations: ['read', 'write', 'maintain'] }));
      const same = await other.captureManifest({ selections: ['a'] });
      await restarted.captureManifest({ selections: ['a'] });
      expect(await other.verifyManifest(same.digest)).toEqual(same.manifest);
      await expect(other.verifyManifest(captured.digest)).rejects.toMatchObject({ code: 'invalid-command' });
      // E4 supersede: the reopened kernel holds the epoch, so the surviving
      // kernel commits while the first kernel only reads from here on.
      const restartedBound = await restartedKernel.bindNew(grant);
      await restartedBound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'a', reason: 'removed' }] });
      await expect(restarted.verifyManifest(captured.digest)).rejects.toMatchObject({ code: 'denied' });
      expect(await restarted.manifestReadPage(captured.digest, 'a', 1, null, 4096)).toMatchObject({ outcome: 'inaccessible' });
    } finally { await fixture.close(); }
  });
});
