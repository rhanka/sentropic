/**
 * L4 (immo #861) — guarded publication authorization on real PostgreSQL.
 *
 * Publishes through the L3 atomic finalization unit: the host guard runs
 * after the lock/quota waits with a lifecycle/ACL predicate, denial leaves
 * no release/pointer/receipt residue, revocation racing the waits denies,
 * and a same-key retry replays the winner without re-running provisional
 * work. Needs DATABASE_URL; excluded from the unit run.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createArtifactCommitBarrier, inspectDeletionClaims, pausePurgeBeforeDelete } from '../src/testing.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import {
  createGuardedPublicationService,
  createPostgresPublicationUnitWriter,
  type PublicationBlobStore,
  type GuardedPublicationService,
  type GuardedPublishInput,
} from '../src/server/publication.js';
import { createArtifactCommand, createRadarKeyDerivation, commandDigest } from '../src/server/command-identity.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createPostgresDeletionClaimStore, createPostgresClaimGuardedRefs,
  createPostgresGcService, createMemoryRefcountStore } from '../src/server/gc.js';
import { inspectPreparations, scheduleBoundedPreparationCleanup, type IntentStore } from '../src/server/object-intents.js';
import type {
  CommitPolicyParticipantFactory,
  FinalizeTxClient,
} from '../src/server/commit/types.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('publication authorization proof needs DATABASE_URL');
}

const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql', '0004_metadata.sql'].map(
  (name) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'),
);

const pool = new Pool({ connectionString: DATABASE_URL });
const singlePool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 500 });

// The host normalizes identity before calling the internal publication port.
const publish = (service: GuardedPublicationService, input: Omit<GuardedPublishInput, 'identity'>) => {
  const command = createArtifactCommand(compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE), 'artifacts_publish', {
    artifactId: input.artifactId, idempotencyKey: input.callerKey, profile: input.profile,
    files: input.files.map((file) => ({ ...file, bytes: [...file.bytes] })),
  }, input, createRadarKeyDerivation({ storageScopeId: input.storageScopeId, actorIds: [input.actorId] }));
  const identity = input.source === undefined ? command.identity : { ...command.identity,
    commandHash: commandDigest({ operation: command.operation, scopeBinding: command.scopeBinding,
      payload: { ...command.payload, provenance: input.source } }) };
  return service.publishFinalized({ ...input, identity });
};

const setupSchema = async (): Promise<void> => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query('DROP SCHEMA IF EXISTS pub_policy CASCADE');
  for (const sql of MIGRATIONS) await setup.query(sql);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-l4', 'org-l4')`);
  await setup.query('CREATE SCHEMA pub_policy');
  await setup.query(
    'CREATE TABLE pub_policy.policy_revision (id INT PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)',
  );
  await setup.query(`INSERT INTO pub_policy.policy_revision (id, revision) VALUES (1, 'rev-1')`);
  await setup.query(
    'CREATE TABLE pub_policy.approvals (actor_id TEXT PRIMARY KEY, approved BOOLEAN NOT NULL)',
  );
  await setup.query(`INSERT INTO pub_policy.approvals (actor_id, approved) VALUES ('owner-1', true)`);
  await setup.query(
    'CREATE TABLE pub_policy.quotas (quota_key TEXT PRIMARY KEY, total INT NOT NULL, used INT NOT NULL)',
  );
  await setup.query(`INSERT INTO pub_policy.quotas (quota_key, total, used) VALUES ('q-pub', 100, 0)`);
  await setup.end();
};

const participantFactory = (): CommitPolicyParticipantFactory => ({
  createParticipant: (client: FinalizeTxClient, transactionToken: string) => ({
    async readRevision(): Promise<string> {
      const { rows } = await client.query<{ revision: string }>(
        'SELECT revision FROM pub_policy.policy_revision WHERE id = 1 FOR SHARE',
        [],
      );
      return rows[0]?.revision ?? 'rev-unknown';
    },
    async checkApproval(input: { actorId: string }) {
      const { rows } = await client.query<{ approved: boolean }>(
        'SELECT approved FROM pub_policy.approvals WHERE actor_id = $1',
        [input.actorId],
      );
      const row = rows[0];
      if (row === undefined || !row.approved) {
        return { approved: false as const, reason: 'denied' as const };
      }
      return { approved: true as const };
    },
    async reserveQuota(): Promise<{ reserved: boolean }> {
      const { rowCount } = await client.query(
        'UPDATE pub_policy.quotas SET used = used + 1 WHERE quota_key = $1 AND used < total',
        ['q-pub'],
      );
      return { reserved: rowCount > 0 };
    },
    mintFence: (revision: string, invocationId: string) => ({
      fenceId: `fence-${transactionToken}`,
      transactionId: transactionToken,
      invocationId,
      policyRevision: revision,
    }),
  }),
});

let artifactSequence = 0;
const freshArtifactId = (): string => {
  artifactSequence += 1;
  const suffix = String(artifactSequence).padStart(12, '0');
  return `11111111-1111-4111-8111-${suffix}`;
};

const registerArtifact = async (
  artifactId: string,
  ownerId: string,
  lifecycleState = 'active',
): Promise<void> => {
  await pool.query(
    `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile, lifecycle_state)
     VALUES ($1, 'scope-l4', $2, $3, '{}', $4)`,
    [artifactId, ownerId, `binding-${artifactId.slice(-4)}`, lifecycleState],
  );
  await pool.query(
    `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
     VALUES ($1, $2, 'source')`,
    [artifactId, ownerId],
  );
};

const lockCallbacks = (artifactId: string) => ({
  'artifact-lifecycle': [
    async (client: FinalizeTxClient): Promise<void> => {
      await client.query('SELECT lifecycle_state FROM artifacts.artifacts WHERE id = $1 FOR UPDATE', [
        artifactId,
      ]);
    },
  ],
  acl: [
    async (client: FinalizeTxClient): Promise<void> => {
      await client.query(
        'SELECT principal_id FROM artifacts.artifact_access WHERE artifact_id = $1 FOR UPDATE',
        [artifactId],
      );
    },
  ],
  'current-pointer': [
    async (client: FinalizeTxClient): Promise<void> => {
      await client.query(
        'SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1 FOR UPDATE',
        [artifactId],
      );
    },
  ],
});

const countRows = async (table: string, where = '', params: unknown[] = []): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM ${table}${where}`,
    [...params],
  );
  return Number(rows[0]?.n ?? 0);
};

/** In-memory blob bytes for preparation I/O (outside the unit). */
class MapBlobs implements PublicationBlobStore {
  private blobs = new Map<string, Uint8Array>();
  async putBlob(key: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(key, bytes);
  }
  async getBlob(key: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(key);
  }
  async listKeys(prefix: string): Promise<string[]> {
    return [...this.blobs.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
  async deleteBlob(key: string): Promise<void> {
    if (!this.blobs.has(key)) throw new Error(`unknown blob: ${key}`);
    this.blobs.delete(key);
  }
}

/** Pool-recorded intents: preparation record and unit completion share PG UUIDs. */
const pgIntents = (): IntentStore => createPostgresArtifactStore(pool);

beforeAll(async () => {
  await setupSchema();
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS pub_policy CASCADE');
  await pool.end();
  await singlePool.end();
});

describe('guarded publication authorization', () => {
  it.each(['claim-first', 'reference-first'])('should expose durable purge claims in the %s race order', async (order) => {
    const artifactId = freshArtifactId();
    const digest = `sha256:${(order === 'claim-first' ? 'c8' : 'c9').repeat(32)}`;
    const key = `artifacts/scope-l4/blobs/sha256/${digest.slice(7)}`;
    const store = createPostgresArtifactStore(pool);
    const executor = createPostgresCommitExecutor(pool);
    const inspecting = await executor.beginFinalization();
    const blobs = new MapBlobs();
    await blobs.putBlob(key, new Uint8Array([1]));
    const guarded = createPostgresClaimGuardedRefs(store, executor);
    const host = { blobs, storageScopeId: 'scope-l4', claims: createPostgresDeletionClaimStore(inspecting),
      async purge(id: string, deleting: PublicationBlobStore) {
        const client = await executor.beginFinalization();
        try {
          await client.beginReadCommitted();
          await createPostgresDeletionClaimStore(client).claim(digest, `purge:${id}`);
          await client.commit();
        } finally { client.release(); }
        const result = await createPostgresGcService(executor, () => store).collect(deleting, 'artifacts/');
        if (result.failures.length) throw new Error('purge failed');
      } };
    try {
      if (order === 'reference-first') {
        await guarded.addRef(digest, 'live-release');
        await host.purge(artifactId, blobs);
        expect(await blobs.getBlob(key)).toBeDefined();
        expect(await store.count(digest)).toBe(1);
        expect((await inspectDeletionClaims(host)).some((claim) => claim.state === 'pending' && claim.blobKeys.includes(key))).toBe(true);
        await store.releaseRef(digest, 'live-release');
        await createPostgresGcService(executor, () => store).collect(blobs, 'artifacts/');
      } else {
        const paused = await pausePurgeBeforeDelete(host, artifactId);
        try {
          expect(paused.blobKeys).toEqual([key]);
          expect((await inspectDeletionClaims(host)).find((claim) => claim.claimId === paused.claimId)?.state).toBe('pending');
          const { rows } = await inspecting.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', [`artifacts-blob:${digest}`]);
          expect(rows[0]?.locked).toBe(false);
          expect(await blobs.getBlob(key)).toBeDefined();
        } finally { paused.release(); await paused.finished; }
        expect(await blobs.getBlob(key)).toBeUndefined();
        expect((await inspectDeletionClaims(host)).find((claim) => claim.claimId === paused.claimId)?.state).toBe('done');
        // A new preparation acquires exclusion after claim resolution and writes fresh bytes.
        await guarded.pin(digest, 'preparation:fresh');
        await blobs.putBlob(key, new Uint8Array([2]));
        await guarded.addRef(digest, 'fresh-release');
        expect(await blobs.getBlob(key)).toEqual(new Uint8Array([2]));
        await store.releaseRef(digest, 'fresh-release');
        await store.unpin(digest, 'preparation:fresh');
      }
    } finally { inspecting.release(); }
  });

  it('should invalidate an expired preparation before a paused finalization can commit', async () => {
    const receiptsBefore = await countRows('artifacts.operation_receipts');
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1');
    const store = createPostgresArtifactStore(pool);
    const executor = createPostgresCommitExecutor(pool);
    const barrier = createArtifactCommitBarrier({ points: ['before_connection_acquire'] });
    const blobs = new MapBlobs();
    const service = createGuardedPublicationService({
      coordinator: createArtifactCommitCoordinator({ executor, policy: participantFactory(), testObserver: barrier.observer }),
      createUnitWriter: createPostgresPublicationUnitWriter, blobs, intents: store,
      refs: createPostgresClaimGuardedRefs(store, executor), locks: lockCallbacks(artifactId), cleanupWindowMs: 1000,
    });
    const pending = publish(service, { ownerId: 'owner-1', actorId: 'owner-1', storageScopeId: 'scope-l4',
      artifactId, profile: {}, files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([73]) }],
      policyRevision: 'rev-1', callerKey: 'expired-preparation', invocationId: 'expired-invocation' });
    await barrier.waitUntilReached('before_connection_acquire', 'expired-invocation');
    const client = await executor.beginFinalization();
    await client.beginReadCommitted();
    const cleanup = { intents: store, refs: store, blobs, claims: createPostgresDeletionClaimStore(client) };
    try {
      const before = await inspectPreparations(cleanup, artifactId);
      expect(before.attempts).toHaveLength(1);
      await scheduleBoundedPreparationCleanup(cleanup, before.attempts[0]!.cleanupDeadlineMs);
      await client.commit();
      expect((await inspectPreparations(cleanup, artifactId)).attempts[0]?.state).toBe('failed-cleaned');
    } finally { client.release(); barrier.release('before_connection_acquire', 'expired-invocation'); }
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
    expect(await countRows('artifacts.artifact_current', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
    expect(await countRows('artifacts.operation_receipts')).toBe(receiptsBefore);
    expect(await blobs.listKeys('artifacts/')).toEqual([]);
  });

  it('should retain the PostgreSQL GC advisory lock until external deletion finishes', async () => {
    const digest = `sha256:${'ab'.repeat(32)}`;
    const key = `artifacts/scope-l4/blobs/sha256/${digest.slice(7)}`;
    const inspector = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const refs = createMemoryRefcountStore();
    const gc = createPostgresGcService(createPostgresCommitExecutor(pool), () => refs);
    let deleted = false;
    try {
      const report = await gc.collect({
        putBlob: async () => {}, getBlob: async () => undefined, headBlob: async () => undefined,
        listKeys: async () => [key],
        deleteBlob: async () => {
          const { rows } = await inspector.query(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`artifacts-blob:${digest}`]);
          expect(rows[0].acquired).toBe(false);
          deleted = true;
        },
      }, 'artifacts/');
      expect(deleted).toBe(true);
      expect(report.deleted).toEqual([key]);
      const { rows } = await inspector.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`artifacts-blob:${digest}`]);
      expect(rows[0].acquired).toBe(true);
    } finally { await inspector.end(); }
  });

  it('should serialize PostgreSQL references with durable deletion claims', async () => {
    const executor = createPostgresCommitExecutor(pool);
    const writer = await executor.beginFinalization();
    const deleter = await executor.beginFinalization();
    const digest = `sha256:${'ef'.repeat(32)}`;
    let claiming: Promise<void> | undefined;
    try {
      await createPostgresPublicationUnitWriter(writer).addReleaseRef(digest, 'existing-release');
      const { rows } = await deleter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid', []);
      claiming = createPostgresDeletionClaimStore(deleter).claim(digest, 'purge');
      await expect.poll(async () => {
        const { rows: locks } = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting`,
          [rows[0].pid]);
        return locks[0].waiting;
      }).toBe(true);
      await writer.commit();
      await claiming;
      await deleter.commit();
      await expect(createPostgresClaimGuardedRefs(createPostgresArtifactStore(singlePool),
        createPostgresCommitExecutor(singlePool)).pin(digest, 'new-preparation')).rejects.toThrow(/deletion/);
      const retry = await executor.beginFinalization();
      try {
        await expect(createPostgresPublicationUnitWriter(retry).addReleaseRef(digest, 'new-release'))
          .rejects.toThrow(/deletion/);
        await createPostgresDeletionClaimStore(retry).releaseClaim(digest);
        await retry.commit();
      } finally { await retry.rollback(); retry.release(); }
    } finally {
      await writer.rollback();
      await claiming?.catch(() => {});
      await deleter.rollback();
      writer.release(); deleter.release();
    }
  });

  it('finalizes a publish with one pooled connection when active and authorized', async () => {
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1');
    const pgStore = createPostgresArtifactStore(singlePool);
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(singlePool),
      policy: participantFactory(),
    });
    const abandoned: string[] = [];
    const service = createGuardedPublicationService({
      coordinator,
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: createPostgresClaimGuardedRefs(pgStore, createPostgresCommitExecutor(singlePool)),
      locks: lockCallbacks(artifactId),
      noteAbandoned: (attemptId: string) => {
        abandoned.push(attemptId);
      },
    });
    const outcome = await publish(service, {
      ownerId: 'owner-1',
      actorId: 'owner-1',
      storageScopeId: 'scope-l4',
      artifactId,
      profile: { title: 'Hello' },
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([1, 2, 3]) }],
      policyRevision: 'rev-1',
      callerKey: 'pub-key-1',
      attemptId: 'attempt-pub-1',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.commitState).toBe('committed');
    expect(outcome.replayed).toBe(false);
    const receipt = outcome.result.receipt as { releaseId?: unknown; manifest?: unknown };
    expect(typeof receipt.releaseId).toBe('string');
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', [
      outcome.result.internalKey,
    ])).toBe(1);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(1);
    const { rows } = await pool.query<{ release_id: string }>(
      'SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1',
      [artifactId],
    );
    expect(rows[0]?.release_id).toBe(receipt.releaseId);
    expect(await countRows('artifacts.blob_ref_holders', ' WHERE holder = $1', [receipt.releaseId])).toBe(1);
    expect(abandoned).toEqual([]);
  });

  it('denies a publish on a withdrawn artifact with zero residue', async () => {
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1', 'withdrawn');
    const pgStore = createPostgresArtifactStore(pool);
    await pgStore.putSource(artifactId, { kind: 'inline-original' });
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: participantFactory(),
    });
    const abandoned: string[] = [];
    const intents = pgIntents();
    const service = createGuardedPublicationService({
      coordinator,
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
      blobs: new MapBlobs(),
      intents,
      refs: createPostgresClaimGuardedRefs(pgStore, createPostgresCommitExecutor(singlePool)),
      locks: lockCallbacks(artifactId),
      noteAbandoned: (attemptId: string) => {
        abandoned.push(attemptId);
      },
    });
    const receiptsBefore = await countRows('artifacts.operation_receipts');
    const outcome = await publish(service, {
      ownerId: 'owner-1',
      actorId: 'owner-1',
      storageScopeId: 'scope-l4',
      artifactId,
      profile: { title: 'Hello' },
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([4, 5, 6]) }],
      policyRevision: 'rev-1',
      callerKey: 'pub-key-withdrawn',
      source: { kind: 'base-commit', commit: 'new-provenance' },
      attemptId: 'attempt-withdrawn',
    });
    expect(outcome.ok).toBe(false);
    expect(await pgStore.getSource(artifactId)).toEqual({ kind: 'inline-original' });
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(abandoned).toEqual(['attempt-withdrawn']);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
    expect(await countRows('artifacts.artifact_current', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
    expect(await countRows('artifacts.operation_receipts')).toBe(receiptsBefore);
    const pending = await intents.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.kind).toBe('commit-release');
  });

  it('denies a publish when the actor is not the owner', async () => {
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1');
    const pgStore = createPostgresArtifactStore(pool);
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: participantFactory(),
    });
    const service = createGuardedPublicationService({
      coordinator,
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: createPostgresClaimGuardedRefs(pgStore, createPostgresCommitExecutor(singlePool)),
      locks: lockCallbacks(artifactId),
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
    });
    const outcome = await publish(service, {
      ownerId: 'owner-1',
      actorId: 'intruder-9',
      storageScopeId: 'scope-l4',
      artifactId,
      profile: { title: 'Hello' },
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([7]) }],
      policyRevision: 'rev-1',
      callerKey: 'pub-key-intruder',
      attemptId: 'attempt-intruder',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(outcome.failure.httpStatus).toBe(403);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
  });

  it('denies a revocation that lands while the unit waits', async () => {
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1');
    const pgStore = createPostgresArtifactStore(pool);
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: participantFactory(),
      testObserver: barrier.observer,
      testPoints: ['before_finalization_row_lock'],
    });
    // The service now owns the artifact row lock for CAS. Revoke before that
    // lock is acquired, then verify the final guard reads the withdrawn state.
    const service = createGuardedPublicationService({
      coordinator,
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: createPostgresClaimGuardedRefs(pgStore, createPostgresCommitExecutor(singlePool)),
      locks: lockCallbacks(artifactId),
    });
    const invocationId = 'inv-revoke-race';
    const pending = publish(service, {
      ownerId: 'owner-1',
      actorId: 'owner-1',
      storageScopeId: 'scope-l4',
      artifactId,
      profile: { title: 'Hello' },
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([8]) }],
      policyRevision: 'rev-1',
      callerKey: 'pub-key-revoke',
      attemptId: 'attempt-revoke',
      invocationId,
    });
    await barrier.waitUntilReached('before_finalization_row_lock', invocationId);
    try {
      await pool.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'withdrawn' WHERE id = $1`, [artifactId]);
    } finally {
      barrier.release('before_finalization_row_lock', invocationId);
    }
    const outcome = await pending;
    try {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
      expect(await countRows('artifacts.artifact_current', ' WHERE artifact_id = $1', [artifactId])).toBe(0);
    } finally {
      await pool.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'active' WHERE id = $1`, [
        artifactId,
      ]);
    }
  });

  it('replays the same caller key without re-running provisional work', async () => {
    const artifactId = freshArtifactId();
    await registerArtifact(artifactId, 'owner-1');
    const pgStore = createPostgresArtifactStore(singlePool);
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(singlePool),
      policy: participantFactory(),
    });
    const service = createGuardedPublicationService({
      coordinator,
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: createPostgresClaimGuardedRefs(pgStore, createPostgresCommitExecutor(singlePool)),
      locks: lockCallbacks(artifactId),
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
    });
    const input = {
      ownerId: 'owner-1',
      actorId: 'owner-1',
      storageScopeId: 'scope-l4',
      artifactId,
      profile: { title: 'Hello' },
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([9]) }],
      policyRevision: 'rev-1',
      callerKey: 'pub-key-replay',
      attemptId: 'attempt-replay',
    } as const;
    const first = await publish(service, input);
    expect(first.ok).toBe(true);
    const second = await publish(service, { ...input, attemptId: 'attempt-replay-2' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(1);
    const changed = await publish(service, { ...input, source: { kind: 'base-commit', commit: 'changed' } });
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.failure.category).toBe('conflict');
  });
});
