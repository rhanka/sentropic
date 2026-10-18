import { describe, it } from 'vitest';
import { createStagedTestKernel } from './staged-client.js';
import { grantFor } from './authority-corpus.js';
import { runStagedFenceRotationCorpus, runStagedOwnershipCorpus } from './staged-integrity-corpus.js';

describe('public K4 shared staged integrity', () => {
  it('should qualify owned nested bytes, hidden audit and colliding foreign bindings', async () => {
    const root = createStagedTestKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    const foreign = root.bindNew(grantFor({ token: 'foreign-integrity', scope: { tenantId: 'foreign', workspaceId: 'w' }, operations: ['read', 'write', 'maintain'] }));
    await runStagedOwnershipCorpus(bound, foreign);
  });
  it('should qualify current fence rotation through every staged mutation', async () => {
    const root = createStagedTestKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    await runStagedFenceRotationCorpus(bound, (fence) => root.rotateFence(bound.scope, fence));
  });
});
