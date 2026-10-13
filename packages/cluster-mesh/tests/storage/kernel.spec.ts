// K3 gate: ordinary runtime proof (L3a v4.1 frozen §5, §8, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { describe, expect, it } from 'vitest';
import { createKernel } from '../../src/storage/kernel.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { runAtomicCorpus, expectCode } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';

const writeGrant = (token: string) => grantFor({ token, operations: ['read', 'write', 'maintain'] });

const bindKernel = () => {
  const kernel = createKernel({ moduleId: 'comments' });
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

describe('K3 runtime: token-bound cursors', () => {
  it('K3-RED forged, tampered and cross-chain cursors are rejected', async () => {
    const bound = bindKernel();
    await bound.appendChain('tok-a', { id: 'a1', bytes: '{}', hash: 'hash-tok-a1' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('tok-b', { id: 'b1', bytes: '{}', hash: 'hash-tok-b1' }, { kind: 'absent', allocation: '0' });
    const page = await bound.readPage('tok-a', 10, null, 4096);
    expect(page.outcome).toBe('page');
    await expectCode(async () => bound.readPage('tok-a', 10, 'forged-cursor', 4096), 'invalid-command', 'K3-RED tokens: a forged cursor is explicitly rejected');
    const owned = page.nextCursor as { readonly position: number; readonly head: string };
    await expectCode(async () => bound.readPage('tok-a', 10, { ...owned, position: owned.position + 999 }, 4096), 'invalid-command', 'K3-RED tokens: a tampered position is rejected');
    await expectCode(async () => bound.readPage('tok-b', 10, owned, 4096), 'invalid-command', 'K3-RED tokens: a cross-chain cursor is rejected');
  });
});
