// Shared ordinary corpora on the durable SQLite backend (lot 1).
// Open receipt, atomic, chains and reads against real temp-file databases.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import { createSqliteKernel } from '../../src/storage/sqlite/index.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';
import { createSqliteFixture, sqliteCorpusClient } from './sqlite-fixture.js';

describe('durable SQLite backend: ordinary corpora', () => {
  it('opens with a verified receipt and refuses a second holder without waiting', () => {
    const fixture = createSqliteFixture();
    try {
      assert.equal(fixture.kernel.engine.receipt.journalMode, 'wal');
      assert.equal(fixture.kernel.engine.receipt.synchronous, 'FULL');
      assert.equal(fixture.kernel.engine.receipt.lockingMode, 'exclusive');
      assert.ok(fixture.kernel.engine.receipt.engineVersion.length > 0);
      assert.equal(fixture.kernel.engine.receipt.storageEpoch, '1');
      const started = Date.now();
      try {
        createSqliteKernel({ path: fixture.path, moduleId: 'comments' });
        assert.fail('a second holder must be refused');
      } catch (error) {
        assert.ok(error instanceof CanonicalOwnershipError);
        assert.equal(error.code, 'instance-busy');
      }
      assert.ok(Date.now() - started < 5000, 'the refusal does not queue');
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared atomic contract with barrier, purge and relationship positives', async () => {
    const fixture = createSqliteFixture();
    try {
      const bound = sqliteCorpusClient(fixture.kernel, fixture.grant());
      await runAtomicCorpus(bound, { visibilityBarriers: true, purgeJobs: true, predicates: true, relationships: true });
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared chain corpus', async () => {
    const fixture = createSqliteFixture();
    try {
      await runChainCorpus(sqliteCorpusClient(fixture.kernel, fixture.grant()));
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared read and cursor-budget corpora', async () => {
    const fixture = createSqliteFixture();
    try {
      const bound = sqliteCorpusClient(fixture.kernel, fixture.grant());
      await runReadCorpus(bound);
      await runReadCursorBudgetCorpus(bound);
    } finally {
      fixture.close();
    }
  });
});
