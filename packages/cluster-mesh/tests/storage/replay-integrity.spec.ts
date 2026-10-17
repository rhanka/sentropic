import { describe, expect, it } from 'vitest';
import { grantFor } from './authority-corpus.js';
import { runReplayCorpus } from './replay-corpus.js';
import { TestStagedReferenceStore, type TestStagedStore } from './reference-staged.js';

const runMutant = (mutate: (bound: TestStagedStore) => void) => {
  const store = new TestStagedReferenceStore('comments');
  let seq = 0;
  const bind = (weak = false, foreign = false) => {
    const bound = store.bindStaged(grantFor({
      token: `replay-integrity-${++seq}`,
      operations: weak ? ['read', 'write'] : ['read', 'write', 'maintain'],
      scope: { tenantId: 'tenant-a', workspaceId: foreign ? 'foreign' : 'workspace-a' },
    }));
    mutate(bound);
    return bound;
  };
  return runReplayCorpus(bind(), bind(false, true), {
    rebind: () => bind(), bindWithoutMaintain: () => bind(true),
  });
};

describe('K2b r3 replay integrity mutations', () => {
  it('should kill resync clearing a stall before snapshot acknowledgement', async () => {
    await expect(runMutant((bound) => {
      const inner = bound.journalResync.bind(bound);
      bound.journalResync = (consumer, fence) => {
        const boundary = inner(consumer, fence);
        const state = bound.journalInspect(consumer);
        if (consumer === 'c-stall') bound.journalRetry(consumer, state.failedEvent, fence);
        return boundary;
      };
    })).rejects.toThrow(/K2b-RED replay: resync never clears a poison stall/);
  });

  it('should kill write authority replacing maintain at the checkpoint assertion', async () => {
    await expect(runMutant((bound) => {
      const inner = bound.requireOperation.bind(bound);
      bound.requireOperation = (operation) => inner(operation === 'maintain' ? 'write' : operation);
    })).rejects.toThrow(/C12: checkpoint requires maintain authority/);
  });

  it('should kill a stale epoch accepted by checkpoint maintenance', async () => {
    await expect(runMutant((bound) => {
      const inner = bound.requireJournalFence.bind(bound);
      bound.requireJournalFence = (fence) => inner({ ...fence, epoch: '1' });
    })).rejects.toThrow(/C12: checkpoint rejects a wrong stale fence/);
  });

  it.each(['incarnation', 'owner'] as const)('should kill an unchecked %s binding', async (binding) => {
    await expect(runMutant((bound) => {
      const inner = bound.requireJournalFence.bind(bound);
      bound.requireJournalFence = (fence) => {
        const issued = bound.journalFence();
        inner(binding === 'incarnation' ? { ...fence, incarnation: issued.incarnation } : { ...fence, ownerId: issued.ownerId });
      };
    })).rejects.toThrow(binding === 'incarnation' ? /C12: checkpoint rejects a wrong incarnation fence/ : /C12: checkpoint rejects a wrong owner fence/);
  });
});
