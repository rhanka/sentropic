// Shared chain corpus (L3a v4.1 frozen §5.3): independent typed chains, allocation
// rules, CAS ordering and disposal-retained recreation guards.
// Backend-agnostic: structural port-shaped operations, all awaited (§5.2).

import assert from 'node:assert/strict';
import { isStorageError } from '../../src/storage/errors.js';
import { expectCode, type Awaitable } from './atomic-corpus.js';

const codeOf = async (operation: () => unknown): Promise<string | null> => {
  try {
    await operation();
  } catch (error) {
    if (isStorageError(error)) return error.code;
    if (error instanceof Error) return error.message;
  }
  return null;
};

const record = (id: string, n: number) => ({ id, bytes: `{"n":${n}}`, hash: `hash-${id}-${n}` });

export interface ChainCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readChain(chainId: string): Awaitable<readonly { readonly id: string; readonly seq: number; readonly hash: string; readonly bytes: string }[]>;
  disposeChain(chainId: string): Awaitable<void>;
}

export const runChainCorpus = async (bound: ChainCorpusStore): Promise<void> => {
  await bound.appendChain('content', record('c', 1), { kind: 'absent', allocation: '0' });
  await bound.appendChain('review', record('r', 1), { kind: 'absent', allocation: '0' });

  assert.equal((await bound.readChain('content')).length, 1);
  assert.equal((await bound.readChain('review')).length, 1);

  await bound.appendChain('content', record('c', 2), { kind: 'head', hash: 'hash-c-1' });
  assert.equal((await bound.readChain('content')).length, 2);
  assert.equal(
    (await bound.readChain('review')).length,
    1,
    'K2a-RED chains: appending content does not allocate the review chain',
  );

  const heads = (await bound.readChain('content')).map((entry) => entry.hash);
  assert.deepEqual(heads, ['hash-c-1', 'hash-c-2']);

  await expectCode(
    async () => bound.appendChain('fresh', record('f', 1), { kind: 'absent', allocation: '999' }),
    'invalid-command',
    'K2aC-RED chains: a new chain rejects a wrong creation allocation',
  );

  await expectCode(
    async () => bound.appendChain('content', record('c', 3), { kind: 'absent', allocation: '0' }),
    'idempotency-conflict',
    'K2a-RED chains: creation under an old absent expectation conflicts after data exists',
  );

  await expectCode(
    async () => bound.appendChain('content', record('c', 3), { kind: 'head', hash: 'hash-c-1' }),
    'cas-conflict',
    'K2a-RED chains: a stale expected head stays a CAS conflict',
  );
  assert.equal(
    await codeOf(async () => bound.appendChain('content', record('c', 3), { kind: 'head', hash: 'hash-c-1' })),
    'cas-conflict',
    'K2aC-RED chains: a stale head reports cas-conflict, not idempotency-conflict',
  );
  assert.equal(
    await codeOf(async () => bound.appendChain('content', record('c', 3), { kind: 'absent', allocation: '0' })),
    'idempotency-conflict',
    'K2aC-RED chains: creation under an old absent expectation reports idempotency-conflict',
  );

  await bound.disposeChain('content');
  await expectCode(
    async () => bound.appendChain('content', record('c', 4), { kind: 'head', hash: 'hash-c-2' }),
    'invalid-command',
    'K2a-RED chains: disposed identities refuse new appends',
  );
  await expectCode(
    async () => bound.appendChain('content', record('c', 4), { kind: 'absent', allocation: '0' }),
    'invalid-command',
    'K2a-RED chains: disposed identities cannot be recreated under an old creation expectation',
  );
};
