// K2a discriminating mutations (L3a v4.1 frozen §16.1): each mutant breaks one
// executable semantic; the shared corpus must kill it. Recorded below.

import { describe, expect, it } from 'vitest';
import type { AtomicUnit, ChainExpectation, CommitOptions } from '../../src/storage/atomic.js';
import { StorageCasConflictError, StorageDeniedError, StorageIdempotencyConflictError } from '../../src/storage/errors.js';
import { grantFor, runAuthorityCorpus } from './authority-corpus.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { TestBoundStore, TestReferenceStore, type ChainPageCursor, type ChainRecordInput } from './reference-store.js';

export interface MutationRecord {
  readonly id: string;
  readonly brokenSemantic: string;
  readonly corpus: string;
  readonly verdict: 'killed';
}

const bindFresh = (store?: TestReferenceStore): { store: TestReferenceStore; bound: TestBoundStore } => {
  const target = store ?? new TestReferenceStore('comments');
  return {
    store: target,
    bound: target.bindNew(grantFor({ token: 'token-mutant-1', operations: ['read', 'write', 'maintain'] })),
  };
};

class NoCasStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.appendChain.bind(bound);
    bound.appendChain = (chainId: string, record: ChainRecordInput, expectation: ChainExpectation) => {
      if (expectation.kind === 'absent') return inner(chainId, record, expectation);
      if (bound.readHead(chainId) === expectation.hash) return inner(chainId, record, expectation);
      return { seq: 999, hash: record.hash, replayed: false };
    };
    return bound;
  }
}

class AllowAllStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    bound.requireOperation = () => undefined;
    return bound;
  }
}

class NoGenesisConflictStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.genesis.bind(bound);
    bound.genesis = (kind: string, id: string, hash: string, value: unknown) => {
      try {
        return inner(kind, id, hash, value);
      } catch {
        return { hash: 'forced', replayed: true };
      }
    };
    return bound;
  }
}

class NoByteLimitStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.readPage.bind(bound);
    bound.readPage = (chainId: string, limit: number, cursor: Parameters<TestBoundStore['readPage']>[2]) =>
      inner(chainId, limit, cursor, Number.MAX_SAFE_INTEGER);
    return bound;
  }
}

class AllowRecreateStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.appendChain.bind(bound);
    bound.appendChain = (chainId: string, record: ChainRecordInput, expectation: ChainExpectation) => {
      try {
        return inner(chainId, record, expectation);
      } catch (error) {
        if (error instanceof Error && /disposed/.test(error.message)) {
          return { seq: 0, hash: record.hash, replayed: false };
        }
        throw error;
      }
    };
    return bound;
  }
}

class NoStagingStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = async (unit: AtomicUnit, options?: CommitOptions) => {
      try {
        return await inner(unit, options);
      } catch (error) {
        if (error instanceof StorageCasConflictError) {
          // Eager appends with late guard validation: the unit's appends stay
          // live when the guard conflict surfaces, so the unit never rolls back.
          for (const append of unit.appends) {
            try {
              await bound.appendChain(append.chainId, append.record, append.expectation);
            } catch {
              /* keep surfacing the guard conflict */
            }
          }
        }
        throw error;
      }
    };
    return bound;
  }
}

class IgnoreAllocationStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.appendChain.bind(bound);
    bound.appendChain = (chainId: string, record: ChainRecordInput, expectation: ChainExpectation) => {
      if (expectation.kind === 'absent') return inner(chainId, record, { kind: 'absent', allocation: '0' });
      return inner(chainId, record, expectation);
    };
    return bound;
  }
}

class CodeAsIdempotencyStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.appendChain.bind(bound);
    bound.appendChain = (chainId: string, record: ChainRecordInput, expectation: ChainExpectation) => {
      try {
        return inner(chainId, record, expectation);
      } catch (error) {
        if (error instanceof StorageCasConflictError) throw new StorageIdempotencyConflictError(error.message);
        throw error;
      }
    };
    return bound;
  }
}

class AcceptUnknownTokenStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    try {
      return super.bind(grant);
    } catch (error) {
      if (error instanceof StorageDeniedError && /unknown grant token/.test(error.message)) {
        this.issueGrant(grant);
        return super.bind(grant);
      }
      throw error;
    }
  }
}

class LatestHeadStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.readPage.bind(bound);
    bound.readPage = async (chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) => {
      if (typeof cursor === 'object' && cursor !== null) {
        const live = await bound.readHead(chainId);
        if (typeof live === 'string') {
          return inner(chainId, limit, { ...(cursor as ChainPageCursor), head: live }, maxEncodedBytes);
        }
      }
      return inner(chainId, limit, cursor, maxEncodedBytes);
    };
    return bound;
  }
}

class RecordCountingStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.readPage.bind(bound);
    bound.readPage = async (chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) => {
      // Pre-R3 accounting: only the records count toward the budget while the
      // envelope and the cursor ride free.
      const admitted = await inner(chainId, limit, cursor, Number.MAX_SAFE_INTEGER);
      if (admitted.outcome !== 'page') return admitted;
      const recordsBytes = admitted.records.reduce(
        (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry), 'utf8'),
        0,
      );
      if (recordsBytes > maxEncodedBytes) {
        return { outcome: 'incomplete', records: [], nextCursor: admitted.nextCursor } as const;
      }
      return admitted;
    };
    return bound;
  }
}

class FrozenResumeCursorStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.readPage.bind(bound);
    const innerChain = bound.readChain.bind(bound);
    const innerHead = bound.readHead.bind(bound);
    const encodedBytes = (
      outcome: string,
      records: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[],
      nextCursor: unknown,
    ): number => Buffer.byteLength(JSON.stringify({ outcome, records, nextCursor }), 'utf8');
    // MAJ-1 faithful mutant: revert of fitIncomplete — the resume cursor is
    // frozen before trimming (start + pre-trim length) instead of being
    // recomputed as start + delivered. Under a budget that forces a trim
    // (161-166 on s0..s2) it returns [s0] + {2}, skipping s1 on resume.
    // Empty trims stay null so the mutant passes the floor assertions and
    // dies on the exact full record set.
    const buggyFit = (
      records: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[],
      start: number,
      head: string | null,
      maxEncodedBytes: number,
    ) => {
      const frozen: ChainPageCursor | null = head === null ? null : { position: start + records.length, head };
      const trimmed = [...records];
      while (trimmed.length > 0 && encodedBytes('incomplete', trimmed, frozen) > maxEncodedBytes) {
        trimmed.pop();
      }
      if (trimmed.length === 0) return { outcome: 'incomplete' as const, records: trimmed, nextCursor: null };
      return { outcome: 'incomplete' as const, records: trimmed, nextCursor: frozen };
    };
    bound.readPage = async (chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) => {
      let start = 0;
      let cursorHead: string | null = null;
      if (cursor !== null && cursor !== undefined) {
        const candidate = cursor as { readonly position?: unknown; readonly head?: unknown };
        if (typeof candidate.position === 'number' && typeof candidate.head === 'string') {
          start = candidate.position;
          cursorHead = candidate.head;
        } else {
          return inner(chainId, limit, cursor, maxEncodedBytes);
        }
      }
      let all: readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[];
      try {
        all = await innerChain(chainId);
      } catch {
        return inner(chainId, limit, cursor, maxEncodedBytes);
      }
      const head = cursorHead ?? (await innerHead(chainId));
      if (head === null) return inner(chainId, limit, cursor, maxEncodedBytes);
      const boundIdx = all.findIndex((entry) => entry.hash === head);
      if (boundIdx === -1) return inner(chainId, limit, cursor, maxEncodedBytes);
      const visible = all.slice(0, boundIdx + 1);
      const deliverable = visible.filter((entry) => entry.seq >= start);
      const lastSeq = deliverable.length > 0 ? deliverable[deliverable.length - 1].seq : -1;
      const page: { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[] = [];
      for (const record of visible) {
        if (record.seq < start) continue;
        const isLast = record.seq === lastSeq;
        const candidate: ChainPageCursor | null = isLast ? null : { position: record.seq, head };
        const next: ChainPageCursor = { position: record.seq, head };
        if (page.length >= limit) {
          if (encodedBytes('page', page, next) > maxEncodedBytes) return buggyFit(page, start, head, maxEncodedBytes);
          return { outcome: 'page' as const, records: page, nextCursor: next };
        }
        if (encodedBytes('page', [...page, record], candidate) > maxEncodedBytes) {
          return buggyFit(page, start, head, maxEncodedBytes);
        }
        page.push(record);
      }
      return inner(chainId, limit, cursor, maxEncodedBytes);
    };
    return bound;
  }
}

class CandidateCursorBudgetStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.readPage.bind(bound);
    bound.readPage = async (chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) => {
      // MIN-1 mutant: measure admission as a 'page' (6 bytes smaller than
      // 'incomplete'), restoring the pre-R3 candidate-cursor accounting.
      return inner(chainId, limit, cursor, maxEncodedBytes + 6);
    };
    return bound;
  }
}

class EmptyValuesStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const innerRecord = bound.readRecord.bind(bound);
    bound.readRecord = async (key: string) => {
      const stored = await innerRecord(key);
      if (!stored) return stored;
      return { bytes: { format: stored.bytes.format, data: '' }, contentHash: stored.contentHash };
    };
    const innerAggregate = bound.readAggregate.bind(bound);
    bound.readAggregate = async (key: string) => {
      const stored = await innerAggregate(key);
      if (!stored) return stored;
      return { version: stored.version, value: { format: stored.value.format, data: '' } };
    };
    return bound;
  }
}

class MutableGrantStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    (bound as { grant: ScopeGrant<unknown> }).grant = grant;
    return bound;
  }
}

class IgnoreAggregateVersionStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = (unit: AtomicUnit, options?: CommitOptions) =>
      inner({ ...unit, guards: unit.guards.filter((guard) => guard.kind !== 'aggregate-version') }, options);
    return bound;
  }
}

class DropUnsupportedEffectsStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = (unit: AtomicUnit, options?: CommitOptions) =>
      inner({ ...unit, relationships: [], barriers: [], purgeIntents: [] }, options);
    return bound;
  }
}

class AcceptStaleUpdateStore extends TestReferenceStore {
  override bind(grant: Parameters<TestReferenceStore['bind']>[0]): TestBoundStore {
    const bound = super.bind(grant);
    const inner = bound.commitAtomic.bind(bound);
    bound.commitAtomic = async (unit: AtomicUnit, options?: CommitOptions) => {
      const updates = [];
      for (const update of unit.updates) {
        const stored = await bound.readAggregate(update.key);
        updates.push(
          stored && update.version <= stored.version ? { ...update, version: stored.version + 1 } : update,
        );
      }
      return inner({ ...unit, updates }, options);
    };
    return bound;
  }
}

export const MUTATION_RECORDS: readonly MutationRecord[] = [
  { id: 'M1-no-cas', brokenSemantic: 'CAS-first appends accept stale heads', corpus: 'atomic', verdict: 'killed' },
  { id: 'M2-no-scope', brokenSemantic: 'operations pass without any authority check', corpus: 'authority', verdict: 'killed' },
  { id: 'M3-no-genesis-conflict', brokenSemantic: 'genesis replays conflicting hashes silently', corpus: 'atomic', verdict: 'killed' },
  { id: 'M4-no-byte-limit', brokenSemantic: 'read pages ignore encoded-byte bounds', corpus: 'read', verdict: 'killed' },
  { id: 'M5-allow-recreate', brokenSemantic: 'disposed chains accept recreation silently', corpus: 'chain', verdict: 'killed' },
  { id: 'M6-no-staging', brokenSemantic: 'atomic commits apply appends without staging', corpus: 'atomic', verdict: 'killed' },
  { id: 'M7-ignore-allocation', brokenSemantic: 'chain creation ignores the allocation expectation', corpus: 'chain', verdict: 'killed' },
  { id: 'M8-code-as-idempotency', brokenSemantic: 'stale heads report idempotency-conflict instead of cas-conflict', corpus: 'chain', verdict: 'killed' },
  { id: 'M9-accept-unknown-token', brokenSemantic: 'bind accepts a never-issued grant token', corpus: 'authority', verdict: 'killed' },
  { id: 'M10-offset-cursor', brokenSemantic: 'read cursors follow the live head instead of the retained boundary', corpus: 'read', verdict: 'killed' },
  { id: 'M11-record-counting-budget', brokenSemantic: 'read pages count records only toward byte bounds', corpus: 'read', verdict: 'killed' },
  { id: 'M12-empty-values', brokenSemantic: 'persisted records keep hashes but lose values', corpus: 'atomic', verdict: 'killed' },
  { id: 'M13-mutable-grant', brokenSemantic: 'bound handles follow caller-side grant mutation', corpus: 'authority', verdict: 'killed' },
  { id: 'M14-ignore-aggregate-version', brokenSemantic: 'atomic commits ignore aggregate-version guards', corpus: 'atomic', verdict: 'killed' },
  { id: 'M15-drop-unsupported-effects', brokenSemantic: 'atomic commits silently drop unsupported effects', corpus: 'atomic', verdict: 'killed' },
  { id: 'M16-accept-stale-update', brokenSemantic: 'atomic commits accept stale aggregate versions', corpus: 'atomic', verdict: 'killed' },
  { id: 'M17-frozen-resume-cursor', brokenSemantic: 'over-budget pages freeze the resume cursor past the first undelivered record', corpus: 'read', verdict: 'killed' },
  { id: 'M18-candidate-cursor-budget', brokenSemantic: 'read pages measure admission with the candidate page cursor', corpus: 'read', verdict: 'killed' },
];

describe('K2a discriminating mutations', () => {
  it('M1-no-cas is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new NoCasStore('comments'));
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-2' }, { kind: 'head', hash: 'hp-1' });
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/stale head|repeated bytes|CAS first/);
  });

  it('M2-no-scope is killed by the authority corpus', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const store = new AllowAllStore('comments', () => now);
    await expect(
      runAuthorityCorpus({
        store,
        grant: grantFor(),
        readGrant: grantFor({ token: 'token-read-1', operations: ['read'] }),
        setNow: (iso: string) => {
          now = iso;
        },
      }),
    ).rejects.toThrow(/denied|forged|lacks write|escalation|read-only/);
  });

  it('M3-no-genesis-conflict is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new NoGenesisConflictStore('comments'));
    const first = await bound.genesis('probe', 'probe-1', 'digest-probe-1', { v: 1 });
    expect(first.replayed).toBe(false);
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/different hash|genesis.*conflict/);
  });

  it('M4-no-byte-limit is killed by the read corpus', async () => {
    const { bound } = bindFresh(new NoByteLimitStore('comments'));
    await expect(runReadCorpus(bound)).rejects.toThrow(/incomplete|byte|encoded/);
  });

  it('M5-allow-recreate is killed by the chain corpus', async () => {
    const { bound } = bindFresh(new AllowRecreateStore('comments'));
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-1' }, { kind: 'absent', allocation: '0' });
    await expect(runChainCorpus(bound)).rejects.toThrow(/disposed|recreat/);
  });

  it('M6-no-staging is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new NoStagingStore('comments'));
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-2' }, { kind: 'head', hash: 'hp-1' });
    await expect(runAtomicCorpus(bound)).rejects.toThrow(
      /K2aR3-RED atomic: a failing guard rolls back the whole unit/,
    );
  });

  it('M7-ignore-allocation is killed by the chain corpus', async () => {
    const { bound } = bindFresh(new IgnoreAllocationStore('comments'));
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-1' }, { kind: 'absent', allocation: '0' });
    await expect(runChainCorpus(bound)).rejects.toThrow(/invalid-command|allocation/);
  });

  it('M8-code-as-idempotency is killed by the chain corpus', async () => {
    const { bound } = bindFresh(new CodeAsIdempotencyStore('comments'));
    await bound.appendChain('probe', { id: 'p', bytes: '{}', hash: 'hp-1' }, { kind: 'absent', allocation: '0' });
    await expect(runChainCorpus(bound)).rejects.toThrow(/cas-conflict/);
  });

  it('M9-accept-unknown-token is killed by the authority corpus', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const store = new AcceptUnknownTokenStore('comments', () => now);
    const setNow = (iso: string): void => {
      now = iso;
    };
    await expect(
      runAuthorityCorpus({ store, grant: grantFor(), readGrant: grantFor({ token: 'token-read-1', operations: ['read'] }), setNow }),
    ).rejects.toThrow(/denied|unknown/);
  });

  it('M10-offset-cursor is killed by the read corpus', async () => {
    const { bound } = bindFresh(new LatestHeadStore('comments'));
    await expect(runReadCorpus(bound)).rejects.toThrow(/retained head|hash-e-5/);
  });

  it('M11-record-counting-budget is killed by the read corpus', async () => {
    const { bound } = bindFresh(new RecordCountingStore('comments'));
    await expect(runReadCorpus(bound)).rejects.toThrow(/full encoded page/);
  });

  it('M12-empty-values is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new EmptyValuesStore('comments'));
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/persisted|hello/);
  });

  it('M13-mutable-grant is killed by the authority corpus', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const store = new MutableGrantStore('comments', () => now);
    const setNow = (iso: string): void => {
      now = iso;
    };
    const readGrant = grantFor({ token: 'token-read-1', operations: ['read'] });
    await expect(runAuthorityCorpus({ store, grant: grantFor(), readGrant, setNow })).rejects.toThrow(/denied|forged/);
  });

  it('M14-ignore-aggregate-version is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new IgnoreAggregateVersionStore('comments'));
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/cas-conflict|aggregate-version/);
  });

  it('M15-drop-unsupported-effects is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new DropUnsupportedEffectsStore('comments'));
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/invalid-command|relationship|carrier/);
  });

  it('M16-accept-stale-update is killed by the atomic corpus', async () => {
    const { bound } = bindFresh(new AcceptStaleUpdateStore('comments'));
    await expect(runAtomicCorpus(bound)).rejects.toThrow(/cas-conflict|stale/);
  });

  it('M17-frozen-resume-cursor is killed by the read resume corpus', async () => {
    const { bound } = bindFresh(new FrozenResumeCursorStore('comments'));
    await expect(runReadCursorBudgetCorpus(bound)).rejects.toThrow(/exact full record set/);
  });

  it('M18-candidate-cursor-budget is killed by the read budget corpus', async () => {
    const { bound } = bindFresh(new CandidateCursorBudgetStore('comments'));
    await expect(runReadCursorBudgetCorpus(bound)).rejects.toThrow(/one byte under|refuses the page/);
  });

  it('records every discriminating mutation as killed', () => {
    expect(MUTATION_RECORDS.map((entry) => entry.verdict)).toEqual([
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
