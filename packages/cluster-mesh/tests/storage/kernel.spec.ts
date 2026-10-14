// K3 gate: ordinary runtime proof (L3a v4.1 frozen §5, §8, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { describe, expect, it } from 'vitest';
import { createKernel } from '../../src/storage/kernel.js';
import type { ScopedRuntime } from '../../src/storage/scope-runtime.js';
import type { ChainBoundaryProvider } from '../../src/storage/tokens.js';
import type { AtomicUnit, CommitReceipt } from '../../src/storage/atomic.js';
import { appendChainToScope, disposeChainInScope } from '../../src/storage/record-runtime.js';
import { createBackendScopeState } from '../../src/storage/backend.js';
import { validateReadPage } from '../../src/storage/readers.js';
import { runAtomicCorpus, expectCode } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';

const writeGrant = (token: string) => grantFor({ token, operations: ['read', 'write', 'maintain'] });

const bindKernel = () => {
  const kernel = createKernel({ moduleId: 'comments', predicates: { 'pred-k3': () => true } });
  return kernel.bindNew(writeGrant(`token-k3-${Math.random().toString(36).slice(2)}`));
};

const emptyUnit = (): AtomicUnit => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const appendUnit = (chainId: string, id: string, hash: string, head: string | null): AtomicUnit => ({
  ...emptyUnit(),
  appends: [{ chainId, record: { id, bytes: '{"n":1}', hash }, expectation: head === null ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: head } }],
});

describe('K3 runtime: shared ordinary corpora', () => {
  it('K3-RED atomic corpus with predicate positives holds', async () => {
    await runAtomicCorpus(bindKernel(), { predicates: true });
  });

  it('K3-RED chain corpus holds', async () => {
    await runChainCorpus(bindKernel());
  });

  it('K3-RED read corpus holds', async () => {
    await runReadCorpus(bindKernel());
  });

  it('K3-RED cursor-budget corpus holds', async () => {
    await runReadCursorBudgetCorpus(bindKernel());
  });
});

describe('K3 runtime: predicate-positive guards', () => {
  it('K3-RED a well-formed predicate guard commits its carrier', async () => {
    const bound = bindKernel();
    const receipt = await bound.commitAtomic({
      ...appendUnit('pred-chain', 'p1', 'hash-pred-1', null),
      guards: [{ kind: 'predicate', predicateId: 'pred-k3', dependency: 'dep-k3' }],
    });
    expect(receipt.effectiveAppends).toBe(1);
    expect(await bound.readHead('pred-chain')).toBe('hash-pred-1');
  });
});

describe('K3 runtime: ordinary transactions', () => {
  it('K3-RED overlay reads pending writes and isolates direct readers', async () => {
    const bound = bindKernel();
    await bound.appendChain('iso-base', { id: 'b', bytes: '{}', hash: 'hash-iso-0' }, { kind: 'absent', allocation: '0' });
    const { receipt } = await bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('iso-base', 'b2', 'hash-iso-1', 'hash-iso-0'));
      expect(await tx.readHead('iso-base')).toBe('hash-iso-1');
      expect(await bound.readHead('iso-base')).toBe('hash-iso-0');
      return 'ok';
    });
    expect(receipt.effectiveAppends).toBe(1);
    expect(await bound.readHead('iso-base')).toBe('hash-iso-1');
  });

  it('K3-RED a failing guard rolls back the whole transaction', async () => {
    const bound = bindKernel();
    await bound.appendChain('tx-guard', { id: 'g', bytes: '{}', hash: 'hash-g-1' }, { kind: 'absent', allocation: '0' });
    await expectCode(
      async () =>
        bound.transact({}, async (tx) => {
          await tx.apply({ ...appendUnit('tx-guard', 'g2', 'hash-g-2', 'hash-g-1'), guards: [{ kind: 'head', chainId: 'tx-guard', hash: 'wrong-head' }] });
        }),
      'cas-conflict',
      'K3-RED transactions: a failing guard rolls back the whole transaction',
    );
    expect(await bound.readHead('tx-guard')).toBe('hash-g-1');
  });

  it('K3-RED nested failure makes the outer transaction rollback-only', async () => {
    const bound = bindKernel();
    await bound.appendChain('tx-nest', { id: 'n', bytes: '{}', hash: 'hash-n-1' }, { kind: 'absent', allocation: '0' });
    await expectCode(
      async () =>
        bound.transact({}, async (outer) => {
          await outer.apply(appendUnit('tx-nest', 'n2', 'hash-n-2', 'hash-n-1'));
          await bound.transact({}, async (inner) => {
            await inner.apply({ ...emptyUnit(), guards: [{ kind: 'head', chainId: 'tx-nest', hash: 'wrong-head' }] });
          });
        }),
      'cas-conflict',
      'K3-RED transactions: nested failure makes the outer transaction rollback-only',
    );
    expect(await bound.readHead('tx-nest')).toBe('hash-n-1');
  });

  it('K3-RED detached work on a closed context is rejected', async () => {
    const bound = bindKernel();
    let detached: { apply: (unit: object) => Promise<unknown> } | null = null;
    await expectCode(
      async () =>
        bound.transact({}, async (tx) => {
          detached = tx as unknown as { apply: (unit: object) => Promise<unknown> };
        }),
      'invalid-command',
      'K3-RED transactions: an empty transaction commits nothing',
    );
    await expectCode(
      async () => (detached as unknown as { apply: (unit: object) => Promise<unknown> }).apply(emptyUnit()),
      'invalid-command',
      'K3-RED transactions: detached work on a closed context is rejected',
    );
  });
});

const sweepChain = 'r3-sweep';
// Nine single-digit records: positions stay symmetric in token size, and the
// chain is long enough that byte trimming produces non-empty partial pages
// despite ~100-byte self-contained v2 cursors (a 3-record chain would jump
// from full straight to empty and the sweep would prove nothing).
const sweepIds = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

const setupSweepChain = async (bound: ScopedRuntime): Promise<void> => {
  for (let n = 0; n < sweepIds.length; n += 1) {
    await bound.appendChain(
      sweepChain,
      { id: sweepIds[n], bytes: 'x', hash: `hs${n}` },
      n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hs${n - 1}` },
    );
  }
};

const checkPageFits = (
  page: { readonly outcome: 'page' | 'incomplete' | 'inaccessible'; readonly records: readonly unknown[]; readonly nextCursor: unknown },
  limit: number,
  budget: number,
): void => {
  const validity = validateReadPage(
    {
      outcome: page.outcome,
      records: page.records as { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[],
      nextCursor: page.nextCursor as unknown as string | null,
    },
    { maxRecords: limit, maxEncodedBytes: budget },
  );
  if (!validity.ok) throw new Error(`K3-FIX resume: page breaks its budget: ${validity.errors.join('; ')}`);
};

const runResumeSweep = async (bound: ScopedRuntime): Promise<void> => {
  const full = await bound.readPage(sweepChain, 10, null, 4096);
  if (full.outcome !== 'page') throw new Error('K3-FIX resume: the full page is not a page');
  const fullBytes = Buffer.byteLength(
    JSON.stringify({ outcome: full.outcome, records: full.records, nextCursor: full.nextCursor }),
    'utf8',
  );
  // Single-digit positions only: token sizes stay symmetric, so a budget
  // that delivers a first record always lets the resume advance too.
  for (const limit of [10, 2, 1]) {
    for (let budget = fullBytes - 1; budget >= 1; budget -= 1) {
      const first = await bound.readPage(sweepChain, limit, null, budget);
      checkPageFits(first, limit, budget);
      if (first.records.length === 0) {
        if (first.outcome !== 'incomplete') throw new Error('K3-FIX resume: an empty page must be incomplete');
        continue;
      }
      const collected = first.records.map((entry) => entry.id);
      let cursor: unknown = first.nextCursor;
      let guard = 0;
      while (cursor !== null && guard < 16) {
        guard += 1;
        const page = await bound.readPage(sweepChain, limit, cursor, budget);
        checkPageFits(page, limit, budget);
        if (page.records.length === 0) break;
        for (const entry of page.records) collected.push(entry.id);
        cursor = page.nextCursor;
        if (page.outcome === 'page' && page.nextCursor === null) break;
      }
      if (JSON.stringify(collected) !== JSON.stringify(sweepIds)) {
        throw new Error(`K3-FIX resume: expected the exact full record set ${sweepIds.join(',')}, got ${collected.join(',')}`);
      }
    }
  }
};

describe('K3 runtime: R3 full-sweep resume', () => {
  it('K3-FIX every budget and small limits resume the exact full record set', async () => {
    const bound = bindKernel();
    await setupSweepChain(bound);
    await runResumeSweep(bound);
  });
});

describe('K3 discriminating mutants', () => {
  it('K3M1-frozen-resume-cursor is killed by the resume sweep', async () => {
    const bound = bindKernel();
    await setupSweepChain(bound);
    const inner = bound.readPage.bind(bound);
    bound.readPage = (async (chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) => {
      const page = await inner(chainId, limit, cursor, maxEncodedBytes);
      if (page.outcome !== 'incomplete' || page.records.length === 0 || page.nextCursor === null) return page;
      // Frozen-cursor defect: the surviving cursor never advances past the
      // input position, so the resume re-delivers records the caller already
      // holds. The sweep detects the duplicate as a record-set mismatch.
      return { ...page, nextCursor: (cursor as string | null) ?? page.nextCursor };
    }) as ScopedRuntime['readPage'];
    await expect(runResumeSweep(bound)).rejects.toThrow(/exact full record set/);
  });

  it('K3M2-unevaluated-predicates is killed by the predicate guard', async () => {
    const carrier = (chainId: string): AtomicUnit => ({
      ...appendUnit(chainId, 'm1', `hash-${chainId}-1`, null),
      guards: [{ kind: 'predicate', predicateId: 'checked', dependency: 'violated' }],
    });
    const refusesUnevaluated = async (commit: (unit: AtomicUnit) => Promise<unknown>): Promise<boolean> => {
      try {
        await expectCode(() => commit(carrier('mut-pred')), 'cas-conflict', 'kill-probe');
        return true;
      } catch {
        return false;
      }
    };
    const honestKernel = createKernel({ moduleId: 'comments', predicates: { checked: (dependency) => dependency === 'ok' } });
    const honest = honestKernel.bindNew(writeGrant('token-m2-honest-1'));
    const mutantKernel = createKernel({ moduleId: 'comments', predicates: { checked: () => true } });
    const mutant = mutantKernel.bindNew(writeGrant('token-m2-mutant-1'));
    expect(await refusesUnevaluated((unit) => honest.commitAtomic(unit))).toBe(true);
    expect(await refusesUnevaluated((unit) => mutant.commitAtomic(unit))).toBe(false);
  });

  it('K3M3-unsealed-cursors is killed by the forged-cursor refusal', async () => {
    const acceptAll: ChainBoundaryProvider = {
      mint: (record) => `mutant-${record.selection}-${record.position}-${record.head}`,
      verify: (selection, cursor) => {
        if (typeof cursor !== 'string') return null;
        const match = /^mutant-(.+)-(\d+)-(.+)$/.exec(cursor);
        if (!match || match[1] !== selection) return null;
        return { position: Number(match[2]), head: match[3] };
      },
    };
    const setup = async (bound: ScopedRuntime): Promise<void> => {
      await bound.appendChain('tok-mut', { id: 'm1', bytes: '{}', hash: 'hash-tok-mut-1' }, { kind: 'absent', allocation: '0' });
    };
    const refusesForged = async (bound: ScopedRuntime): Promise<boolean> => {
      try {
        await expectCode(
          () => bound.readPage('tok-mut', 10, 'mutant-tok-mut-0-hash-tok-mut-1', 4096),
          'invalid-command',
          'kill-probe',
        );
        return true;
      } catch {
        return false;
      }
    };
    const honest = createKernel({ moduleId: 'comments' }).bindNew(writeGrant('token-m3-honest-1'));
    await setup(honest);
    const mutant = createKernel({ moduleId: 'comments', boundaryProvider: acceptAll }).bindNew(
      writeGrant('token-m3-mutant-1'),
    );
    await setup(mutant);
    expect(await refusesForged(honest)).toBe(true);
    expect(await refusesForged(mutant)).toBe(false);
  });
});

describe('K3 runtime: dependent writes and isolation', () => {
  it('K3-FIX dependent writes in one transaction commit together', async () => {
    const bound = bindKernel();
    const { receipt } = await bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('dep-chain', 'd1', 'hash-dep-1', null));
      await tx.apply(appendUnit('dep-chain', 'd2', 'hash-dep-2', 'hash-dep-1'));
      return 'ok';
    });
    expect(receipt.effectiveAppends).toBe(2);
    expect(await bound.readHead('dep-chain')).toBe('hash-dep-2');
  });

  it('K3-FIX concurrent transactions stay isolated', async () => {
    const bound = bindKernel();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('conc-a', 'a1', 'hash-conc-a1', null));
      await gate;
      return 'first';
    });
    const second = await bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('conc-b', 'b1', 'hash-conc-b1', null));
      release();
      return 'second';
    });
    const settled = await first;
    expect(settled.value).toBe('first');
    expect(second.value).toBe('second');
    expect(settled.receipt.effectiveAppends).toBe(1);
    expect(second.receipt.effectiveAppends).toBe(1);
    expect(await bound.readHead('conc-a')).toBe('hash-conc-a1');
    expect(await bound.readHead('conc-b')).toBe('hash-conc-b1');
  });

  it('K3-FIX a swallowed nested failure keeps the outer rollback-only', async () => {
    const bound = bindKernel();
    await bound.appendChain('tx-swallow', { id: 's', bytes: '{}', hash: 'hash-s-1' }, { kind: 'absent', allocation: '0' });
    let failure: unknown = null;
    try {
      await bound.transact({}, async (outer) => {
        await outer.apply(appendUnit('tx-swallow', 's2', 'hash-s-2', 'hash-s-1'));
        try {
          await bound.transact({}, async () => {
            throw new Error('boom-without-apply');
          });
        } catch {
          // Swallowed by the caller on purpose.
        }
        return 'outer-value';
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).not.toBe(null);
    expect(await bound.readHead('tx-swallow')).toBe('hash-s-1');
  });
});

describe('K3 runtime: evaluated predicates', () => {
  it('K3-FIX a failing predicate guard rolls back its carrier', async () => {
    const kernel = createKernel({ moduleId: 'comments', predicates: { 'deny-all': () => false } });
    const bound = kernel.bindNew(writeGrant('token-pred-neg-1'));
    await expectCode(
      async () =>
        bound.commitAtomic({
          ...appendUnit('pred-neg', 'n1', 'hash-pred-neg-1', null),
          guards: [{ kind: 'predicate', predicateId: 'deny-all', dependency: 'dep-x' }],
        }),
      'cas-conflict',
      'K3-FIX predicates: a failing predicate guard rolls back its carrier',
    );
    expect(await bound.readHead('pred-neg')).toBe(null);
  });

  it('K3-FIX an unknown predicate is explicitly refused', async () => {
    const kernel = createKernel({ moduleId: 'comments', predicates: {} });
    const bound = kernel.bindNew(writeGrant('token-pred-unknown-1'));
    await expectCode(
      async () =>
        bound.commitAtomic({
          ...appendUnit('pred-unknown', 'u1', 'hash-pred-unknown-1', null),
          guards: [{ kind: 'predicate', predicateId: 'no-such-pred', dependency: 'dep-x' }],
        }),
      'unsupported-profile',
      'K3-FIX predicates: an unregistered predicate is explicitly refused',
    );
    expect(await bound.readHead('pred-unknown')).toBe(null);
  });
});

describe('K3 runtime: transaction reads', () => {
  it('K3-FIX pending writes are visible to transaction reads', async () => {
    const bound = bindKernel();
    const { receipt } = await bound.transact({}, async (tx) => {
      await tx.apply({
        ...emptyUnit(),
        appends: [
          {
            chainId: 'rd-chain',
            record: { id: 'r1', bytes: '{}', hash: 'hash-rd-1' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
        records: [{ key: 'rec-rd', bytes: { format: 'utf8', data: 'hi' }, contentHash: 'h-rd' }],
        updates: [{ key: 'agg-rd', version: 1, value: { format: 'utf8', data: 'v1' } }],
      });
      expect(await tx.readHead('rd-chain')).toBe('hash-rd-1');
      expect((await tx.readChain('rd-chain')).map((entry) => entry.id)).toEqual(['r1']);
      expect(await tx.readRecord('rec-rd')).toEqual({ bytes: { format: 'utf8', data: 'hi' }, contentHash: 'h-rd' });
      expect(await tx.readAggregate('agg-rd')).toEqual({ version: 1, value: { format: 'utf8', data: 'v1' } });
      await tx.apply({
        ...emptyUnit(),
        guards: [{ kind: 'aggregate-version', key: 'agg-rd', version: 1 }],
        appends: [
          {
            chainId: 'rd-chain',
            record: { id: 'r2', bytes: '{}', hash: 'hash-rd-2' },
            expectation: { kind: 'head', hash: 'hash-rd-1' },
          },
        ],
      });
      return 'ok';
    });
    expect(receipt.effectiveAppends).toBe(2);
    expect(await bound.readHead('rd-chain')).toBe('hash-rd-2');
  });

  it('K3-FIX findIdempotency reads the command index with read-your-writes', async () => {
    const bound = bindKernel();
    await bound.commitAtomic({
      ...appendUnit('idem-chain', 'i1', 'hash-idem-1', null),
      indexWrites: [{ key: 'find-me', digest: 'digest-1', resultIds: ['r1'], resultHash: null }],
    });
    const found = await bound.transact({}, async (tx) => {
      const entry = await tx.findIdempotency({ key: 'find-me' });
      await tx.apply(appendUnit('idem-chain-2', 'i2', 'hash-idem-2', null));
      return entry;
    });
    expect(found.value).toEqual({ digest: 'digest-1', resultIds: ['r1'], resultHash: null });
    const pending = await bound.transact({}, async (tx) => {
      await tx.apply({
        ...emptyUnit(),
        indexWrites: [{ key: 'find-pending', digest: 'digest-p', resultIds: ['rp'], resultHash: 'h' }],
      });
      return tx.findIdempotency({ key: 'find-pending' });
    });
    expect(pending.value).toEqual({ digest: 'digest-p', resultIds: ['rp'], resultHash: 'h' });
    const missing = await bound.transact({}, async (tx) => {
      const entry = await tx.findIdempotency({ key: 'no-such-key' });
      await tx.apply(appendUnit('idem-chain-3', 'i3', 'hash-idem-3', null));
      return entry;
    });
    expect(missing.value).toBe(null);
  });

  it('K3-FIX readRecords reads pending writes within bounds', async () => {
    const bound = bindKernel();
    await bound.commitAtomic({
      ...emptyUnit(),
      records: [{ key: 'rec-base', bytes: { format: 'utf8', data: 'base' }, contentHash: 'h-base' }],
    });
    const seen = await bound.transact({}, async (tx) => {
      await tx.apply({
        ...emptyUnit(),
        records: [{ key: 'rec-tx', bytes: { format: 'utf8', data: 'tx' }, contentHash: 'h-tx' }],
      });
      const rows = await tx.readRecords(['rec-base', 'rec-tx', 'rec-absent'], { maxRecords: 3, maxEncodedBytes: 4096 });
      await expectCode(() => tx.readRecords(['a', 'b'], { maxRecords: 1, maxEncodedBytes: 4096 }), 'invalid-command', 'K3-FIX reads: record reads beyond maxRecords are refused');
      return rows;
    });
    expect(seen.value[0]).toEqual({ key: 'rec-base', bytes: { format: 'utf8', data: 'base' }, contentHash: 'h-base' });
    expect(seen.value[1]).toEqual({ key: 'rec-tx', bytes: { format: 'utf8', data: 'tx' }, contentHash: 'h-tx' });
    expect(seen.value[2]).toBe(null);
  });

  it('K3-FIX fenced commits are explicitly refused', async () => {
    const bound = bindKernel();
    await expectCode(
      async () =>
        bound.commitAtomic(appendUnit('fence-chain', 'f1', 'hash-fence-1', null), {
          fence: { fenceId: 'fence-k3', epoch: '1' },
        }),
      'unsupported-profile',
      'K3-FIX fences: a fenced commit is explicitly refused',
    );
    expect(await bound.readHead('fence-chain')).toBe(null);
  });
});

describe('K3 runtime: disposed content', () => {
  it('K3-FIX disposed chains deny getters and leak no continuation', async () => {
    const bound = bindKernel();
    await bound.appendChain(
      'disposed-plain',
      { id: 'dp1', bytes: '{"plain":1}', hash: 'hash-disposed-plain-1' },
      { kind: 'absent', allocation: '0' },
    );
    const acquired = await bound.readPage('disposed-plain', 1, null, 4096);
    expect(acquired.outcome).toBe('page');
    await bound.disposeChain('disposed-plain');
    await expectCode(
      async () => bound.readHead('disposed-plain'),
      'denied',
      'K3-FIX disposal: a disposed chain head throws denied',
    );
    await expectCode(
      async () => bound.readChain('disposed-plain'),
      'denied',
      'K3-FIX disposal: a disposed chain throws denied',
    );
    const after = await bound.readPage('disposed-plain', 1, acquired.nextCursor, 4096);
    expect(after.outcome).toBe('inaccessible');
    expect(after.records.length).toBe(0);
    expect(after.nextCursor).toBe(null);
    const fresh = await bound.readPage('disposed-plain', 10, null, 4096);
    expect(fresh.outcome).toBe('inaccessible');
    expect(fresh.records.length).toBe(0);
    expect(fresh.nextCursor).toBe(null);
  });
});

describe('K3 runtime: token-bound cursors', () => {
  it('K3-RED forged, tampered and cross-chain cursors are rejected', async () => {
    const bound = bindKernel();
    await bound.appendChain('tok-a', { id: 'a1', bytes: '{}', hash: 'hash-tok-a1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('tok-a', { id: 'a2', bytes: '{}', hash: 'hash-tok-a2' }, { kind: 'head', hash: 'hash-tok-a1' });
    await bound.appendChain('tok-a', { id: 'a3', bytes: '{}', hash: 'hash-tok-a3' }, { kind: 'head', hash: 'hash-tok-a2' });
    await bound.appendChain('tok-b', { id: 'b1', bytes: '{}', hash: 'hash-tok-b1' }, { kind: 'absent', allocation: '0' });
    const page = await bound.readPage('tok-a', 1, null, 4096);
    expect(page.outcome).toBe('page');
    expect(page.nextCursor).not.toBe(null);
    await expectCode(async () => bound.readPage('tok-a', 10, 'forged-cursor', 4096), 'invalid-command', 'K3-RED tokens: a forged cursor is explicitly rejected');
    const owned = page.nextCursor as unknown as string;
    expect(typeof owned).toBe('string');
    expect(owned).not.toContain('hash-tok-a1');
    const tampered = `${owned.slice(0, -1)}${owned.endsWith('A') ? 'B' : 'A'}`;
    await expectCode(async () => bound.readPage('tok-a', 10, tampered, 4096), 'invalid-command', 'K3-RED tokens: a tampered cursor is rejected');
    await expectCode(async () => bound.readPage('tok-b', 10, owned, 4096), 'invalid-command', 'K3-RED tokens: a cross-chain cursor is rejected');
  });

  it('K3-FIX cursors survive a restart with the same secret', async () => {
    const secret = 'k3-test-secret-restart';
    const first = createKernel({ moduleId: 'comments', cursorSecret: secret });
    const before = first.bindNew(writeGrant('token-restart-a'));
    await before.appendChain('restart-chain', { id: 'r1', bytes: '{}', hash: 'hash-restart-1' }, { kind: 'absent', allocation: '0' });
    await before.appendChain('restart-chain', { id: 'r2', bytes: '{}', hash: 'hash-restart-2' }, { kind: 'head', hash: 'hash-restart-1' });
    const page = await before.readPage('restart-chain', 1, null, 4096);
    expect(page.outcome).toBe('page');
    const second = createKernel({ moduleId: 'comments', cursorSecret: secret });
    const after = second.bindNew(writeGrant('token-restart-b'));
    await after.appendChain('restart-chain', { id: 'r1', bytes: '{}', hash: 'hash-restart-1' }, { kind: 'absent', allocation: '0' });
    await after.appendChain('restart-chain', { id: 'r2', bytes: '{}', hash: 'hash-restart-2' }, { kind: 'head', hash: 'hash-restart-1' });
    const resumed = await after.readPage('restart-chain', 10, page.nextCursor, 4096);
    expect(resumed.outcome).toBe('page');
    expect(resumed.records.map((entry) => entry.id)).toEqual(['r2']);
  });

  it('K3-FIX a changed incarnation or key yields explicit incomplete, never invalid-command', async () => {
    const secret = 'k3-test-secret-incarnation';
    const first = createKernel({ moduleId: 'comments', incarnation: 'store-1', cursorSecret: secret });
    const before = first.bindNew(writeGrant('token-incarn-a'));
    await before.appendChain('incarn-chain', { id: 'r1', bytes: '{}', hash: 'hash-incarn-1' }, { kind: 'absent', allocation: '0' });
    await before.appendChain('incarn-chain', { id: 'r2', bytes: '{}', hash: 'hash-incarn-2' }, { kind: 'head', hash: 'hash-incarn-1' });
    const page = await before.readPage('incarn-chain', 1, null, 4096);
    expect(page.outcome).toBe('page');
    expect(page.nextCursor).not.toBe(null);
    const rebuild = async (bound: ScopedRuntime): Promise<void> => {
      await bound.appendChain('incarn-chain', { id: 'r1', bytes: '{}', hash: 'hash-incarn-1' }, { kind: 'absent', allocation: '0' });
      await bound.appendChain('incarn-chain', { id: 'r2', bytes: '{}', hash: 'hash-incarn-2' }, { kind: 'head', hash: 'hash-incarn-1' });
    };
    // Same secret, new incarnation: the boundary is unknown, reported as an
    // explicit incomplete result with no recovery position.
    const moved = createKernel({ moduleId: 'comments', incarnation: 'store-2', cursorSecret: secret });
    const movedBound = moved.bindNew(writeGrant('token-incarn-b'));
    await rebuild(movedBound);
    const unknownIncarnation = await movedBound.readPage('incarn-chain', 10, page.nextCursor, 4096);
    expect(unknownIncarnation.outcome).toBe('incomplete');
    expect(unknownIncarnation.records).toEqual([]);
    expect(unknownIncarnation.nextCursor).toBe(null);
    // Same incarnation, rotated secret: same explicit outcome.
    const rotated = createKernel({ moduleId: 'comments', incarnation: 'store-1', cursorSecret: 'k3-test-secret-other' });
    const rotatedBound = rotated.bindNew(writeGrant('token-incarn-c'));
    await rebuild(rotatedBound);
    const unknownKey = await rotatedBound.readPage('incarn-chain', 10, page.nextCursor, 4096);
    expect(unknownKey.outcome).toBe('incomplete');
    expect(unknownKey.records).toEqual([]);
    expect(unknownKey.nextCursor).toBe(null);
    // Default key without a configured secret: a restart retires the random
    // key, so pre-restart cursors read as unknown boundaries, documented here.
    const ephemeral = createKernel({ moduleId: 'comments' });
    const ephemeralBound = ephemeral.bindNew(writeGrant('token-incarn-d'));
    await ephemeralBound.appendChain('incarn-chain', { id: 'r1', bytes: '{}', hash: 'hash-incarn-1' }, { kind: 'absent', allocation: '0' });
    await ephemeralBound.appendChain('incarn-chain', { id: 'r2', bytes: '{}', hash: 'hash-incarn-2' }, { kind: 'head', hash: 'hash-incarn-1' });
    const ephemeralPage = await ephemeralBound.readPage('incarn-chain', 1, null, 4096);
    expect(ephemeralPage.outcome).toBe('page');
    expect(ephemeralPage.nextCursor).not.toBe(null);
    const restarted = createKernel({ moduleId: 'comments' });
    const restartedBound = restarted.bindNew(writeGrant('token-incarn-e'));
    await restartedBound.appendChain('incarn-chain', { id: 'r1', bytes: '{}', hash: 'hash-incarn-1' }, { kind: 'absent', allocation: '0' });
    await restartedBound.appendChain('incarn-chain', { id: 'r2', bytes: '{}', hash: 'hash-incarn-2' }, { kind: 'head', hash: 'hash-incarn-1' });
    const retired = await restartedBound.readPage('incarn-chain', 10, ephemeralPage.nextCursor, 4096);
    expect(retired.outcome).toBe('incomplete');
    expect(retired.records).toEqual([]);
    expect(retired.nextCursor).toBe(null);
  });

  it('K3-FIX repeated head hashes deliver every record without redirecting', async () => {
    const bound = bindKernel();
    // §9.3 CAS-only chains carry no canonical link: the same hash twice is legal.
    await bound.appendChain('repeat-chain', { id: 'q1', bytes: '{"n":1}', hash: 'hash-repeat' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('repeat-chain', { id: 'q2', bytes: '{"n":2}', hash: 'hash-repeat' }, { kind: 'head', hash: 'hash-repeat' });
    const full = await bound.readPage('repeat-chain', 10, null, 4096);
    expect(full.outcome).toBe('page');
    expect(full.records.map((entry) => entry.id)).toEqual(['q1', 'q2']);
    expect(full.nextCursor).toBe(null);
    const first = await bound.readPage('repeat-chain', 1, null, 4096);
    expect(first.records.map((entry) => entry.id)).toEqual(['q1']);
    expect(first.nextCursor).not.toBe(null);
    const second = await bound.readPage('repeat-chain', 1, first.nextCursor, 4096);
    expect(second.records.map((entry) => entry.id)).toEqual(['q2']);
    expect(second.outcome).toBe('page');
    expect(second.nextCursor).toBe(null);
    // A cursor sealed before the chain grows stays at its sealed boundary:
    // resuming never redirects to the grown head.
    const lone = bindKernel();
    await lone.appendChain('repeat-solo', { id: 's1', bytes: '{"n":1}', hash: 'hash-solo-1' }, { kind: 'absent', allocation: '0' });
    await lone.appendChain('repeat-solo', { id: 's2', bytes: '{"n":2}', hash: 'hash-solo-2' }, { kind: 'head', hash: 'hash-solo-1' });
    const soloFirst = await lone.readPage('repeat-solo', 1, null, 4096);
    expect(soloFirst.records.map((entry) => entry.id)).toEqual(['s1']);
    expect(soloFirst.nextCursor).not.toBe(null);
    await lone.appendChain('repeat-solo', { id: 's3', bytes: '{"n":3}', hash: 'hash-solo-3' }, { kind: 'head', hash: 'hash-solo-2' });
    const sealed = await lone.readPage('repeat-solo', 10, soloFirst.nextCursor, 4096);
    expect(sealed.records.map((entry) => entry.id)).toEqual(['s2']);
    expect(sealed.nextCursor).toBe(null);
  });

  it('K3-FIX cursor tokens bind the sealed boundary and expose tampering', async () => {
    const bound = bindKernel();
    await bound.appendChain('tok-a', { id: 'a1', bytes: '{}', hash: 'hash-tok-a1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('tok-a', { id: 'a2', bytes: '{}', hash: 'hash-tok-a2' }, { kind: 'head', hash: 'hash-tok-a1' });
    await bound.appendChain('tok-a', { id: 'a3', bytes: '{}', hash: 'hash-tok-a3' }, { kind: 'head', hash: 'hash-tok-a2' });
    const page = await bound.readPage('tok-a', 1, null, 4096);
    const owned = page.nextCursor as unknown as string;
    const parts = JSON.parse(Buffer.from(owned, 'base64url').toString('utf8')) as unknown[];
    // Cursor v2: the exact head, its sequence and the allocation travel
    // integrity-protected in the token, never hidden.
    expect(parts[0]).toBe(2);
    expect(parts[2]).toBe('hash-tok-a3');
    expect(parts[3]).toBe(2);
    const tamper = (index: number, value: unknown): string => {
      const forged = [...parts];
      forged[index] = value;
      return Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    };
    await expectCode(async () => bound.readPage('tok-a', 10, tamper(2, 'hash-tok-a1'), 4096), 'invalid-command', 'K3-FIX tokens: a rebound head breaks the seal');
    await expectCode(async () => bound.readPage('tok-a', 10, tamper(3, 0), 4096), 'invalid-command', 'K3-FIX tokens: a rebound sequence breaks the seal');
    await expectCode(async () => bound.readPage('tok-a', 10, tamper(4, '99'), 4096), 'invalid-command', 'K3-FIX tokens: a rebound allocation breaks the seal');
  });
});

describe('K3 runtime: detached and unauthorized transaction work', () => {
  it('K3-FIX a detached transact on a closed overlay is refused', async () => {
    const bound = bindKernel();
    let late: Promise<unknown> | null = null;
    await bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('detached-tx', 'd1', 'hash-detached-1', null));
      // Deferred past the commit: inherits the closed overlay via ALS.
      setTimeout(() => {
        late = bound.transact({}, async (inner) => {
          await inner.apply(appendUnit('detached-tx', 'd2', 'hash-detached-2', 'hash-detached-1'));
          return 'late';
        });
      }, 0);
      return 'ok';
    });
    while (late === null) await new Promise((resolve) => setTimeout(resolve, 5));
    await expectCode(
      () => late as unknown as Promise<unknown>,
      'invalid-command',
      'K3-FIX transactions: a detached transact on a closed overlay is refused',
    );
    expect(await bound.readHead('detached-tx')).toBe('hash-detached-1');
  });

  it('K3-FIX transaction reads require the read operation', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const writer = kernel.bindNew(grantFor({ token: 'token-write-only-1', operations: ['write'] }));
    await writer.appendChain('wo-chain', { id: 'w', bytes: '{}', hash: 'hash-wo-1' }, { kind: 'absent', allocation: '0' });
    await expectCode(
      async () => writer.readHead('wo-chain'),
      'denied',
      'K3-FIX transactions: a write-only grant cannot read directly',
    );
    await expectCode(
      async () =>
        writer.transact({}, async (tx) => {
          await tx.readHead('wo-chain');
        }),
      'denied',
      'K3-FIX transactions: a write-only grant cannot read through its transaction',
    );
    expect(await kernel.bindNew(grantFor({ token: 'token-write-only-2', operations: ['read', 'write'] })).readHead('wo-chain')).toBe('hash-wo-1');
  });

  it('K3-FIX revocation mid-callback denies later transaction reads', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const bound = kernel.bindNew(grantFor({ token: 'token-revoke-mid-1' }));
    await bound.appendChain('rev-chain', { id: 'v', bytes: '{}', hash: 'hash-rev-1' }, { kind: 'absent', allocation: '0' });
    await expectCode(
      async () =>
        bound.transact({}, async (tx) => {
          expect(await tx.readHead('rev-chain')).toBe('hash-rev-1');
          kernel.revoke('token-revoke-mid-1');
          await tx.readHead('rev-chain');
        }),
      'denied',
      'K3-FIX transactions: revocation mid-callback denies later transaction reads',
    );
    expect(await kernel.bindNew(grantFor({ token: 'token-revoke-mid-2' })).readHead('rev-chain')).toBe('hash-rev-1');
  });
});

describe('K3 runtime: single-apply dependents and commit races', () => {
  it('K3-FIX one apply can create then append on the created chain', async () => {
    const bound = bindKernel();
    const { receipt } = await bound.transact({}, async (tx) => {
      await tx.apply({
        ...emptyUnit(),
        appends: [
          { chainId: 'solo-dep', record: { id: 'e1', bytes: '{}', hash: 'hash-solo-1' }, expectation: { kind: 'absent', allocation: '0' } },
          { chainId: 'solo-dep', record: { id: 'e2', bytes: '{}', hash: 'hash-solo-2' }, expectation: { kind: 'head', hash: 'hash-solo-1' } },
        ],
      });
      return 'ok';
    });
    expect(receipt.effectiveAppends).toBe(2);
    expect(await bound.readHead('solo-dep')).toBe('hash-solo-2');
    await expectCode(
      async () =>
        bound.transact({}, async (tx) => {
          await tx.apply({
            ...emptyUnit(),
            appends: [
              { chainId: 'solo-dep-2', record: { id: 'f1', bytes: '{}', hash: 'hash-fail-1' }, expectation: { kind: 'absent', allocation: '0' } },
              { chainId: 'solo-dep-2', record: { id: 'f2', bytes: '{}', hash: 'hash-fail-2' }, expectation: { kind: 'head', hash: 'wrong-head' } },
            ],
          });
        }),
      'cas-conflict',
      'K3-FIX transactions: a broken dependent pair rolls back the creation too',
    );
    expect(await bound.readHead('solo-dep-2')).toBe(null);
  });

  it('K3-FIX a commit-time head race on one chain conflicts the loser', async () => {
    const bound = bindKernel();
    await bound.appendChain('race-chain', { id: 'r0', bytes: '{}', hash: 'hash-race-0' }, { kind: 'absent', allocation: '0' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loser = bound.transact({}, async (tx) => {
      await tx.apply(appendUnit('race-chain', 'l1', 'hash-race-loser', 'hash-race-0'));
      await gate;
      return 'loser';
    });
    await bound.appendChain('race-chain', { id: 'w1', bytes: '{}', hash: 'hash-race-winner' }, { kind: 'head', hash: 'hash-race-0' });
    release();
    await expectCode(() => loser, 'cas-conflict', 'K3-FIX transactions: a stale commit-time head conflicts');
    expect(await bound.readHead('race-chain')).toBe('hash-race-winner');
  });

  it('K3-FIX two handles of one scope join a single commit', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
    const first = kernel.bindNew(grantFor({ token: 'token-join-a', scope }));
    const second = kernel.bindNew(grantFor({ token: 'token-join-b', scope }));
    const outer = await first.transact({}, async () => {
      const inner = await second.transact({}, async (tx) => {
        await tx.apply(appendUnit('join-chain', 'j1', 'hash-join-1', null));
        return 'inner';
      });
      expect(inner.value).toBe('inner');
      return 'outer';
    });
    expect(outer.value).toBe('outer');
    expect(outer.receipt.effectiveAppends).toBe(1);
    expect(await first.readHead('join-chain')).toBe('hash-join-1');
  });

  it('K3-FIX joined receipts are frozen snapshots', async () => {
    const bound = bindKernel();
    let provisional: CommitReceipt | null = null;
    const outer = await bound.transact({}, async () => {
      const inner = await bound.transact({}, async (tx) => {
        await tx.apply(appendUnit('snap-chain', 'p1', 'hash-snap-1', null));
        return 'inner';
      });
      provisional = inner.receipt;
      // Provisional at return time: the outer commit has not run yet.
      expect(inner.receipt.effectiveAppends).toBe(0);
      (inner.receipt as unknown as { effectiveAppends: number }).effectiveAppends = 99;
      return 'outer';
    });
    // Mutating the copy cannot touch the commit, and the commit cannot
    // rewrite the previously returned copy.
    expect(outer.receipt.effectiveAppends).toBe(1);
    expect(provisional?.effectiveAppends).toBe(99);
  });
});

describe('K3 runtime: scope-bound predicates', () => {
  it('K3-FIX predicates observe scope and pending writes', async () => {
    const seen: Array<{ workspaceId: string; head: string | null }> = [];
    const kernel = createKernel({
      moduleId: 'comments',
      predicates: {
        'scope-aware': (dependency, ctx) => {
          seen.push({ workspaceId: ctx.scope.workspaceId, head: ctx.view.readHead('pred-scope-chain') });
          return ctx.scope.workspaceId === 'workspace-a' && dependency === 'ok';
        },
      },
    });
    const allowed = kernel.bindNew(grantFor({ token: 'token-pred-scope-a' }));
    await allowed.transact({}, async (tx) => {
      await tx.apply(appendUnit('pred-scope-chain', 'a1', 'hash-ps-1', null));
      await tx.apply({
        ...appendUnit('pred-scope-chain', 'a2', 'hash-ps-2', 'hash-ps-1'),
        guards: [{ kind: 'predicate', predicateId: 'scope-aware', dependency: 'ok' }],
      });
      return 'ok';
    });
    // Apply-time evaluation already saw the pending head (read-your-writes),
    // and the commit re-evaluated the same guard against the staged state.
    expect(seen).toEqual([
      { workspaceId: 'workspace-a', head: 'hash-ps-1' },
      { workspaceId: 'workspace-a', head: 'hash-ps-1' },
    ]);
    const other = kernel.bindNew(grantFor({ token: 'token-pred-scope-b', scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' } }));
    await expectCode(
      async () =>
        other.commitAtomic({
          ...appendUnit('pred-scope-other', 'b1', 'hash-ps-b1', null),
          guards: [{ kind: 'predicate', predicateId: 'scope-aware', dependency: 'ok' }],
        }),
      'cas-conflict',
      'K3-FIX predicates: the same dependency refuses in another scope',
    );
    expect(await other.readHead('pred-scope-other')).toBe(null);
  });

  it('K3-FIX guards are re-evaluated at commit time', async () => {
    let gateOpen = true;
    const kernel = createKernel({ moduleId: 'comments', predicates: { flip: () => gateOpen } });
    const bound = kernel.bindNew(grantFor({ token: 'token-pred-flip-1' }));
    await expectCode(
      async () =>
        bound.transact({}, async (tx) => {
          await tx.apply({
            ...appendUnit('flip-chain', 'g1', 'hash-flip-1', null),
            guards: [{ kind: 'predicate', predicateId: 'flip', dependency: 'x' }],
          });
          gateOpen = false;
          return 'ok';
        }),
      'cas-conflict',
      'K3-FIX predicates: a guard true at apply but false at commit refuses',
    );
    expect(await bound.readHead('flip-chain')).toBe(null);
  });
});

describe('K3 runtime: storage-boundary isolation', () => {
  it('K3-FIX caller-side mutation after commit cannot alter canonical state', async () => {
    const bound = bindKernel();
    const mutableBytes: { format: 'utf8'; data: string } = { format: 'utf8', data: 'original' };
    const mutableIds: string[] = ['kept'];
    const mutableValue: { format: 'utf8'; data: string } = { format: 'utf8', data: 'v1' };
    await bound.commitAtomic({
      ...emptyUnit(),
      records: [{ key: 'alias-rec', bytes: mutableBytes, contentHash: 'h-alias' }],
      updates: [{ key: 'alias-agg', version: 1, value: mutableValue }],
      indexWrites: [{ key: 'alias-idx', digest: 'd', resultIds: mutableIds, resultHash: null }],
    });
    mutableBytes.data = 'mutated';
    mutableIds.push('evil');
    mutableValue.data = 'mutated';
    expect((await bound.readRecord('alias-rec'))?.bytes.data).toBe('original');
    expect((await bound.readAggregate('alias-agg'))?.value.data).toBe('v1');
    expect(await bound.indexGet('alias-idx')).toEqual({ digest: 'd', resultIds: ['kept'], resultHash: null });
    const first = await bound.commitAtomic(appendUnit('alias-chain', 'a1', 'hash-alias-1', null), { idempotencyKey: 'alias-key' });
    (first as unknown as { effectiveAppends: number }).effectiveAppends = 999;
    const replayed = await bound.commitAtomic(appendUnit('alias-chain', 'a1', 'hash-alias-1', null), { idempotencyKey: 'alias-key' });
    expect(replayed.effectiveAppends).toBe(1);
  });

  it('K3-FIX commit preflight refuses without effects', async () => {
    const bound = bindKernel();
    await expectCode(
      async () =>
        bound.commitAtomic({
          ...appendUnit('pre-guard', 'g1', 'hash-pre-1', null),
          guards: [{ kind: 'no-such-guard' } as unknown as AtomicUnit['guards'][number]],
        }),
      'invalid-command',
      'K3-FIX preflight: an unknown guard kind is refused',
    );
    await expectCode(
      async () =>
        bound.commitAtomic({
          ...emptyUnit(),
          records: [{ key: 'bad-rec', bytes: { format: 'nope', data: 'x' } as unknown as { format: 'utf8'; data: string }, contentHash: 'h' }],
        }),
      'invalid-command',
      'K3-FIX preflight: a record with invalid encoded bytes is refused',
    );
    await expectCode(
      async () =>
        bound.commitAtomic(
          {
            ...emptyUnit(),
            records: [{ key: 'big-rec', bytes: { format: 'utf8', data: 'y'.repeat(200) }, contentHash: 'h' }],
          },
          { limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 10 } },
        ),
      'invalid-command',
      'K3-FIX preflight: a merged unit over the byte budget is refused',
    );
    expect(await bound.readHead('pre-guard')).toBe(null);
    expect(await bound.readRecord('bad-rec')).toBe(null);
    expect(await bound.readRecord('big-rec')).toBe(null);
  });

  it('K3-FIX disposal erases payload bytes but retains status', async () => {
    const state = createBackendScopeState();
    appendChainToScope(state, 'm9-chain', { id: 'm1', bytes: '{"secret":true}', hash: 'h-m9' }, { kind: 'absent', allocation: '0' });
    appendChainToScope(state, 'm9-chain', { id: 'm2', bytes: '{"more":true}', hash: 'h-m9-2' }, { kind: 'head', hash: 'h-m9' });
    disposeChainInScope(state, 'm9-chain');
    const chain = state.chains.get('m9-chain');
    expect(chain?.disposed).toBe(true);
    expect(chain?.head).toBe('h-m9-2');
    expect(chain?.allocation).toBe('2');
    expect(chain?.records.map((entry) => entry.bytes)).toEqual(['', '']);
    expect(chain?.records.map((entry) => entry.hash)).toEqual(['h-m9', 'h-m9-2']);
  });

  it('K3-FIX an absent boundary keeps its recovery cursor only within budget', async () => {
    const secret = 'k3-test-secret-absent';
    const first = createKernel({ moduleId: 'comments', cursorSecret: secret });
    const before = first.bindNew(writeGrant('token-absent-a'));
    await before.appendChain('absent-chain', { id: 'r1', bytes: '{}', hash: 'hash-absent-1' }, { kind: 'absent', allocation: '0' });
    await before.appendChain('absent-chain', { id: 'r2', bytes: '{}', hash: 'hash-absent-2' }, { kind: 'head', hash: 'hash-absent-1' });
    const page = await before.readPage('absent-chain', 1, null, 4096);
    expect(page.outcome).toBe('page');
    expect(page.nextCursor).not.toBe(null);
    // Restart with the same secret but without the chain: the sealed
    // boundary is absent (resync pending). The retained cursor is the
    // recovery position when it fits the budget, else the floor applies.
    const second = createKernel({ moduleId: 'comments', cursorSecret: secret });
    const after = second.bindNew(writeGrant('token-absent-b'));
    const retained = await after.readPage('absent-chain', 10, page.nextCursor, 4096);
    expect(retained.outcome).toBe('incomplete');
    expect(retained.records).toEqual([]);
    expect(retained.nextCursor).toBe(page.nextCursor);
    const floored = await after.readPage('absent-chain', 10, page.nextCursor, 1);
    expect(floored.outcome).toBe('incomplete');
    expect(floored.records).toEqual([]);
    expect(floored.nextCursor).toBe(null);
    const validity = validateReadPage(
      { outcome: floored.outcome, records: floored.records, nextCursor: floored.nextCursor },
      { maxRecords: 10, maxEncodedBytes: 1 },
    );
    expect(validity.ok).toBe(true);
  });
});
