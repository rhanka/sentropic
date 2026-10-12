// K2a discriminating mutations (L3a v4 §16.1): each mutant breaks one
// executable semantic; the shared corpus must kill it. Recorded below.

import { describe, expect, it } from 'vitest';
import type { ChainExpectation } from '../../src/storage/atomic.js';
import { grantFor, runAuthorityCorpus } from './authority-corpus.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus } from './read-corpus.js';
import { TestBoundStore, TestReferenceStore, type ChainRecordInput } from './reference-store.js';

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

export const MUTATION_RECORDS: readonly MutationRecord[] = [
  { id: 'M1-no-cas', brokenSemantic: 'CAS-first appends accept stale heads', corpus: 'atomic', verdict: 'killed' },
  { id: 'M2-no-scope', brokenSemantic: 'operations pass without any authority check', corpus: 'authority', verdict: 'killed' },
  { id: 'M3-no-genesis-conflict', brokenSemantic: 'genesis replays conflicting hashes silently', corpus: 'atomic', verdict: 'killed' },
  { id: 'M4-no-byte-limit', brokenSemantic: 'read pages ignore encoded-byte bounds', corpus: 'read', verdict: 'killed' },
  { id: 'M5-allow-recreate', brokenSemantic: 'disposed chains accept recreation silently', corpus: 'chain', verdict: 'killed' },
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
    ).rejects.toThrow(/lacks write|escalation|read-only/);
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

  it('records every discriminating mutation as killed', () => {
    expect(MUTATION_RECORDS.map((entry) => entry.verdict)).toEqual([
      'killed',
      'killed',
      'killed',
      'killed',
      'killed',
    ]);
  });
});
