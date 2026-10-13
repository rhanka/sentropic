// K3 gate: ordinary runtime proof (L3a v4.1 frozen §5, §8, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { describe, expect, it } from 'vitest';
import { createKernel } from '../../src/storage/kernel.js';
import type { ScopedRuntime } from '../../src/storage/scope-runtime.js';
import type { ChainBoundaryProvider } from '../../src/storage/tokens.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
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
const sweepIds = ['s0', 's1', 's2'];

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
      while (cursor !== null && guard < 10) {
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
      // Probe without budget pressure: the admission the runtime saw before
      // trimming. Pairing trimmed records with that pre-trim cursor is the
      // frozen-cursor defect: the resume skips the first undelivered record.
      const probe = await inner(chainId, page.records.length + 1, cursor, 1048576);
      if (probe.records.length <= page.records.length || probe.nextCursor === null) return page;
      return { ...page, nextCursor: probe.nextCursor };
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

  it('K3-FIX findIdempotency returns committed receipts', async () => {
    const bound = bindKernel();
    const first = await bound.commitAtomic(appendUnit('idem-chain', 'i1', 'hash-idem-1', null), {
      idempotencyKey: 'find-me',
    });
    const found = await bound.transact({}, async (tx) => {
      const receipt = await tx.findIdempotency('find-me');
      await tx.apply(appendUnit('idem-chain-2', 'i2', 'hash-idem-2', null));
      return receipt;
    });
    expect(found.value?.commitId).toBe(first.commitId);
    const missing = await bound.transact({}, async (tx) => {
      const receipt = await tx.findIdempotency('no-such-key');
      await tx.apply(appendUnit('idem-chain-3', 'i3', 'hash-idem-3', null));
      return receipt;
    });
    expect(missing.value).toBe(null);
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
    const foreign = createKernel({ moduleId: 'comments', cursorSecret: 'k3-test-secret-other' });
    const stranger = foreign.bindNew(writeGrant('token-restart-c'));
    await stranger.appendChain('restart-chain', { id: 'r1', bytes: '{}', hash: 'hash-restart-1' }, { kind: 'absent', allocation: '0' });
    await stranger.appendChain('restart-chain', { id: 'r2', bytes: '{}', hash: 'hash-restart-2' }, { kind: 'head', hash: 'hash-restart-1' });
    await expectCode(
      async () => stranger.readPage('restart-chain', 10, page.nextCursor, 4096),
      'invalid-command',
      'K3-FIX tokens: a cursor sealed under another secret is rejected',
    );
  });
});
