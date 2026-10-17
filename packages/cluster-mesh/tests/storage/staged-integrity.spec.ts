import { describe, it } from 'vitest';
import { grantFor } from './authority-corpus.js';
import { TestStagedReferenceStore } from './reference-staged.js';
import { runStagedFenceRotationCorpus, runStagedOwnershipCorpus } from './staged-integrity-corpus.js';

describe('K2b r3 staged integrity', () => {
  it('should own nested bytes and hide audit effects with colliding foreign ids', async () => {
    const store = new TestStagedReferenceStore('comments');
    const local = store.bindStaged(grantFor({ token: 'local', operations: ['read', 'write', 'maintain'] }));
    const foreign = store.bindStaged(grantFor({
      token: 'foreign', operations: ['read', 'write', 'maintain'],
      scope: { tenantId: 'tenant-a', workspaceId: 'foreign' },
    }));
    await runStagedOwnershipCorpus(local, foreign);
  });

  it('should refuse a formerly valid fence after its owner rotates it', async () => {
    const store = new TestStagedReferenceStore('comments');
    const bound = store.bindStaged(grantFor({ operations: ['read', 'write', 'maintain'] }));
    await runStagedFenceRotationCorpus(bound, (fence) => store.rotateFence(bound.scope, fence));
  });
});
