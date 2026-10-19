// Shared staged, journal and lifecycle corpora on durable SQLite (lot 1).
// Profiles, durability across close/reopen and module admission guards.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { createSqliteKernel } from '../../src/storage/sqlite/index.js';
import { grantFor } from './authority-corpus.js';
import { runBarrierCorpus, type BarrierCorpusStore } from './barrier-corpus.js';
import { runLifecycleCorpus } from './lifecycle-corpus.js';
import { runReplayCorpus, type ReplayCorpusForeign, type ReplayCorpusStore } from './replay-corpus.js';
import { runStagedCorpus, type StagedCorpusStore } from './staged-corpus.js';
import { createSqliteFixture, sqliteCorpusClient } from './sqlite-fixture.js';

describe('durable SQLite backend: lanes and lifecycle', () => {
  it('preserves the shared staged protocol and foreign-scope refusals', async () => {
    const fixture = createSqliteFixture();
    try {
      const grant = fixture.grant();
      const foreign = fixture.grant({ token: 'foreign', scope: { tenantId: 'foreign', workspaceId: 'workspace' } });
      const bound = sqliteCorpusClient(fixture.kernel, grant) as unknown as StagedCorpusStore;
      const other = sqliteCorpusClient(fixture.kernel, foreign) as unknown as StagedCorpusStore;
      await runStagedCorpus(bound, { breakAuthority: () => fixture.kernel.revoke(grant.token) }, other);
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared dependent-barrier corpus', async () => {
    const fixture = createSqliteFixture();
    try {
      await runBarrierCorpus(sqliteCorpusClient(fixture.kernel, fixture.grant()) as unknown as BarrierCorpusStore);
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared journal replay corpus', async () => {
    const fixture = createSqliteFixture();
    try {
      const grant = fixture.grant();
      const foreignGrant = fixture.grant({ token: 'foreign', scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' } });
      const primary = sqliteCorpusClient(fixture.kernel, grant) as unknown as ReplayCorpusStore;
      const foreign = sqliteCorpusClient(fixture.kernel, foreignGrant) as unknown as ReplayCorpusForeign;
      await runReplayCorpus(primary, foreign, {
        rebind: async () => sqliteCorpusClient(fixture.kernel, fixture.grant({ token: `rebind-${Date.now()}` })) as unknown as ReplayCorpusStore,
        bindWithoutMaintain: async () =>
          sqliteCorpusClient(fixture.kernel, fixture.grant({ token: 'weak-replay', operations: ['read', 'write'] })) as unknown as ReplayCorpusStore,
      });
    } finally {
      fixture.close();
    }
  });

  it('preserves the shared lifecycle corpus', async () => {
    const fixture = createSqliteFixture();
    try {
      const primary = sqliteCorpusClient(fixture.kernel, fixture.grant()) as unknown as Parameters<typeof runLifecycleCorpus>[0];
      await runLifecycleCorpus(primary, {
        rebind: async () => sqliteCorpusClient(fixture.kernel, fixture.grant({ token: `rebind-${Date.now()}` })) as unknown as Parameters<typeof runLifecycleCorpus>[0],
        bindWithoutMaintain: async () =>
          sqliteCorpusClient(fixture.kernel, fixture.grant({ token: 'weak-purge', operations: ['read', 'write'] })) as unknown as Parameters<typeof runLifecycleCorpus>[0],
      });
    } finally {
      fixture.close();
    }
  });

  it('advertises only the restart-durable lot 1 profiles', () => {
    const fixture = createSqliteFixture();
    try {
      const full = fixture.kernel.profiles(true).map((claim) => claim.profile);
      for (const profile of ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1']) {
        assert.ok(full.includes(profile as (typeof full)[number]), `advertised: ${profile}`);
      }
      for (const profile of ['scope-outbox-v1', 'visibility-barriers-v1', 'staged-units-v1', 'fenced-writers-v1', 'purge-jobs-v1']) {
        assert.ok(!full.includes(profile as (typeof full)[number]), `withheld until S2-S4: ${profile}`);
      }
    } finally {
      fixture.close();
    }
  });

  it('recovers committed ordinary state after close with a higher epoch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-sqlite-'));
    const path = join(dir, 'store.db');
    const first = createSqliteKernel({ path, moduleId: 'comments', cursorSecret: 'sqlite-lot1-secret' });
    const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
    const before = first.engine.receipt.storageEpoch;
    await (first.bindNew(grant) as unknown as { appendChain(id: string, record: { id: string; bytes: string; hash: string }, expectation: { kind: 'absent'; allocation: string }): Promise<unknown> }).appendChain(
      'durable',
      { id: 'd1', bytes: '{"n":1}', hash: 'hash-d-1' },
      { kind: 'absent', allocation: '0' },
    );
    first.close();
    const second = createSqliteKernel({ path, moduleId: 'comments', cursorSecret: 'sqlite-lot1-secret' });
    try {
      assert.ok(BigInt(second.engine.receipt.storageEpoch) > BigInt(before), 'reopen allocates a higher epoch');
      const chains = await (second.bindNew(grant) as unknown as { readChain(id: string): Promise<readonly { id: string }[]> }).readChain('durable');
      assert.deepEqual(chains.map((entry) => entry.id), ['d1']);
    } finally {
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unregistered modules and unknown grants like the neutral kernel', async () => {
    const fixture = createSqliteFixture();
    try {
      expect(() => createSqliteKernel({ path: join(fixture.dir, 'other.db'), moduleId: '' })).toThrow();
      expect(() => fixture.kernel.bindNew(grantFor({ token: 'ghost', moduleId: 'nope' }))).toThrow();
    } finally {
      fixture.close();
    }
  });
});
