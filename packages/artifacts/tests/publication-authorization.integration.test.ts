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
import { createArtifactCommitBarrier } from '../src/testing.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import {
  createGuardedPublicationService,
  createPostgresPublicationUnitWriter,
  type PublicationBlobStore,
} from '../src/server/publication.js';
import type { IntentStore } from '../src/server/object-intents.js';
import type {
  CommitPolicyParticipantFactory,
  FinalizeTxClient,
} from '../src/server/commit/types.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('publication authorization proof needs DATABASE_URL');
}

const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql'].map(
  (name) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'),
);

const pool = new Pool({ connectionString: DATABASE_URL });
const singlePool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 500 });

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
      refs: pgStore,
      locks: lockCallbacks(artifactId),
      noteAbandoned: (attemptId: string) => {
        abandoned.push(attemptId);
      },
    });
    const outcome = await service.publishFinalized({
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
      refs: pgStore,
      locks: lockCallbacks(artifactId),
      noteAbandoned: (attemptId: string) => {
        abandoned.push(attemptId);
      },
    });
    const receiptsBefore = await countRows('artifacts.operation_receipts');
    const outcome = await service.publishFinalized({
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
      refs: pgStore,
      locks: lockCallbacks(artifactId),
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
    });
    const outcome = await service.publishFinalized({
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
      testPoints: ['after_finalization_locks_before_guard'],
    });
    // No lifecycle row lock here: the racing writer must update the state
    // row while the unit waits, which a held FOR UPDATE lock would deadlock.
    // The guard re-read still denies on the revoked state.
    const allLocks = lockCallbacks(artifactId);
    const racingLocks = { acl: allLocks.acl, 'current-pointer': allLocks['current-pointer'] };
    const service = createGuardedPublicationService({
      coordinator,
      createUnitWriter: (client) => createPostgresPublicationUnitWriter(client),
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: pgStore,
      locks: racingLocks,
    });
    const invocationId = 'inv-revoke-race';
    const pending = service.publishFinalized({
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
    await barrier.waitUntilReached('after_finalization_locks_before_guard', invocationId);
    await pool.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'withdrawn' WHERE id = $1`, [
      artifactId,
    ]);
    barrier.release('after_finalization_locks_before_guard', invocationId);
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
    const pgStore = createPostgresArtifactStore(pool);
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: participantFactory(),
    });
    const service = createGuardedPublicationService({
      coordinator,
      blobs: new MapBlobs(),
      intents: pgIntents(),
      refs: pgStore,
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
    const first = await service.publishFinalized(input);
    expect(first.ok).toBe(true);
    const second = await service.publishFinalized({ ...input, attemptId: 'attempt-replay-2' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(await countRows('artifacts.releases', ' WHERE artifact_id = $1', [artifactId])).toBe(1);
  });
});
