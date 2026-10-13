// K3 gate: ordinary runtime proof (L3a v4.1 frozen §5, §8, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { describe, expect, it } from 'vitest';
import { createKernel } from '../../src/storage/kernel.js';
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
    await bound.transact({}, async (tx) => {
      detached = tx as unknown as { apply: (unit: object) => Promise<unknown> };
    });
    await expectCode(
      async () => (detached as unknown as { apply: (unit: object) => Promise<unknown> }).apply(emptyUnit()),
      'invalid-command',
      'K3-RED transactions: detached work on a closed context is rejected',
    );
  });
});

describe('K3 runtime: R3 full-sweep resume', () => {
  it('K3-FIX every budget and small limits resume the exact full record set', async () => {
    const bound = bindKernel();
    const chainId = 'r3-sweep';
    const ids = ['s0', 's1', 's2'];
    for (let n = 0; n < ids.length; n += 1) {
      await bound.appendChain(
        chainId,
        { id: ids[n], bytes: 'x', hash: `hs${n}` },
        n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hs${n - 1}` },
      );
    }
    const full = await bound.readPage(chainId, 10, null, 4096);
    expect(full.outcome).toBe('page');
    const fullBytes = Buffer.byteLength(
      JSON.stringify({ outcome: full.outcome, records: full.records, nextCursor: full.nextCursor }),
      'utf8',
    );
    // Single-digit positions only: token sizes stay symmetric, so a budget
    // that delivers a first record always lets the resume advance too.
    for (const limit of [10, 2, 1]) {
      for (let budget = fullBytes - 1; budget >= 1; budget -= 1) {
        const first = await bound.readPage(chainId, limit, null, budget);
        const validity = validateReadPage(
          {
            outcome: first.outcome,
            records: first.records,
            nextCursor: first.nextCursor as unknown as string | null,
          },
          { maxRecords: limit, maxEncodedBytes: budget },
        );
        expect(validity.ok).toBe(true);
        if (first.records.length === 0) {
          expect(first.outcome).toBe('incomplete');
          continue;
        }
        const collected = first.records.map((entry) => entry.id);
        let cursor: unknown = first.nextCursor;
        let guard = 0;
        while (cursor !== null && guard < 10) {
          guard += 1;
          const page = await bound.readPage(chainId, limit, cursor, budget);
          const pageValidity = validateReadPage(
            {
              outcome: page.outcome,
              records: page.records,
              nextCursor: page.nextCursor as unknown as string | null,
            },
            { maxRecords: limit, maxEncodedBytes: budget },
          );
          expect(pageValidity.ok).toBe(true);
          if (page.records.length === 0) break;
          for (const entry of page.records) collected.push(entry.id);
          cursor = page.nextCursor;
          if (page.outcome === 'page' && page.nextCursor === null) break;
        }
        expect(collected).toEqual(ids);
      }
    }
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
    const owned = page.nextCursor as { readonly position: number; readonly head: string };
    await expectCode(async () => bound.readPage('tok-a', 10, { ...owned, position: owned.position + 999 }, 4096), 'invalid-command', 'K3-RED tokens: a tampered position is rejected');
    await expectCode(async () => bound.readPage('tok-b', 10, owned, 4096), 'invalid-command', 'K3-RED tokens: a cross-chain cursor is rejected');
  });
});
