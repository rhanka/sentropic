import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { grantFor, runAuthorityCorpus } from './authority-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';

const setup = () => {
  const root = createStagedKernel({ moduleId: 'comments' });
  const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
  return { root, bound: root.bindNew(grant), grant };
};
const append = (chainId: string, hash: string, head: string | null = null) => ({ ...emptyEffects(),
  appends: [{ chainId, record: { id: hash, hash, bytes: '{}' }, expectation: head === null ? { kind: 'absent' as const, allocation: '0' } : { kind: 'head' as const, hash: head } }],
});

describe('ordinary K3 contracts through K4', () => {
  it('should treat an identical immutable representation as a no-op and reject changed bytes under its identity', async () => {
    const { bound } = setup();
    const record = { key: 'immutable', contentHash: 'same-hash', bytes: { format: 'utf8' as const, data: 'original' } };
    const input = { ...emptyEffects(), records: [record] };
    expect((await bound.commitAtomic(input)).effectiveRecords).toBe(1);
    expect((await bound.commitAtomic(input)).effectiveRecords).toBe(0);
    await expect(bound.commitAtomic({ ...input, records: [{ ...record, bytes: { ...record.bytes, data: 'different bytes' } }] })).rejects.toMatchObject({ code: 'idempotency-conflict' });
    expect((await bound.readRecord('immutable'))?.bytes.data).toBe('original');
  });
  it('should retain the shared chain corpus', async () => { await runChainCorpus(setup().bound); });
  it('should retain the shared read corpus', async () => { await runReadCorpus(setup().bound); });
  it('should retain exact cursor byte envelopes', async () => { await runReadCursorBudgetCorpus(setup().bound); });
  it('should retain the shared authority corpus', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const root = createStagedKernel({ moduleId: 'comments', now: () => now });
    await runAuthorityCorpus({ store: root, grant: grantFor(), readGrant: grantFor({ token: 'read-only', operations: ['read'] }), setNow: (value) => { now = value; } });
  });
  it('should join equivalent handles and roll back a swallowed nested failure', async () => {
    const { root, bound, grant } = setup();
    const other = root.bind(grant);
    await expect(bound.transact({}, async (tx) => {
      await tx.apply(append('outer', 'outer'));
      try { await other.transact({}, async (nested) => { await nested.apply(append('nested', 'nested')); throw new Error('abort nested'); }); } catch { /* outer still cannot commit */ }
    })).rejects.toThrow();
    expect(await bound.readHead('outer')).toBeNull();
    expect(await bound.readHead('nested')).toBeNull();
  });
  it('should preserve sequential pending heads and refuse a genuine rival append', async () => {
    const { bound } = setup();
    await bound.transact({}, async (tx) => { await tx.apply(append('chain', 'h0')); await tx.apply(append('chain', 'h1', 'h0')); });
    await expect(bound.transact({}, async (tx) => {
      await tx.apply(append('chain', 'loser', 'h1'));
      await bound.appendChain('chain', { id: 'winner', hash: 'winner', bytes: '{}' }, { kind: 'head', hash: 'h1' });
    })).rejects.toMatchObject({ code: 'cas-conflict' });
    expect((await bound.readChain('chain')).map((row) => row.hash)).toEqual(['h0', 'h1', 'winner']);
  });
  it('should evaluate registered predicates against pending scope state', async () => {
    const root = createStagedKernel({ moduleId: 'comments', predicates: { exists: (key, context) => context.view.readHead(key) === 'h0' } });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    await bound.transact({}, async (tx) => {
      await tx.apply(append('pending', 'h0'));
      await tx.apply({ ...append('guarded', 'yes'), guards: [{ kind: 'predicate', predicateId: 'exists', dependency: 'pending' }] });
    });
    expect(await bound.readHead('guarded')).toBe('yes');
    await expect(bound.commitAtomic({ ...append('failed', 'no'), guards: [{ kind: 'predicate', predicateId: 'exists', dependency: 'absent' }] })).rejects.toMatchObject({ code: 'cas-conflict' });
    expect(await bound.readHead('failed')).toBeNull();
  });
});
