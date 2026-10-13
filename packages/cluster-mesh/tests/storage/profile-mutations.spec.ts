// K2b gates and discriminating mutations (L3a v4.1 frozen §16.1, §17.1):
// the staged, replay, barrier and lifecycle corpora executed against the
// test-only staged reference, plus one recorded mutant per corpus behavior.

import { describe, expect, it } from 'vitest';
import { isStorageError } from '../../src/storage/errors.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';
import { runStagedCorpus } from './staged-corpus.js';
import { runReplayCorpus } from './replay-corpus.js';
import { runBarrierCorpus } from './barrier-corpus.js';
import { runLifecycleCorpus } from './lifecycle-corpus.js';
import { TestStagedReferenceStore, type TestStagedStore } from './reference-staged.js';

let tokenSeq = 0;
const stagedGrant = () =>
  grantFor({ token: `token-k2b-${(tokenSeq += 1)}`, operations: ['read', 'write', 'maintain'] });

const bindStaged = (
  store?: TestStagedReferenceStore,
): { store: TestStagedReferenceStore; bound: TestStagedStore } => {
  const target = store ?? new TestStagedReferenceStore('comments');
  return { store: target, bound: target.bindStaged(stagedGrant()) };
};

describe('K2b reference: staged corpus', () => {
  it('K2b-RED hidden state, sequencing, publication, conflicts and recovery hold', async () => {
    const { store, bound } = bindStaged();
    const grant = bound.grant;
    await runStagedCorpus(bound, {
      breakAuthority: async () => {
        store.revoke(grant.token);
      },
    });
  });
});

describe('K2b reference: atomic corpus with barrier and purge profiles', () => {
  it('K2b-RED profiled barrier and purge effects commit with carriers', async () => {
    const { bound } = bindStaged();
    await runAtomicCorpus(bound, { visibilityBarriers: true, purgeJobs: true });
  });
});

describe('K2b reference: replay corpus', () => {
  it('K2b-RED ordering, watermark, CAS, poison, resync and interleave hold', async () => {
    const store = new TestStagedReferenceStore('comments');
    const primary = store.bindStaged(stagedGrant());
    const foreign = store.bindStaged(
      grantFor({
        token: `token-k2b-foreign-${(tokenSeq += 1)}`,
        operations: ['read', 'write', 'maintain'],
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
      }),
    );
    await runReplayCorpus(primary, foreign, {
      rebind: async () => store.bindStaged(stagedGrant()),
    });
  });
});

describe('K2b reference: barrier corpus', () => {
  it('K2b-RED coverage, G1 denial, absence and escape refusal hold', async () => {
    const { bound } = bindStaged();
    await runBarrierCorpus(bound);
  });
});

describe('K2b reference: lifecycle corpus', () => {
  it('K2b-RED separation, holds, sharing and completion hold', async () => {
    const store = new TestStagedReferenceStore('comments');
    const primary = store.bindStaged(stagedGrant());
    await runLifecycleCorpus(primary, {
      rebind: async () => store.bindStaged(stagedGrant()),
    });
  });
});

export interface K2bMutationRecord {
  readonly id: string;
  readonly brokenSemantic: string;
  readonly corpus: string;
  readonly verdict: 'killed';
}

class VisibleStagingStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      const receipt = await inner(input);
      try {
        await bound.commitAtomic(input.effects);
      } catch {
        /* eager effects stay live */
      }
      return receipt;
    };
    return bound;
  }
}

class GapBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = (input) => inner({ ...input, ordinal: input.ordinal === '2' ? '1' : input.ordinal });
    return bound;
  }
}

class ChangedBytesStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      try {
        return await inner(input);
      } catch (error) {
        if (isStorageError(error) && error.code === 'idempotency-conflict') {
          return { unitId: input.unit.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
        }
        throw error;
      }
    };
    return bound;
  }
}

class UnstableReceiptStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    let calls = 0;
    bound.stageFragment = async (input) => {
      const receipt = await inner(input);
      calls += 1;
      if (calls === 2) return { ...receipt, fragmentDigest: 'digest-tampered' };
      return receipt;
    };
    return bound;
  }
}

class AbortKeptStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.abortStaged = async () => undefined;
    return bound;
  }
}

const stagedHooks = (store: TestStagedReferenceStore, bound: TestStagedStore) => ({
  breakAuthority: async () => {
    store.revoke(bound.grant.token);
  },
});

describe('K2b discriminating mutations: staged', () => {
  it('S1-visible-staging is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new VisibleStagingStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/stay invisible/);
  });

  it('S2-gap-blind-staging is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new GapBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/gaps cannot advance/);
  });

  it('S3-changed-bytes-staging is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new ChangedBytesStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /changed bytes at an accepted ordinal/,
    );
  });

  it('S4-unstable-receipt is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new UnstableReceiptStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/same fragment receipt/);
  });

  it('S5-abort-kept-effects is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new AbortKeptStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/report abortion/);
  });
});
