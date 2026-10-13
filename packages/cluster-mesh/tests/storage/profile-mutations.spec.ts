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

class NoCheckpointCasStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.journalCheckpoint.bind(bound);
    bound.journalCheckpoint = async (consumer, _expected, next) => {
      const view = await bound.journalInspect(consumer);
      return inner(consumer, view.cursor, next);
    };
    return bound;
  }
}

class PoisonBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.journalMarkPoison = async () => undefined;
    return bound;
  }
}

class ResyncAdvancingStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.journalResync.bind(bound);
    bound.journalResync = async (consumer) => {
      const boundary = await inner(consumer);
      const view = await bound.journalInspect(consumer);
      await bound.journalCheckpoint(consumer, view.cursor, boundary.journalSeq);
      return boundary;
    };
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

describe('K2b discriminating mutations: replay', () => {
  const bindReplayPair = (store: TestStagedReferenceStore) => {
    const primary = store.bindStaged(stagedGrant());
    const foreign = store.bindStaged(
      grantFor({
        token: `token-k2b-foreign-${(tokenSeq += 1)}`,
        operations: ['read', 'write', 'maintain'],
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
      }),
    );
    return { primary, foreign };
  };

  it('J1-no-checkpoint-cas is killed by the replay corpus', async () => {
    const store = new NoCheckpointCasStore('comments');
    const { primary, foreign } = bindReplayPair(store);
    await expect(
      runReplayCorpus(primary, foreign, { rebind: async () => store.bindStaged(stagedGrant()) }),
    ).rejects.toThrow(/stale checkpoint expectation/);
  });

  it('J2-poison-blind-journal is killed by the replay corpus', async () => {
    const store = new PoisonBlindStore('comments');
    const { primary, foreign } = bindReplayPair(store);
    await expect(
      runReplayCorpus(primary, foreign, { rebind: async () => store.bindStaged(stagedGrant()) }),
    ).rejects.toThrow(/poison stalls the consumer/);
  });

  it('J3-resync-advancing-checkpoint is killed by the replay corpus', async () => {
    const store = new ResyncAdvancingStore('comments');
    const { primary, foreign } = bindReplayPair(store);
    await expect(
      runReplayCorpus(primary, foreign, { rebind: async () => store.bindStaged(stagedGrant()) }),
    ).rejects.toThrow(/without advancing the checkpoint/);
  });
});

class BarrierBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.isCovered = () => false;
    return bound;
  }
}

class EscapeOpenStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const covered = bound.isCovered.bind(bound);
    const innerAppend = bound.appendChain.bind(bound);
    const innerCommit = bound.commitAtomic.bind(bound);
    bound.appendChain = (chainId, record, expectation) => {
      bound.isCovered = () => false;
      try {
        return innerAppend(chainId, record, expectation);
      } finally {
        bound.isCovered = covered;
      }
    };
    bound.commitAtomic = (unit, options) => {
      bound.isCovered = () => false;
      try {
        return innerCommit(unit, options);
      } finally {
        bound.isCovered = covered;
      }
    };
    return bound;
  }
}

describe('K2b discriminating mutations: barrier', () => {
  it('B1-denial-blind-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new BarrierBlindStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/throws denied before purge/);
  });

  it('B2-escape-open-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new EscapeOpenStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/cannot escape its barrier/);
  });
});

class HoldBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.holdTarget = () => undefined;
    bound.releaseHold = () => undefined;
    return bound;
  }
}

class DivergentShareStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.shareBlob.bind(bound);
    bound.shareBlob = (blobId, owner, bytes) => {
      try {
        inner(blobId, owner, bytes);
      } catch (error) {
        if (isStorageError(error) && error.code === 'idempotency-conflict') return;
        throw error;
      }
    };
    return bound;
  }
}

class ForkingOutcomeStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.completePurge.bind(bound);
    let forks = 0;
    bound.completePurge = (intentId) => {
      const view = inner(intentId);
      if (view.state === 'complete' && view.outcomeId !== null) {
        forks += 1;
        return { state: 'complete' as const, outcomeId: `${view.outcomeId}-fork-${forks}` };
      }
      return view;
    };
    return bound;
  }
}

describe('K2b discriminating mutations: lifecycle', () => {
  const bindLifecycle = (store: TestStagedReferenceStore) => {
    const primary = store.bindStaged(stagedGrant());
    return { primary, hooks: { rebind: async () => store.bindStaged(stagedGrant()) } };
  };

  it('L1-hold-blind-lifecycle is killed by the lifecycle corpus', async () => {
    const store = new HoldBlindStore('comments');
    const { primary, hooks } = bindLifecycle(store);
    await expect(runLifecycleCorpus(primary, hooks)).rejects.toThrow(/stalls completion/);
  });

  it('L2-divergent-share is killed by the lifecycle corpus', async () => {
    const store = new DivergentShareStore('comments');
    const { primary, hooks } = bindLifecycle(store);
    await expect(runLifecycleCorpus(primary, hooks)).rejects.toThrow(/conflict when divergent/);
  });

  it('L3-forking-outcome is killed by the lifecycle corpus', async () => {
    const store = new ForkingOutcomeStore('comments');
    const { primary, hooks } = bindLifecycle(store);
    await expect(runLifecycleCorpus(primary, hooks)).rejects.toThrow(/exactly one operational outcome/);
  });
});

class DisposalBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.disposeChain = () => undefined;
    return bound;
  }
}

class RivalBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.appendChain.bind(bound);
    bound.appendChain = (chainId, record, expectation) => {
      if (chainId === 'chain-s1' && record.hash === 'hash-s1-rival') return { seq: 99, hash: record.hash, replayed: false };
      return inner(chainId, record, expectation);
    };
    return bound;
  }
}

export const K2B_MUTATION_RECORDS: readonly K2bMutationRecord[] = [
  { id: 'S1-visible-staging', brokenSemantic: 'staged effects leak before publication', corpus: 'staged', verdict: 'killed' },
  { id: 'S2-gap-blind-staging', brokenSemantic: 'gapped ordinals advance the frontier', corpus: 'staged', verdict: 'killed' },
  { id: 'S3-changed-bytes-staging', brokenSemantic: 'changed bytes at an accepted ordinal pass silently', corpus: 'staged', verdict: 'killed' },
  { id: 'S4-unstable-receipt', brokenSemantic: 'fragment receipts fork on retry', corpus: 'staged', verdict: 'killed' },
  { id: 'S5-abort-kept-effects', brokenSemantic: 'aborted units keep publishable effects', corpus: 'staged', verdict: 'killed' },
  { id: 'J1-no-checkpoint-cas', brokenSemantic: 'checkpoints skip CAS protection', corpus: 'replay', verdict: 'killed' },
  { id: 'J2-poison-blind-journal', brokenSemantic: 'poisoned events never stall the consumer', corpus: 'replay', verdict: 'killed' },
  { id: 'J3-resync-advancing-checkpoint', brokenSemantic: 'resync manufactures progress before snapshot consumption', corpus: 'replay', verdict: 'killed' },
  { id: 'B1-denial-blind-barrier', brokenSemantic: 'covered reads bypass denial', corpus: 'barrier', verdict: 'killed' },
  { id: 'B2-escape-open-barrier', brokenSemantic: 'covered writes escape their barrier', corpus: 'barrier', verdict: 'killed' },
  { id: 'B3-disposal-blind-barrier', brokenSemantic: 'disposed content stays readable', corpus: 'barrier', verdict: 'killed' },
  { id: 'L1-hold-blind-lifecycle', brokenSemantic: 'holds never stall completion', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L2-divergent-share', brokenSemantic: 'divergent shared bytes merge silently', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L3-forking-outcome', brokenSemantic: 'completion forks operational outcomes', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'T1-rival-blind-base', brokenSemantic: 'changed bases publish without conflict', corpus: 'staged', verdict: 'killed' },
];

describe('K2b discriminating mutations: disposal and base', () => {
  it('B3-disposal-blind-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new DisposalBlindStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/without coverage throws denied|stays denied after/);
  });

  it('T1-rival-blind-base is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new RivalBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/changed base|without publication/);
  });

  it('records every K2b discriminating mutation as killed', () => {
    expect(K2B_MUTATION_RECORDS.map((entry) => entry.verdict)).toEqual([
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
    ]);
  });
});
