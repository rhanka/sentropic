import { describe, expect, it } from 'vitest';
import { MemoryBackend, backendScopeKey, createBackendScopeState } from '../../src/storage/backend.js';
import { IndexedHistory } from '../../src/storage/indexed-history.js';
import { RootMutationCoordinator } from '../../src/storage/mutation-coordinator.js';
import { createKernel } from '../../src/storage/kernel.js';
import { grantFor } from './authority-corpus.js';

describe('memory representation composition contract', () => {
  it.each([false, true])('should refuse restored sparse sequences (indexed=%s)', (indexed) => {
    const backend = new MemoryBackend();
    const state = createBackendScopeState();
    const records = [{ id: 'one', seq: 1, hash: 'h', bytes: '{}' }];
    const history = new IndexedHistory<typeof records[number]>();
    history.push(...records);
    state.chains.set('chain', { allocation: '1', head: 'h', disposed: false, records: indexed ? history : records });
    backend.scopes.set(backendScopeKey(grantFor().scope), state);
    expect(() => createKernel({ moduleId: 'comments', backend })).toThrow('dense zero-based sequence');
  });

  it('should reject a coordinator without its exact backend', () => {
    const backend = new MemoryBackend();
    const coordinator = new RootMutationCoordinator(backend);
    expect(() => createKernel({ moduleId: 'comments', coordinator })).toThrow('coordinator backend mismatch');
    expect(() => createKernel({ moduleId: 'comments', backend: new MemoryBackend(), coordinator }))
      .toThrow('coordinator backend mismatch');
    expect(() => createKernel({ moduleId: 'comments', backend, coordinator })).not.toThrow();
  });

  it('should validate page limits before returning current coverage refusal', async () => {
    const backend = new MemoryBackend();
    const coordinator = new RootMutationCoordinator(backend, { accessible: () => false });
    const bound = createKernel({ moduleId: 'comments', backend, coordinator }).bindNew(grantFor());
    await expect(bound.readPage('covered', 0, null, 4096)).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.readPage('covered', 1, null, 0)).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.readPage('covered', 1, {}, 4096)).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.transact({}, (tx) => tx.readChain({ chainId: 'covered', limit: 0, maxEncodedBytes: 4096 })))
      .rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.transact({}, (tx) => tx.readChain({ chainId: 'covered', limit: 1, cursor: {}, maxEncodedBytes: 4096 })))
      .rejects.toMatchObject({ code: 'invalid-command' });
    expect(await bound.readPage('covered', 1, null, 4096))
      .toEqual({ outcome: 'inaccessible', records: [], nextCursor: null });
  });
});
