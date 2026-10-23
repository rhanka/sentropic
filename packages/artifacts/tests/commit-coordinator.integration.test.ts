/**
 * L3 (immo #861) — coordinator regression on real PostgreSQL (spec r2 §3.1 A4).
 *
 * Mechanism proof, not provider behavior: unique success record, key
 * recheck with guarded replay, different-hash conflict, denial rollback
 * with zero committed residue, guard-after-waits ordering, revision and
 * last-unit quota races, two-key S3-barrier serialization, COMMIT-ack
 * unknown recovery, exactly-once client release and legacy quarantine.
 * S3-real races and lifecycle integration belong to L4/L8a; preparation
 * here is a memory helper invoking the same barrier seam. Runs only under
 * `make test-artifacts-integration` (needs DATABASE_URL); excluded from
 * the unit run.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createArtifactCommitBarrier } from '../src/testing.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import {
  type ArtifactCommitContext,
  type ArtifactCommitTransaction,
  type ArtifactAuthorizationDecision,
  type CommitPolicyParticipant,
  type CommitPolicyParticipantFactory,
  type FinalizeRequest,
  type FinalizeTxClient,
  type InternalIdempotencyKey,
} from '../src/server/commit/types.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('coordinator proof needs DATABASE_URL (make test-artifacts-integration)');
}

const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql'].map(
  (name) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'),
);

/** Q0 §3 fixed derivation vector, reused as a deterministic command-hash fixture. */
const Q0_COMMAND_HASH = '9a159e31bdd2a0415be1bf65c70e37c29d5076365616af5acc356ee8210c8ff1';

const pool = new Pool({ connectionString: DATABASE_URL });

const setupSchema = async (): Promise<void> => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query('DROP SCHEMA IF EXISTS commit_test CASCADE');
  for (const sql of MIGRATIONS) await setup.query(sql);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-l3', 'org-l3')`);
  await setup.query('CREATE SCHEMA commit_test');
  await setup.query(
    `CREATE TABLE commit_test.policy_revision (id INT PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)`,
  );
  await setup.query(`INSERT INTO commit_test.policy_revision (id, revision) VALUES (1, 'rev-1')`);
  await setup.query(
    `CREATE TABLE commit_test.approvals (actor_id TEXT PRIMARY KEY, approved BOOLEAN NOT NULL, expires_at_ms BIGINT NOT NULL)`,
  );
  await setup.query(
    `CREATE TABLE commit_test.quotas (quota_key TEXT PRIMARY KEY, total INT NOT NULL, used INT NOT NULL)`,
  );
  await setup.query(`INSERT INTO commit_test.quotas (quota_key, total, used) VALUES ('q-main', 100, 0)`);
  await setup.query(`INSERT INTO commit_test.quotas (quota_key, total, used) VALUES ('q-last', 1, 0)`);
  await setup.query(
    `CREATE TABLE commit_test.effects (scope_id TEXT NOT NULL, internal_key TEXT NOT NULL)`,
  );
  await setup.end();
};

interface TestClock {
  nowMs: number;
}

const makeParticipantFactory = (
  clientPool: Pool,
  clock: TestClock,
  quotaKey: string,
  calls?: { reserveQuota: number },
): CommitPolicyParticipantFactory => ({
  createParticipant: (client: FinalizeTxClient, transactionToken: string): CommitPolicyParticipant => ({
    async readRevision(): Promise<string> {
      const { rows } = await client.query<{ revision: string }>(
        'SELECT revision FROM commit_test.policy_revision WHERE id = 1 FOR SHARE',
        [],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('missing policy revision');
      return row.revision;
    },
    async checkApproval(input: { actorId: string }): Promise<{ approved: boolean; reason?: 'denied' | 'expired' }> {
      const { rows } = await client.query<{ approved: boolean; expires_at_ms: string }>(
        'SELECT approved, expires_at_ms FROM commit_test.approvals WHERE actor_id = $1',
        [input.actorId],
      );
      const row = rows[0];
      if (row === undefined || !row.approved) return { approved: false, reason: 'denied' };
      if (Number(row.expires_at_ms) <= clock.nowMs) return { approved: false, reason: 'expired' };
      return { approved: true };
    },
    async reserveQuota(): Promise<{ reserved: boolean }> {
      if (calls !== undefined) calls.reserveQuota += 1;
      const { rowCount } = await client.query(
        'UPDATE commit_test.quotas SET used = used + 1 WHERE quota_key = $1 AND used < total',
        [quotaKey],
      );
      return { reserved: rowCount > 0 };
    },
    mintFence: (revision: string, invocationId: string) => ({
      fenceId: transactionToken,
      invocationId,
      policyRevision: revision,
    }),
  }),
});

const allowGuard = async (
  context: ArtifactCommitContext,
  transaction: ArtifactCommitTransaction,
): Promise<ArtifactAuthorizationDecision> => {
  const revision = await transaction.participant.readRevision();
  if (context.policyRevision !== revision) {
    return { allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false };
  }
  const check = await transaction.participant.checkApproval({
    actorId: context.actorId,
    operation: context.operation,
  });
  if (!check.approved) {
    return {
      allowed: false,
      reason: check.reason ?? 'denied',
      publicCode: 'access_denied',
      status: 403,
      retriable: false,
    };
  }
  return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
};

let keySequence = 0;
const freshKey = (): InternalIdempotencyKey => `key-l3-${(keySequence += 1)}` as InternalIdempotencyKey;

const baseRequest = (overrides?: Partial<FinalizeRequest> & { key?: string }): FinalizeRequest => ({
  scopeId: 'scope-l3',
  internalKey: (overrides?.key ?? freshKey()) as InternalIdempotencyKey,
  commandHash: Q0_COMMAND_HASH,
  codecVersion: 'artifacts-command/v1',
  invocationId: `inv-${Math.random().toString(36).slice(2)}`,
  actorId: 'actor-1',
  operation: 'publish',
  artifactId: null,
  bindingName: null,
  policyRevision: 'rev-1',
  guard: allowGuard,
  receiptData: { releaseId: 'r-1' },
  ...overrides,
});

const countRows = async (table: string, where = '', params: unknown[] = []): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM ${table}${where}`,
    [...params],
  );
  return Number(rows[0]?.n ?? 0);
};

beforeAll(async () => {
  await setupSchema();
  await pool.query(
    `INSERT INTO commit_test.approvals (actor_id, approved, expires_at_ms) VALUES ('actor-1', true, 9999999999999)`,
  );
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS commit_test CASCADE');
  await pool.end();
});

describe('commit coordinator', () => {
  it('commits one success row for a fresh key', async () => {
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const request = baseRequest({ key: 'key-fresh', commandHash: 'h-fresh' });
    const outcome = await coordinator.finalize(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.replayed).toBe(false);
    expect(outcome.commitState).toBe('committed');
    expect(outcome.invocationId).toBe(request.invocationId);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-fresh'])).toBe(1);
    expect(await countRows('artifacts.idempotency_keys')).toBe(0);
  });

  it('replays the same-hash winner without a second receipt or duplicated work', async () => {
    let provisionalCalls = 0;
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const provisional = async (client: FinalizeTxClient): Promise<void> => {
      provisionalCalls += 1;
      await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [
        'scope-l3',
        'key-replay',
      ]);
    };
    const first = await coordinator.finalize(
      baseRequest({ key: 'key-replay', commandHash: 'h-replay', provisional }),
    );
    expect(first.ok).toBe(true);
    const second = await coordinator.finalize(
      baseRequest({ key: 'key-replay', commandHash: 'h-replay', provisional }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(provisionalCalls).toBe(1);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-replay'])).toBe(1);
  });

  it('conflicts on the same key with a different hash and abandons the attempt', async () => {
    const abandoned: string[] = [];
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const first = await coordinator.finalize(baseRequest({ key: 'key-conflict', commandHash: 'h-1' }));
    expect(first.ok).toBe(true);
    const second = await coordinator.finalize(
      baseRequest({
        key: 'key-conflict',
        commandHash: 'h-2',
        attemptId: 'attempt-2',
        noteAbandonedAttempt: async (attemptId: string) => {
          abandoned.push(attemptId);
        },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure.category).toBe('conflict');
    expect(second.failure.httpStatus).toBe(409);
    expect(second.failure.retriable).toBe(false);
    expect(second.failure.commitState).toBe('not_committed');
    expect(abandoned).toEqual(['attempt-2']);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-conflict'])).toBe(1);
  });

  it('rolls back denial with zero committed residue', async () => {
    const deniedGuard = async (): Promise<ArtifactAuthorizationDecision> => ({
      allowed: false,
      reason: 'revoked',
      publicCode: 'access_denied',
      status: 403,
      retriable: false,
    });
    const abandoned: string[] = [];
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const outcome = await coordinator.finalize(
      baseRequest({
        key: 'key-denied',
        commandHash: 'h-denied',
        guard: deniedGuard,
        attemptId: 'attempt-denied',
        noteAbandonedAttempt: async (attemptId: string) => {
          abandoned.push(attemptId);
        },
        provisional: async (client: FinalizeTxClient) => {
          await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [
            'scope-l3',
            'key-denied',
          ]);
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(outcome.failure.httpStatus).toBe(403);
    expect(outcome.failure.commitState).toBe('not_committed');
    expect(abandoned).toEqual(['attempt-denied']);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-denied'])).toBe(0);
    expect(await countRows('commit_test.effects', ' WHERE internal_key = $1', ['key-denied'])).toBe(0);
    expect(await countRows('artifacts.idempotency_keys')).toBe(0);
  });

  it('holds the guard after all waits and denies a mid-wait revocation', async () => {
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      testObserver: barrier.observer,
      testPoints: ['after_finalization_locks_before_guard'],
    });
    let provisionalCalls = 0;
    const request = baseRequest({
      key: 'key-guard-wait',
      commandHash: 'h-guard-wait',
      invocationId: 'inv-guard-wait',
      provisional: async (client: FinalizeTxClient) => {
        provisionalCalls += 1;
        await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [
          'scope-l3',
          'key-guard-wait',
        ]);
      },
    });
    const pending = coordinator.finalize(request);
    await barrier.waitUntilReached('after_finalization_locks_before_guard', 'inv-guard-wait');
    expect(provisionalCalls).toBe(1);
    const witness = new Pool({ connectionString: DATABASE_URL });
    try {
      const effects = await witness.query<{ n: string }>(
        "SELECT COUNT(*) AS n FROM commit_test.effects WHERE internal_key = 'key-guard-wait'",
      );
      expect(Number(effects.rows[0]?.n ?? 0)).toBe(0);
      const receipts = await witness.query<{ n: string }>(
        "SELECT COUNT(*) AS n FROM artifacts.operation_receipts WHERE internal_key = 'key-guard-wait'",
      );
      expect(Number(receipts.rows[0]?.n ?? 0)).toBe(0);
      await witness.query(
        "UPDATE commit_test.approvals SET approved = false WHERE actor_id = 'actor-1'",
      );
      barrier.release('after_finalization_locks_before_guard', 'inv-guard-wait');
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      expect(outcome.failure.commitState).toBe('not_committed');
      await witness.query(
        "UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'",
      );
    } finally {
      await witness.end();
    }
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-guard-wait'])).toBe(0);
    expect(await countRows('commit_test.effects', ' WHERE internal_key = $1', ['key-guard-wait'])).toBe(0);
  });

  it('denies when a revision writer lands during the waits', async () => {
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      testObserver: barrier.observer,
      testPoints: ['before_finalization_row_lock'],
    });
    const request = baseRequest({
      key: 'key-rev-race',
      commandHash: 'h-rev-race',
      invocationId: 'inv-rev-race',
    });
    const pending = coordinator.finalize(request);
    await barrier.waitUntilReached('before_finalization_row_lock', 'inv-rev-race');
    const writer = new Pool({ connectionString: DATABASE_URL });
    try {
      await writer.query("UPDATE commit_test.policy_revision SET revision = 'rev-2' WHERE id = 1");
      await writer.query("UPDATE commit_test.approvals SET approved = false WHERE actor_id = 'actor-1'");
      barrier.release('before_finalization_row_lock', 'inv-rev-race');
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      await writer.query("UPDATE commit_test.policy_revision SET revision = 'rev-1' WHERE id = 1");
      await writer.query("UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'");
    } finally {
      await writer.end();
    }
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-rev-race'])).toBe(0);
  });

  it('lets a post-decision revocation linearize after a successful commit', async () => {
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      testObserver: barrier.observer,
      testPoints: ['before_commit'],
    });
    const request = baseRequest({
      key: 'key-rev-after',
      commandHash: 'h-rev-after',
      invocationId: 'inv-rev-after',
    });
    const pending = coordinator.finalize(request);
    await barrier.waitUntilReached('before_commit', 'inv-rev-after');
    const writer = new Pool({ connectionString: DATABASE_URL });
    try {
      const writerDone = writer.query(
        "UPDATE commit_test.policy_revision SET revision = 'rev-9' WHERE id = 1",
      );
      barrier.release('before_commit', 'inv-rev-after');
      const outcome = await pending;
      expect(outcome.ok).toBe(true);
      await writerDone;
      const { rows } = await writer.query<{ revision: string }>(
        'SELECT revision FROM commit_test.policy_revision WHERE id = 1',
      );
      expect(rows[0]?.revision).toBe('rev-9');
      await writer.query("UPDATE commit_test.policy_revision SET revision = 'rev-1' WHERE id = 1");
    } finally {
      await writer.end();
    }
  });

  it('gives the last quota unit to exactly one winner across pools', async () => {
    const secondPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const barrier = createArtifactCommitBarrier();
      const calls = { reserveQuota: 0 };
      const coordinatorA = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(pool),
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-last', calls),
        testObserver: barrier.observer,
        testPoints: ['after_finalization_locks_before_guard'],
      });
      const coordinatorB = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(secondPool),
        policy: makeParticipantFactory(secondPool, { nowMs: Date.now() }, 'q-last', calls),
        testObserver: barrier.observer,
        testPoints: ['after_finalization_locks_before_guard'],
      });
      const pendingA = coordinatorA.finalize(
        baseRequest({ key: 'key-quota-a', commandHash: 'h-qa', invocationId: 'inv-quota-a' }),
      );
      const pendingB = coordinatorB.finalize(
        baseRequest({ key: 'key-quota-b', commandHash: 'h-qb', invocationId: 'inv-quota-b' }),
      );
      await barrier.waitUntilReached('after_finalization_locks_before_guard', 'inv-quota-a');
      await barrier.waitUntilReached('after_finalization_locks_before_guard', 'inv-quota-b');
      barrier.release('after_finalization_locks_before_guard', 'inv-quota-a');
      barrier.release('after_finalization_locks_before_guard', 'inv-quota-b');
      const [outcomeA, outcomeB] = await Promise.all([pendingA, pendingB]);
      const winners = [outcomeA, outcomeB].filter((outcome) => outcome.ok);
      const losers = [outcomeA, outcomeB].filter((outcome) => !outcome.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const loser = losers[0];
      if (loser === undefined || loser.ok) throw new Error('expected exactly one loser');
      expect(loser.failure.category).toBe('conflict');
      expect(loser.failure.httpStatus).toBe(409);
      const { rows } = await pool.query<{ used: number }>(
        "SELECT used FROM commit_test.quotas WHERE quota_key = 'q-last'",
      );
      expect(rows[0]?.used).toBe(1);
    } finally {
      await secondPool.end();
    }
  });

  it('serializes two same-key preparations with one success and a guarded replay', async () => {
    const secondPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const barrier = createArtifactCommitBarrier();
      const prepared: string[] = [];
      const prepareAttempt = async (invocationId: string): Promise<void> => {
        for (const point of ['before_blob_put', 'after_blob_put_before_verify', 'before_blob_readback'] as const) {
          prepared.push(`${point}:${invocationId}`);
        }
      };
      const coordinatorA = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(pool),
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
        testObserver: barrier.observer,
        testPoints: ['before_commit'],
      });
      const coordinatorB = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(secondPool),
        policy: makeParticipantFactory(secondPool, { nowMs: Date.now() }, 'q-main'),
        testObserver: barrier.observer,
        testPoints: ['before_key_lock'],
      });
      await Promise.all([prepareAttempt('inv-prep-a'), prepareAttempt('inv-prep-b')]);
      expect(prepared).toHaveLength(6);
      const pendingA = coordinatorA.finalize(
        baseRequest({ key: 'key-s3-race', commandHash: 'h-s3', invocationId: 'inv-prep-a' }),
      );
      const pendingB = coordinatorB.finalize(
        baseRequest({ key: 'key-s3-race', commandHash: 'h-s3', invocationId: 'inv-prep-b' }),
      );
      await barrier.waitUntilReached('before_commit', 'inv-prep-a');
      await barrier.waitUntilReached('before_key_lock', 'inv-prep-b');
      barrier.release('before_commit', 'inv-prep-a');
      const outcomeA = await pendingA;
      expect(outcomeA.ok).toBe(true);
      barrier.release('before_key_lock', 'inv-prep-b');
      const outcomeB = await pendingB;
      expect(outcomeB.ok).toBe(true);
      if (!outcomeB.ok) return;
      expect(outcomeB.replayed).toBe(true);
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-s3-race'])).toBe(1);
    } finally {
      await secondPool.end();
    }
  });

  it('reports COMMIT-ack loss as unknown and recovers through the same key', async () => {
    const sabotaged = new Pool({ connectionString: DATABASE_URL });
    const inner = createPostgresCommitExecutor(sabotaged);
    let sabotageArmed = true;
    const sabotagingExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        const connection = await inner.beginFinalization();
        const realCommit = connection.commit.bind(connection);
        connection.commit = (async () => {
          if (sabotageArmed) {
            sabotageArmed = false;
            const error = new Error('terminating connection due to administrator command') as Error & {
              code: string;
            };
            error.code = '57P06';
            throw error;
          }
          return realCommit();
        }) as typeof connection.commit;
        return connection;
      },
    };
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: sabotagingExecutor,
        policy: makeParticipantFactory(sabotaged, { nowMs: Date.now() }, 'q-main'),
      });
      const first = await coordinator.finalize(
        baseRequest({ key: 'key-unknown', commandHash: 'h-unknown' }),
      );
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.failure.category).toBe('provider_unavailable');
      expect(first.failure.httpStatus).toBe(503);
      expect(first.failure.retriable).toBe(true);
      expect(first.failure.commitState).toBe('unknown');
      const retry = await coordinator.finalize(
        baseRequest({ key: 'key-unknown', commandHash: 'h-unknown' }),
      );
      expect(retry.ok).toBe(true);
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-unknown'])).toBe(1);
    } finally {
      await sabotaged.end();
    }
  });

  it('releases its client exactly once on every path', async () => {
    let active = 0;
    let maxActive = 0;
    const tracking = new Pool({ connectionString: DATABASE_URL });
    const realConnect = tracking.connect.bind(tracking);
    const wrapped = {
      query: tracking.query.bind(tracking),
      connect: async () => {
        const client = await realConnect();
        active += 1;
        maxActive = Math.max(maxActive, active);
        const realRelease = client.release.bind(client);
        client.release = () => {
          active -= 1;
          realRelease();
        };
        return client;
      },
      end: tracking.end.bind(tracking),
    };
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(wrapped as unknown as Pool),
        policy: makeParticipantFactory(wrapped as unknown as Pool, { nowMs: Date.now() }, 'q-main'),
      });
      const okOutcome = await coordinator.finalize(baseRequest({ key: 'key-rel-1', commandHash: 'h-r1' }));
      expect(okOutcome.ok).toBe(true);
      const deniedGuard = async (): Promise<ArtifactAuthorizationDecision> => ({
        allowed: false,
        reason: 'denied',
        publicCode: 'access_denied',
        status: 403,
        retriable: false,
      });
      const denied = await coordinator.finalize(
        baseRequest({ key: 'key-rel-2', commandHash: 'h-r2', guard: deniedGuard }),
      );
      expect(denied.ok).toBe(false);
      const conflicted = await coordinator.finalize(
        baseRequest({ key: 'key-rel-1', commandHash: 'h-other' }),
      );
      expect(conflicted.ok).toBe(false);
      expect(active).toBe(0);
      expect(maxActive).toBeLessThanOrEqual(1);
    } finally {
      await tracking.end();
    }
  });

  it('quarantines an unknown legacy codec instead of replaying it', async () => {
    await pool.query(
      `INSERT INTO artifacts.operation_receipts (storage_scope_id, internal_key, command_codec, command_hash, receipt)
       VALUES ('scope-l3', 'key-legacy', 'legacy-0.1', 'h-legacy', '{"releaseId": "r-old"}')`,
    );
    await pool.query(
      `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
       VALUES ('scope-l3', 'key-legacy') ON CONFLICT DO NOTHING`,
    );
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    await expect(
      coordinator.finalize(baseRequest({ key: 'key-legacy', commandHash: 'h-legacy' })),
    ).rejects.toThrow('commit quarantine');
  });

  it('does not charge quota on guarded replay and denies replay when revoked', async () => {
    const calls = { reserveQuota: 0 };
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main', calls),
    });
    const first = await coordinator.finalize(baseRequest({ key: 'key-replay-q', commandHash: 'h-rq' }));
    expect(first.ok).toBe(true);
    expect(calls.reserveQuota).toBe(1);
    const replayed = await coordinator.replayGuarded(
      baseRequest({ key: 'key-replay-q', commandHash: 'h-rq' }),
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.replayed).toBe(true);
    expect(calls.reserveQuota).toBe(1);
    await pool.query("UPDATE commit_test.approvals SET approved = false WHERE actor_id = 'actor-1'");
    try {
      const denied = await coordinator.replayGuarded(
        baseRequest({ key: 'key-replay-q', commandHash: 'h-rq' }),
      );
      expect(denied.ok).toBe(false);
      if (denied.ok) return;
      expect(denied.failure.category).toBe('unauthorized_at_commit');
    } finally {
      await pool.query("UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'");
    }
  });

  it('rejects malformed finalize requests', async () => {
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    await expect(
      coordinator.finalize(baseRequest({ key: '', commandHash: 'h-x' })),
    ).rejects.toThrow('scope and internal key');
  });
});
