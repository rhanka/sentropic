// K2b gates and discriminating mutations (L3a v4.1 frozen §16.1, §17.1):
// the staged, replay, barrier and lifecycle corpora executed against the
// test-only staged reference, plus one recorded mutant per corpus behavior.

import { describe, expect, it } from 'vitest';
import { runAtomicCorpus } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';
import { runStagedCorpus } from './staged-corpus.js';
import { TestStagedReferenceStore, type TestStagedStore } from './reference-staged.js';

let tokenSeq = 0;
const stagedGrant = () =>
  grantFor({ token: `token-k2b-${(tokenSeq += 1)}`, operations: ['read', 'write', 'maintain'] });

const bindStaged = (
  store?: TestStagedReferenceStore,
): { store: TestStagedReferenceStore; bound: TestStagedStore } => {
  const target = store ?? new TestStagedReferenceStore('comments');
  return { store: target, bound: target.bindStaged(stagedGrant()) };
};

describe('K2b reference: staged corpus', () => {
  it('K2b-RED hidden state, sequencing, publication, conflicts and recovery hold', async () => {
    const { store, bound } = bindStaged();
    const grant = bound.grant;
    await runStagedCorpus(bound, {
      breakAuthority: async () => {
        store.revoke(grant.token);
      },
    });
  });
});

describe('K2b reference: atomic corpus with barrier and purge profiles', () => {
  it('K2b-RED profiled barrier and purge effects commit with carriers', async () => {
    const { bound } = bindStaged();
    await runAtomicCorpus(bound, { visibilityBarriers: true, purgeJobs: true });
  });
});
