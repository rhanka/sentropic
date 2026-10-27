import { readFile, writeFile, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { quotePgIdentifier } from '../../src/storage/postgres/protocol.js';
import { applyPgMigrations, loadPgAssets } from '../../src/storage/postgres/migrations.js';
import type { PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import type { PgSession } from '../../src/storage/postgres/protocol.js';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedCommitRoots, stagedFragmentDigest } from '../../src/storage/staged-codec.js';
import type { AuthenticatedStagedHandle } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
const witness = new URL('../../../../.h2a/pg-crash-witness.json', import.meta.url);
// Fixed schema (no witness file): the lane copies the workspace per run, so
// no file survives from the seed phase to the verify phase. The seed drops
// any leftover schema first, making the pair idempotent.
const OWNERSHIP_CRASH_SCHEMA = 'storage_crash_ownership';
describe.skipIf(!pgEnabled)('actual server crash between durable steps', () => {
  it.skipIf(process.env.CM_PG_CRASH_PHASE !== 'seed')('seeds a partially prepared hidden unit before SIGKILL', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      await bound.appendChain('retained', { id: 'r', hash: 'r', bytes: '{}' }, { kind: 'absent', allocation: '0' });
      const fence = { fenceId: 'crash', epoch: '1' }; await root.provisionFence(grant, fence);
      const begin = { operationKey: 'crash-unit', inputDigest: 'input', contractDigest: 'contract', sourceBoundary: 'source', fence };
      const unit = await bound.beginStaged(begin);
      const effects = { ...emptyEffects(), appends: [{ chainId: 'pending', record: { id: 'p', hash: 'p', bytes: 'durable hidden bytes' }, expectation: { kind: 'absent' as const, allocation: '0' } }] };
      const fragmentDigest = stagedFragmentDigest({ ...begin, moduleId: 'comments', scope: grant.scope, operationId: begin.operationKey, ordinal: '0', predecessorHash: null }, effects);
      await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest, effects, fence });
      const commitRoot = { operationId: begin.operationKey, contractDigest: begin.contractDigest, sourceBoundary: begin.sourceBoundary, finalFragmentHash: fragmentDigest, fragmentCount: '1', ...stagedCommitRoots([{ ordinal: '0', effects }]) };
      const step = await bound.sealStep({ unit, root: commitRoot, fence, limits: { maxRecords: 1, maxAppends: 1, maxEncodedBytes: 16384 } });
      expect(step.state).toBe('sealing'); expect(step.checked).toBe(1); expect(await bound.readHead('pending')).toBeNull();
      await writeFile(witness, JSON.stringify({ name: fixture.name, grant, fence, unit, commitRoot, incarnation: root.incarnation }));
      await fixture.disconnect();
    } catch (error) { await fixture.close(); throw error; }
  });
  it.skipIf(process.env.CM_PG_CRASH_PHASE !== 'verify')('reopens the recovered server and finishes from the saved prefix', async () => {
    const saved = JSON.parse(await readFile(witness, 'utf8')) as { name: string; grant: ReturnType<typeof grantFor>; fence: { fenceId: string; epoch: string }; unit: AuthenticatedStagedHandle; commitRoot: StagedCommitRoot; incarnation: string };
    const schema = quotePgIdentifier(saved.name); const connection = testPgDriver();
    try {
      const root = await createPostgresKernel({ moduleId: 'comments', cursorSecret: 'qualification-host-secret', driver: connection.driver, layout: { dataSchema: saved.name, projectionSchemas: { comments: saved.name }, outboxSchema: saved.name }, history: {
        read: async (session) => (await session.execute({ text: `SELECT receipt FROM ${schema}.host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt as PgMigrationReceipt), complete: async () => { throw new Error('normal requests must not migrate'); },
      } });
      expect(root.incarnation).toBe(saved.incarnation); const bound = await root.bind(saved.grant);
      expect(await bound.inspectStaged('crash-unit')).toEqual({ state: 'sealing', acceptedFragments: '1' }); expect(await bound.readHead('pending')).toBeNull();
      let seal;
      for (let n = 0; !seal && n < 20; n += 1) seal = (await bound.sealStep({ unit: saved.unit, root: saved.commitRoot, fence: saved.fence, limits: { maxRecords: 1, maxAppends: 1, maxEncodedBytes: 16384 } })).seal;
      expect(seal).toBeDefined(); const receipt = await bound.commitStaged({ seal: seal!, fence: saved.fence });
      expect(await bound.readChain('pending')).toEqual([{ id: 'p', hash: 'p', seq: 0, bytes: 'durable hidden bytes' }]);
      expect(await bound.commitStaged({ seal: seal!, fence: saved.fence })).toEqual(receipt); expect((await bound.journalRead(0, 10)).watermark).toBe('2');
    } finally {
      await connection.driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 2000 }, (session) => session.execute({ text: `DROP SCHEMA ${schema} CASCADE`, values: [] }));
      await connection.close(); await rm(witness);
    }
  });
  it.skipIf(process.env.CM_PG_CRASH_PHASE !== 'seed')('seeds an opt-in ownership row before SIGKILL', async () => {
    const connection = testPgDriver();
    try {
      const tx = new PgTransactions(connection.driver);
      const name = OWNERSHIP_CRASH_SCHEMA;
      const layout = { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name };
      const history = {
        read: async (session: PgSession) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt as PgMigrationReceipt),
        complete: async (session: PgSession, receipt: PgMigrationReceipt) => { await session.execute({ text: `INSERT INTO "${name}".host_history VALUES((SELECT COALESCE(MAX(ordinal),0)+1 FROM "${name}".host_history),$1::jsonb)`, values: [JSON.stringify(receipt)] }); },
      };
      await tx.run(false, async (session) => {
        await session.execute({ text: `DROP SCHEMA IF EXISTS "${name}" CASCADE`, values: [] });
        await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY,receipt jsonb NOT NULL)`, values: [] });
        await applyPgMigrations(session, layout, await loadPgAssets(), history, { id: 'neutral-host/001', checksum: 'a'.repeat(64) });
      });
      const kernel = await createPostgresKernel({ moduleId: 'comments', cursorSecret: 'qualification-host-secret', driver: connection.driver, layout, history, canonicalOwnership: { leaseMs: 60000 } });
      const bound = await kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      await bound.commitAtomic({ guards: [], records: [], appends: [{ chainId: 'crash-ownership', record: { id: 'crash-ownership-1', bytes: '{"n":1}', hash: 'crash-hash' }, expectation: { kind: 'absent', allocation: '0' } }], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });
    } finally {
      await connection.close();
    }
  });
  it.skipIf(process.env.CM_PG_CRASH_PHASE !== 'verify')('reopens after SIGKILL: chain durable, takeover continues the epochs', async () => {
    const name = OWNERSHIP_CRASH_SCHEMA;
    const schema = quotePgIdentifier(name); const connection = testPgDriver();
    try {
      const history = {
        read: async (session: PgSession) => (await session.execute({ text: `SELECT receipt FROM ${schema}.host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt as PgMigrationReceipt), complete: async () => { throw new Error('normal requests must not migrate'); },
      };
      const layout = { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name };
      const root = await createPostgresKernel({ moduleId: 'comments', cursorSecret: 'qualification-host-secret', driver: connection.driver, layout, history });
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      // The chain committed before the kill survived it.
      expect(await bound.readHead('crash-ownership')).toBe('crash-hash');
      // The lease row survived too: expire deterministically, then an opt-in
      // open takes over at exactly the next epoch and commits.
      const before = await connection.driver.transaction({ isolation: 'serializable', readOnly: true, deadlineMs: 2000 }, (session) =>
        session.execute({ text: `SELECT instance, epoch FROM ${schema}.instance_ownership WHERE module='comments'`, values: [] }));
      const instance = decodePgText(before.rows[0]!.instance);
      const epoch = decodePgText(before.rows[0]!.epoch);
      await connection.driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 2000 }, async (session) => {
        await session.execute({ text: `DELETE FROM ${schema}.instance_ownership WHERE module='comments'`, values: [] });
        await session.execute({ text: `INSERT INTO ${schema}.instance_ownership(module, instance, epoch, holder_until) VALUES('comments', $1, $2, clock_timestamp() - make_interval(secs => 60))`, values: [instance, epoch] });
      });
      const owner = await createPostgresKernel({ moduleId: 'comments', cursorSecret: 'qualification-host-secret', driver: connection.driver, layout, history, canonicalOwnership: { leaseMs: 60000 } });
      expect(owner.ownership?.handle.storageEpoch).toBe((BigInt(epoch) + 1n).toString());
      expect(owner.ownership?.handle.instanceId).toBe(instance);
      const rebound = await owner.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await rebound.configureLifecycle('optional');
      await rebound.commitAtomic({ guards: [], records: [], appends: [{ chainId: 'crash-after', record: { id: 'crash-after-1', bytes: '{"n":2}', hash: 'crash-hash-2' }, expectation: { kind: 'absent', allocation: '0' } }], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });
      expect(await rebound.readHead('crash-after')).toBe('crash-hash-2');
    } finally {
      await connection.driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 2000 }, (session) => session.execute({ text: `DROP SCHEMA ${schema} CASCADE`, values: [] }));
      await connection.close();
    }
  });
});
