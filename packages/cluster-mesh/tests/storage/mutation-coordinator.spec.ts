import { describe, expect, it } from 'vitest';
import { MemoryBackend, createIndexedBackendScopeState } from '../../src/storage/backend.js';
import { RootMutationCoordinator, type RootMutationHooks } from '../../src/storage/mutation-coordinator.js';
import { createKernel } from '../../src/storage/kernel.js';
import { StorageCasConflictError, StorageDeniedError, StorageInvalidCommandError, UnsupportedProfileError } from '../../src/storage/errors.js';
import { grantFor } from './authority-corpus.js';

const setup = (hooks: RootMutationHooks = {}) => {
  const backend = new MemoryBackend(createIndexedBackendScopeState);
  const coordinator = new RootMutationCoordinator(backend, hooks);
  const kernel = createKernel({ moduleId: 'comments', backend, coordinator });
  const bound = kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  return { coordinator, kernel, bound };
};
const unit = (chainId: string) => ({
  guards: [], records: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [],
  appends: [{ chainId, record: { id: chainId, hash: `hash-${chainId}`, bytes: '{}' }, expectation: { kind: 'absent' as const, allocation: '0' } }],
});

describe('root-aware ordinary mutations', () => {
  it('should refuse unsupported module effects before publishing their carriers', async () => {
    const { bound } = setup();
    await expect(bound.commitAtomic({ ...unit('unsupported'), relationships: [{ kind: 'add', relation: 'r', from: 'a', to: 'b' }] }))
      .rejects.toThrow(UnsupportedProfileError);
    expect(await bound.readHead('unsupported')).toBeNull();
  });
  it('should advance one root for every effective ordinary mutation and preserve captured heads', async () => {
    const { coordinator, bound } = setup();
    const initial = coordinator.capture(bound.scope);
    await bound.appendChain('a', { id: 'a', hash: 'h0', bytes: '{}' }, { kind: 'absent', allocation: '0' });
    const captured = coordinator.capture(bound.scope);
    expect(captured).not.toBe(initial);
    expect(captured.chains.get('a')?.head).toBe('h0');
    await bound.appendChain('a', { id: 'b', hash: 'h1', bytes: '{}' }, { kind: 'head', hash: 'h0' });
    expect(captured.chains.get('a')?.head).toBe('h0');
    await bound.indexPut('i', { digest: 'd', resultIds: ['r1'], resultHash: null });
    const indexed = coordinator.capture(bound.scope);
    await bound.indexPut('i', { digest: 'd', resultIds: ['r2'], resultHash: null });
    expect(coordinator.capture(bound.scope)).not.toBe(indexed);
    await bound.genesis('kind', 'identity', 'digest', { value: 1 });
    const genesis = coordinator.capture(bound.scope);
    await bound.genesis('kind', 'identity', 'digest', { value: 1 });
    expect(coordinator.capture(bound.scope)).toBe(genesis);
    await bound.disposeChain('a');
    expect(coordinator.capture(bound.scope)).not.toBe(genesis);
    expect(captured.chains.get('a')?.disposed).toBe(false);
    const beforeTx = coordinator.capture(bound.scope);
    await bound.transact({}, async (tx) => { await tx.apply(unit('transaction')); });
    expect(coordinator.capture(bound.scope)).not.toBe(beforeTx);
    expect(await bound.readHead('transaction')).toBe('hash-transaction');
  });

  it('should reject a changed captured base without losing the rival publication', async () => {
    const { coordinator, bound } = setup();
    const base = coordinator.capture(bound.scope);
    const prepared = coordinator.prepare(base);
    prepared.records.set('hidden', { contentHash: 'hash', bytes: { format: 'utf8', data: 'hidden' } });
    await bound.commitAtomic(unit('rival'));
    expect(() => coordinator.publish(bound.scope, base, prepared, () => undefined)).toThrow(StorageCasConflictError);
    expect(await bound.readRecord('hidden')).toBeNull();
    expect(await bound.readHead('rival')).toBe('hash-rival');
  });

  it('should discard all prepared effects when a required publication hook fails', async () => {
    const { coordinator, bound } = setup({ prepare: () => { throw new StorageInvalidCommandError('projection failed'); } });
    const base = coordinator.capture(bound.scope);
    await expect(bound.commitAtomic(unit('failed'))).rejects.toThrow(StorageInvalidCommandError);
    expect(coordinator.capture(bound.scope)).toBe(base);
    expect(await bound.readHead('failed')).toBeNull();
  });

  it('should revalidate authority after preparation and before the root switch', async () => {
    let revoke = () => undefined;
    const { coordinator, kernel, bound } = setup({ prepare: () => revoke() });
    const base = coordinator.capture(bound.scope);
    revoke = () => { void kernel.revoke(bound.grant.token); };
    await expect(bound.commitAtomic(unit('revoked'))).rejects.toThrow(StorageDeniedError);
    expect(coordinator.capture(bound.scope)).toBe(base);
  });

  it('should enforce current coverage through ordinary and transactional getters', async () => {
    const { bound } = setup({ accessible: (_state, _kind, key) => key !== 'covered' });
    await expect(bound.readHead('covered')).rejects.toThrow(StorageDeniedError);
    expect((await bound.readPage('covered', 1, null, 4096)).outcome).toBe('inaccessible');
    await expect(bound.transact({}, async (tx) => {
      await tx.apply(unit('rolled-back'));
      await tx.readHead('covered');
    })).rejects.toThrow(StorageDeniedError);
    expect(await bound.readHead('rolled-back')).toBeNull();
  });
});
