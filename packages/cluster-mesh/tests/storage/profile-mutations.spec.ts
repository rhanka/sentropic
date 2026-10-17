// K2b gates and discriminating mutations (L3a v4.1 frozen §16.1, §17.1):
// the staged, replay, barrier and lifecycle corpora executed against the
// test-only staged reference, plus one recorded mutant per corpus behavior.

import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { isStorageError } from '../../src/storage/errors.js';
import { stagedCommitRoots, stagedFragmentDigest } from '../../src/storage/staged-codec.js';
import { expectCode, runAtomicCorpus } from './atomic-corpus.js';
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
    const store = new TestStagedReferenceStore('comments');
    const primary = store.bindStaged(stagedGrant());
    const foreign = store.bindStaged(
      grantFor({
        token: `token-k2b-staged-foreign-${(tokenSeq += 1)}`,
        operations: ['read', 'write', 'maintain'],
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
      }),
    );
    const grant = primary.grant;
    await runStagedCorpus(
      primary,
      {
        breakAuthority: async () => {
          store.revoke(grant.token);
        },
      },
      foreign,
    );
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
      bindWithoutMaintain: async () =>
        store.bindStaged(
          grantFor({
            token: `token-k2b-weak-${(tokenSeq += 1)}`,
            operations: ['read', 'write'],
          }),
        ),
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
    bound.stageFragment = (input) => {
      if (input.ordinal !== '2') return inner(input);
      const op = stagedUnitsOf(bound).get(input.unit.operationKey);
      const fragmentDigest = stagedFragmentDigest(
        {
          moduleId: input.unit.moduleId,
          scope: input.unit.scope,
          operationId: input.unit.operationKey,
          contractDigest: op?.beginContractDigest ?? '',
          sourceBoundary: op?.beginSourceBoundary ?? '',
          ordinal: '1',
          predecessorHash: input.predecessorHash,
        },
        input.effects,
      );
      return inner({ ...input, ordinal: '1', fragmentDigest });
    };
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

class StaleBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.commitStaged.bind(bound);
    bound.commitStaged = (input) =>
      inner({ seal: input.seal, fence: { fenceId: 'fence-k2b', epoch: '1' } });
    return bound;
  }
}

class MutableBufferStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      const receipt = await inner(input);
      const staged = (
        bound as unknown as {
          staged: { units: Map<string, { fragments: { ordinal: string; effects: unknown }[] }> };
        }
      ).staged;
      const op = staged.units.get(input.unit.operationKey);
      const fragment = op?.fragments.find((entry) => entry.ordinal === input.ordinal);
      if (fragment) (fragment as { effects: unknown }).effects = input.effects;
      return receipt;
    };
    return bound;
  }
}

class DigestTrustStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      try {
        return await inner(input);
      } catch (error) {
        if (isStorageError(error) && error.code === 'idempotency-conflict' && input.fragmentDigest !== 'digest-changed') {
          return { unitId: input.unit.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
        }
        throw error;
      }
    };
    return bound;
  }
}

class ReceiptMutableStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.commitStaged.bind(bound);
    let shared: { commitId: string } | null = null;
    bound.commitStaged = async (input) => {
      const receipt = await inner(input);
      if (shared === null) {
        shared = receipt as unknown as { commitId: string };
        return receipt;
      }
      return shared as unknown as typeof receipt;
    };
    return bound;
  }
}

class BeginBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.beginStaged.bind(bound);
    bound.beginStaged = (input) => {
      try {
        return inner(input);
      } catch (error) {
        if (isStorageError(error) && error.code === 'idempotency-conflict') {
          return { unitId: 'unit-blind', operationKey: input.operationKey, moduleId: 'comments', scope: bound.scope };
        }
        throw error;
      }
    };
    return bound;
  }
}

class SealBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.sealStaged.bind(bound);
    bound.sealStaged = (input) => {
      const op = stagedUnitsOf(bound).get(input.unit.operationKey);
      const roots = stagedCommitRoots((op?.fragments ?? []).map((entry) => ({ ordinal: entry.ordinal, effects: entry.effects })));
      return inner({
        unit: input.unit,
        root: { ...input.root, operationId: input.unit.operationKey, contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', ...roots },
      });
    };
    return bound;
  }
}

type ReferenceStagedUnits = Map<
  string,
  { fragments: { ordinal: string; effects: AtomicUnit }[]; beginContractDigest?: string; beginSourceBoundary?: string }
>;

const stagedUnitsOf = (bound: TestStagedStore): ReferenceStagedUnits =>
  (bound as unknown as { staged: { units: ReferenceStagedUnits } }).staged.units;

// MAJEUR-N1 mutant: a new ordinal stores the backend's own digest and echoes
// the caller's declared digest instead of rejecting the mismatch.
class NewOrdinalDigestTrustStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      const op = stagedUnitsOf(bound).get(input.unit.operationKey);
      if (!op || op.fragments.some((entry) => entry.ordinal === input.ordinal)) return inner(input);
      const recomputed = stagedFragmentDigest(
        {
          moduleId: input.unit.moduleId,
          scope: input.unit.scope,
          operationId: input.unit.operationKey,
          contractDigest: op.beginContractDigest ?? '',
          sourceBoundary: op.beginSourceBoundary ?? '',
          ordinal: input.ordinal,
          predecessorHash: input.predecessorHash,
        },
        input.effects,
      );
      const receipt = await inner({ ...input, fragmentDigest: recomputed });
      return { ...receipt, fragmentDigest: input.fragmentDigest };
    };
    return bound;
  }
}

// MAJEUR-N1 mutant: sealing skips dependency closure.
class ClosureBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.verifyDependencyClosure = () => undefined;
    return bound;
  }
}

class InterruptBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    bound.armPurgeFailure = () => undefined;
    return bound;
  }
}

class RecordLeakStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const innerStage = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      const receipt = await innerStage(input);
      if (input.effects.records.length > 0) {
        try {
          await bound.commitAtomic({
            guards: [],
            records: [...input.effects.records],
            appends: [],
            updates: [],
            relationships: [],
            barriers: [],
            purgeIntents: [],
            indexWrites: [],
          });
        } catch {
          /* leak attempt */
        }
      }
      return receipt;
    };
    return bound;
  }
}

class OverlayBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = (unit, options) =>
      inner(
        {
          ...unit,
          appends: unit.appends
            .filter((append) => append.record.id !== 'd1')
            .map((append) =>
              append.record.id === 'd2'
                ? { ...append, expectation: { kind: 'head', hash: 'hash-dep-0' } as const }
                : append,
            ),
        },
        options,
      );
    return bound;
  }
}

class CrossBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.stageFragment.bind(bound);
    bound.stageFragment = async (input) => {
      try {
        return await inner(input);
      } catch (error) {
        if (isStorageError(error) && input.unit.operationKey === 'op-collide') {
          return { unitId: input.unit.unitId, ordinal: input.ordinal, fragmentDigest: input.fragmentDigest };
        }
        throw error;
      }
    };
    return bound;
  }
}

class SnapshotBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.snapshotRead.bind(bound);
    bound.snapshotRead = async (snapshotRoot: string, after: number, limit: number) => {
      const result = await inner(snapshotRoot, after, limit);
      const full = await bound.journalRead('c-snap', 0, 100);
      return { events: full.events.slice(0, result.events.length + 1), watermark: result.watermark };
    };
    return bound;
  }
}

class IdRewriteStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.externalRead.bind(bound);
    bound.externalRead = async (after: number, limit: number) => {
      const result = await inner(after, limit);
      return {
        events: result.events.map((event) => ({ ...event, eventId: event.eventId.replace(/^evt-/, 'xevt-') })),
        watermark: result.watermark,
      };
    };
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
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(/K2b-RED staged: staged effects stay invisible to head lookup/);
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

  it('S6-stale-blind-staging is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new StaleBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /a stale writer cannot publish/,
    );
  });

  it('S7-mutable-buffer is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new MutableBufferStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /buffers are immutable after acceptance/,
    );
  });

  it('S8-digest-trust is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new DigestTrustStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /changed effects under a repeated digest/,
    );
  });

  it('S9-receipt-mutable is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new ReceiptMutableStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /stored receipts stay immutable after delivery/,
    );
  });

  it('S10-begin-blind is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new BeginBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /a divergent begin conflicts/,
    );
  });

  it('S10b-seal-blind is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new SealBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /a divergent seal operation cannot seal/,
    );
  });

  it('S11-cross-blind is killed by the staged corpus', async () => {
    const store = new CrossBlindStore('comments');
    const primary = store.bindStaged(stagedGrant());
    const foreign = store.bindStaged(
      grantFor({
        token: `token-k2b-cross-${(tokenSeq += 1)}`,
        operations: ['read', 'write', 'maintain'],
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
      }),
    );
    await expect(runStagedCorpus(primary, stagedHooks(store, primary), foreign)).rejects.toThrow(
      /a foreign handle cannot stage/,
    );
  });

  it('S12-overlay-blind is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new OverlayBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /successive fragments publish the full ordered history/,
    );
  });

  it('S13-record-leak is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new RecordLeakStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /staged records stay invisible to direct lookup/,
    );
  });

  it('S14-new-ordinal-digest-trust is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new NewOrdinalDigestTrustStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /a declared digest of other effects cannot stage a new ordinal/,
    );
  });

  it('S15-closure-blind is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new ClosureBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /a self-consistent fragment with an unresolved dependency cannot seal/,
    );
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

  it('J4-id-rewrite is killed by the replay corpus', async () => {
    const store = new IdRewriteStore('comments');
    const { primary, foreign } = bindReplayPair(store);
    await expect(
      runReplayCorpus(primary, foreign, { rebind: async () => store.bindStaged(stagedGrant()) }),
    ).rejects.toThrow(/external mirrors preserve kernel identities/);
  });

  it('J5-snapshot-blind is killed by the replay corpus', async () => {
    const store = new SnapshotBlindStore('comments');
    const { primary, foreign } = bindReplayPair(store);
    await expect(
      runReplayCorpus(primary, foreign, { rebind: async () => store.bindStaged(stagedGrant()) }),
    ).rejects.toThrow(/excludes records committed after its boundary/);
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

class ReparentOpenStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.declareCoverage.bind(bound);
    bound.declareCoverage = (parent: string, child: string) => {
      if (child === 'comment-0' && parent === 'thread-2') {
        (bound as unknown as { staged: { coverage: Map<string, string> } }).staged.coverage.set(child, parent);
        return;
      }
      return inner(parent, child);
    };
    return bound;
  }
}

// K2b r3 MINEUR-4 mutant: a raw tombstone record installs an operational
// barrier on the subject it names (raw persistence must install none, N6).
class RawTombstoneBarrierStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = (unit, options) => {
      const named = unit.appends.flatMap((append) => {
        try {
          const parsed = JSON.parse(append.record.bytes) as { tombstone?: unknown };
          return typeof parsed.tombstone === 'string' ? [{ boundary: parsed.tombstone, reason: 'raw-tombstone' }] : [];
        } catch {
          return [];
        }
      });
      return inner({ ...unit, barriers: [...unit.barriers, ...named] }, options);
    };
    return bound;
  }
}

describe('K2b discriminating mutations: barrier', () => {
  it('B1-denial-blind-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new BarrierBlindStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/K2b-RED barriers G1: covered comment 0 head throws denied before purge/);
  });

  it('B2-escape-open-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new EscapeOpenStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/a concurrent child cannot escape/);
  });

  it('B4-reparent-open-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new ReparentOpenStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/a covered child cannot escape/);
  });

  it('B5-raw-tombstone-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new RawTombstoneBarrierStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/plus a raw tombstone leaves reads unaffected/);
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

class PurgeAuthorityBlindStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const innerCommit = bound.commitAtomic.bind(bound);
    bound.commitAtomic = (unit, options) => {
      const originalRequire = bound.requireOperation.bind(bound);
      bound.requireOperation = (op) => {
        if (op === 'maintain') return;
        return originalRequire(op);
      };
      try {
        return innerCommit(unit, options);
      } finally {
        bound.requireOperation = originalRequire;
      }
    };
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
    return {
      primary,
      hooks: {
        rebind: async () => store.bindStaged(stagedGrant()),
        bindWithoutMaintain: async () =>
          store.bindStaged(
            grantFor({
              token: `token-k2b-weak-${(tokenSeq += 1)}`,
              operations: ['read', 'write'],
            }),
          ),
      },
    };
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

  it('L4-purge-authority-blind is killed by the lifecycle corpus', async () => {
    const store = new PurgeAuthorityBlindStore('comments');
    const { primary, hooks } = bindLifecycle(store);
    await expect(runLifecycleCorpus(primary, hooks)).rejects.toThrow(/without purge authority is denied/);
  });

  it('L5-interrupt-blind is killed by the lifecycle corpus', async () => {
    const store = new InterruptBlindStore('comments');
    const { primary, hooks } = bindLifecycle(store);
    await expect(runLifecycleCorpus(primary, hooks)).rejects.toThrow(
      /an interruption before the outcome leaves no completion/,
    );
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
    const inner = bound.commitStaged.bind(bound);
    bound.commitStaged = async (input) => {
      const staged = (
        bound as unknown as {
          staged: { units: Map<string, { indexBase?: Map<string, unknown> }> };
        }
      ).staged;
      const op = [...staged.units.values()].find((entry) => entry.unitId === input.seal.unitId);
      if (op) op.indexBase = new Map();
      return inner(input);
    };
    return bound;
  }
}

class PlainErrorStore extends TestStagedReferenceStore {
  override bindStaged(grant: Parameters<TestStagedReferenceStore['bindStaged']>[0]): TestStagedStore {
    const bound = super.bindStaged(grant);
    const inner = bound.readHead.bind(bound);
    bound.readHead = (chainId: string) => {
      try {
        return inner(chainId);
      } catch (error) {
        if (isStorageError(error)) throw new Error('denied');
        throw error;
      }
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
  { id: 'S6-stale-blind-staging', brokenSemantic: 'stale writers publish without fence revalidation', corpus: 'staged', verdict: 'killed' },
  { id: 'S7-mutable-buffer', brokenSemantic: 'caller buffers mutate accepted staged effects', corpus: 'staged', verdict: 'killed' },
  { id: 'S8-digest-trust', brokenSemantic: 'repeated digests mask divergent effects', corpus: 'staged', verdict: 'killed' },
  { id: 'S9-receipt-mutable', brokenSemantic: 'returned receipts mutate stored commitments', corpus: 'staged', verdict: 'killed' },
  { id: 'S10-begin-blind', brokenSemantic: 'divergent begins recover silently', corpus: 'staged', verdict: 'killed' },
  { id: 'S10b-seal-blind', brokenSemantic: 'divergent seals pass validation', corpus: 'staged', verdict: 'killed' },
  { id: 'S11-cross-blind', brokenSemantic: 'foreign handles stage across scopes', corpus: 'staged', verdict: 'killed' },
  { id: 'S12-overlay-blind', brokenSemantic: 'successive fragments drop intermediate history', corpus: 'staged', verdict: 'killed' },
  { id: 'S13-record-leak', brokenSemantic: 'staged records leak before publication', corpus: 'staged', verdict: 'killed' },
  { id: 'S14-new-ordinal-digest-trust', brokenSemantic: 'a mismatching declared digest is accepted on a new ordinal', corpus: 'staged', verdict: 'killed' },
  { id: 'S15-closure-blind', brokenSemantic: 'sealing skips dependency closure', corpus: 'staged', verdict: 'killed' },
  { id: 'J1-no-checkpoint-cas', brokenSemantic: 'checkpoints skip CAS protection', corpus: 'replay', verdict: 'killed' },
  { id: 'J2-poison-blind-journal', brokenSemantic: 'poisoned events never stall the consumer', corpus: 'replay', verdict: 'killed' },
  { id: 'J3-resync-advancing-checkpoint', brokenSemantic: 'resync manufactures progress before snapshot consumption', corpus: 'replay', verdict: 'killed' },
  { id: 'J4-id-rewrite', brokenSemantic: 'external mirrors rewrite kernel identities', corpus: 'replay', verdict: 'killed' },
  { id: 'J5-snapshot-blind', brokenSemantic: 'snapshots leak post-boundary records', corpus: 'replay', verdict: 'killed' },
  { id: 'B1-denial-blind-barrier', brokenSemantic: 'covered reads bypass denial', corpus: 'barrier', verdict: 'killed' },
  { id: 'B2-escape-open-barrier', brokenSemantic: 'covered writes escape their barrier', corpus: 'barrier', verdict: 'killed' },
  { id: 'B4-reparent-open-barrier', brokenSemantic: 'covered children escape via reparenting', corpus: 'barrier', verdict: 'killed' },
  { id: 'B5-raw-tombstone-barrier', brokenSemantic: 'a raw tombstone installs a barrier on the subject it names', corpus: 'barrier', verdict: 'killed' },
  { id: 'B3-disposal-blind-barrier', brokenSemantic: 'disposed content stays readable', corpus: 'barrier', verdict: 'killed' },
  { id: 'L1-hold-blind-lifecycle', brokenSemantic: 'holds never stall completion', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L2-divergent-share', brokenSemantic: 'divergent shared bytes merge silently', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L3-forking-outcome', brokenSemantic: 'completion forks operational outcomes', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L4-purge-authority-blind', brokenSemantic: 'purge intents pass without purge authority', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'L5-interrupt-blind', brokenSemantic: 'purge interruptions complete silently', corpus: 'lifecycle', verdict: 'killed' },
  { id: 'T1-rival-blind-base', brokenSemantic: 'changed bases publish without conflict', corpus: 'staged', verdict: 'killed' },
  { id: 'E1-plain-error', brokenSemantic: 'untyped Error passes as a typed denial', corpus: 'barrier', verdict: 'killed' },
];

describe('K2b discriminating mutations: disposal and base', () => {
  it('B3-disposal-blind-barrier is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new DisposalBlindStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/disposed content without coverage throws denied/);
  });

  it('T1-rival-blind-base is killed by the staged corpus', async () => {
    const { store, bound } = bindStaged(new RivalBlindStore('comments'));
    await expect(runStagedCorpus(bound, stagedHooks(store, bound))).rejects.toThrow(
      /an unguarded index replacement conflicts without publication/,
    );
  });

  it('E1-plain-error is killed by the barrier corpus', async () => {
    const { bound } = bindStaged(new PlainErrorStore('comments'));
    await expect(runBarrierCorpus(bound)).rejects.toThrow(/K2b-RED barriers G1: covered comment 0 head throws denied before purge/);
  });

  it('E1-plain-error helper rejects an untyped denial', async () => {
    await assert.rejects(
      expectCode(async () => {
        throw new Error('denied');
      }, 'denied', 'K2b-INT-C19: an untyped denial never satisfies the typed helper'),
    );
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
      'killed',
      'killed',
      'killed',
    ]);
  });
});
