import { describe, expect, it } from 'vitest';
import { grantFor } from './authority-corpus.js';
import { runLifecycleCorpus } from './lifecycle-corpus.js';
import { TestStagedReferenceStore, type TestStagedStore } from './reference-staged.js';

const runMutant = (mutate: (bound: TestStagedStore) => void) => {
  const store = new TestStagedReferenceStore('comments');
  let seq = 0;
  const bind = (weak = false) => {
    const bound = store.bindStaged(grantFor({ token: `lifecycle-${++seq}`, operations: weak ? ['read', 'write'] : ['read', 'write', 'maintain'] }));
    mutate(bound);
    return bound;
  };
  return runLifecycleCorpus(bind(), { rebind: () => bind(), bindWithoutMaintain: () => bind(true) });
};

describe('K2b r3 lifecycle integrity mutations', () => {
  it.each(['outcomes', 'notifications'] as const)('should kill duplicate %s despite stable returned outcome ids', async (kind) => {
    await expect(runMutant((bound) => {
      const inner = bound.completePurge.bind(bound);
      bound.completePurge = (intentId) => {
        const result = inner(intentId);
        if (result.outcomeId) {
          const state = (bound as unknown as { staged: {
            purgeOutcomes: { intentId: string; outcomeId: string }[];
            purgeNotifications: { intentId: string; outcomeId: string }[];
          } }).staged;
          const target = kind === 'outcomes' ? state.purgeOutcomes : state.purgeNotifications;
          target.push({ intentId, outcomeId: result.outcomeId });
        }
        return result;
      };
    })).rejects.toThrow(kind === 'outcomes' ? /C14: intent-held-1 has exactly one canonical outcome/ : /C14: intent-held-1 has exactly one effective notification/);
  });

  it.each(['record', 'aggregate'] as const)('should kill a false erasure claim for a retained %s', async (kind) => {
    await expect(runMutant((bound) => {
      const inner = bound.purgeProgress.bind(bound);
      bound.purgeProgress = (intentId) => {
        const result = inner(intentId);
        return intentId === (kind === 'record' ? 'intent-rec-1' : 'intent-agg-1') ? { ...result, payloadDisposition: 'erased' } : result;
      };
    })).rejects.toThrow(kind === 'record' ? /C14: a hidden retained record cannot claim physical erasure/ : /C14: a hidden retained aggregate cannot claim physical erasure/);
  });

  it('should kill loss of completion after the response is interrupted', async () => {
    await expect(runMutant((bound) => {
      const inner = bound.completePurge.bind(bound);
      bound.completePurge = (intentId) => {
        try { return inner(intentId); } catch (error) {
          if (intentId === 'intent-response') {
            const jobs = (bound as unknown as { staged: { jobs: Map<string, { state: string }> } }).staged.jobs;
            jobs.get(intentId)!.state = 'pending';
          }
          throw error;
        }
      };
    })).rejects.toThrow(/C14: response interruption preserves committed completion/);
  });
});
