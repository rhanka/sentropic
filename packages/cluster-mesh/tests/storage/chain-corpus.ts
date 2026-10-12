// Shared chain corpus (L3a v4 §5.3): independent typed chains, allocation
// rules, CAS ordering and disposal-retained recreation guards.

import assert from 'node:assert/strict';
import { isStorageError } from '../../src/storage/errors.js';
import type { TestBoundStore } from './reference-store.js';

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

export const runChainCorpus = async (bound: TestBoundStore): Promise<void> => {
  bound.appendChain('content', record('c', 1), { kind: 'absent', allocation: '0' });
  bound.appendChain('review', record('r', 1), { kind: 'absent', allocation: '0' });

  assert.equal(bound.readChain('content').length, 1);
  assert.equal(bound.readChain('review').length, 1);

  bound.appendChain('content', record('c', 2), { kind: 'head', hash: 'hash-c-1' });
  assert.equal(bound.readChain('content').length, 2);
  assert.equal(
    bound.readChain('review').length,
    1,
    'K2a-RED chains: appending content does not allocate the review chain',
  );

  const heads = bound.readChain('content').map((entry) => entry.hash);
  assert.deepEqual(heads, ['hash-c-1', 'hash-c-2']);

  await assert.rejects(
    async () => bound.appendChain('fresh', record('f', 1), { kind: 'absent', allocation: '999' }),
    /allocation/,
    'K2aC-RED chains: a new chain rejects a wrong creation allocation',
  );

  await assert.rejects(
    async () => bound.appendChain('content', record('c', 3), { kind: 'absent', allocation: '0' }),
    /already exists/,
    'K2a-RED chains: creation under an old absent expectation conflicts after data exists',
  );

  await assert.rejects(
    async () => bound.appendChain('content', record('c', 3), { kind: 'head', hash: 'hash-c-1' }),
    /stale head/,
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

  bound.disposeChain('content');
  await assert.rejects(
    async () => bound.appendChain('content', record('c', 4), { kind: 'head', hash: 'hash-c-2' }),
    /disposed/,
    'K2a-RED chains: disposed identities refuse new appends',
  );
  await assert.rejects(
    async () => bound.appendChain('content', record('c', 4), { kind: 'absent', allocation: '0' }),
    /disposed|already exists/,
    'K2a-RED chains: disposed identities cannot be recreated under an old creation expectation',
  );
};
