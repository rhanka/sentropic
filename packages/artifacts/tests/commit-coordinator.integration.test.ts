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
import { CommitQuarantineError } from '../src/server/commit/types.js';
import { COORDINATOR_TEST_POINTS } from '../src/server/commit/types.js';
import {
  type ArtifactCommitContext,
  type ArtifactCommitTransaction,
  type ArtifactAuthorizationDecision,
  type CommitExecutor,
  type CommitPolicyParticipant,
  type CommitPolicyParticipantFactory,
  type CoordinatorTestPoint,
  type FinalizeConnection,
  type FinalizeRequest,
  type FinalizeTxClient,
  type InternalIdempotencyKey,
  type StoredCommitReceipt,
} from '../src/server/commit/types.js';
import type { ArtifactFailure as FrozenArtifactFailure } from '../l0-freeze/failure-contract.js';
import type { CommitBarrierPoint as FrozenBarrierPoint } from '../l0-freeze/commit-contract.js';

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
      fenceId: `fence-${transactionToken}`,
      transactionId: transactionToken,
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
    } finally {
      await witness.query(
        "UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'",
      );
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
    } finally {
      await writer.query("UPDATE commit_test.policy_revision SET revision = 'rev-1' WHERE id = 1");
      await writer.query("UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'");
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
    // The quota reservation precedes the guard decision, so the contenders
    // serialize on the quota row itself; no barrier can overlap them past the
    // reservation without deadlocking the test. The race outcome is still
    // deterministic: exactly one winner regardless of arrival order.
    await pool.query("UPDATE commit_test.quotas SET used = 0 WHERE quota_key = 'q-last'");
    const secondPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const calls = { reserveQuota: 0 };
      const coordinatorA = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(pool),
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-last', calls),
      });
      const coordinatorB = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(secondPool),
        policy: makeParticipantFactory(secondPool, { nowMs: Date.now() }, 'q-last', calls),
      });
      const [outcomeA, outcomeB] = await Promise.all([
        coordinatorA.finalize(
          baseRequest({ key: 'key-quota-a', commandHash: 'h-qa', invocationId: 'inv-quota-a' }),
        ),
        coordinatorB.finalize(
          baseRequest({ key: 'key-quota-b', commandHash: 'h-qb', invocationId: 'inv-quota-b' }),
        ),
      ]);
      const winners = [outcomeA, outcomeB].filter((outcome) => outcome.ok);
      const losers = [outcomeA, outcomeB].filter((outcome) => !outcome.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const loser = losers[0];
      if (loser === undefined || loser.ok) throw new Error('expected exactly one loser');
      expect(loser.failure.category).toBe('conflict');
      expect(loser.failure.variant).toBe('quota_exhausted');
      expect(loser.failure.httpStatus).toBe(409);
      expect(loser.failure.retriable).toBe(false);
      const { rows } = await pool.query<{ used: number }>(
        "SELECT used FROM commit_test.quotas WHERE quota_key = 'q-last'",
      );
      expect(rows[0]?.used).toBe(1);
      expect(
        await countRows(
          'artifacts.operation_receipts',
          ' WHERE internal_key IN ($1, $2)',
          ['key-quota-a', 'key-quota-b'],
        ),
      ).toBe(1);
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
      const reachedB = barrier.waitUntilReached('before_key_lock', 'inv-prep-b');
      const pendingA = coordinatorA.finalize(
        baseRequest({ key: 'key-s3-race', commandHash: 'h-s3', invocationId: 'inv-prep-a' }),
      );
      const pendingB = coordinatorB.finalize(
        baseRequest({ key: 'key-s3-race', commandHash: 'h-s3', invocationId: 'inv-prep-b' }),
      );
      await barrier.waitUntilReached('before_commit', 'inv-prep-a');
      await reachedB;
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

describe('coordinator sol-r1 regressions', () => {
  const boom = (code?: string): Error & { code?: string } => {
    const error = new Error(`boom ${code ?? 'none'}`) as Error & { code?: string };
    if (code !== undefined) error.code = code;
    return error;
  };

  /**
   * Drain a pool with a bounded wait: a leaked checkout rejects with an
   * explicit message instead of hanging the file behind pool.end().
   */
  const endPool = async (pool: Pool): Promise<void> => {
    await Promise.race([
      pool.end(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('pool did not drain: leaked client')), 3000);
      }),
    ]);
  };

  /** Pool wrapper counting leased clients to prove exactly-once settlement. */
  const trackingPool = (): { pool: Pool; active: () => number } => {
    const inner = new Pool({ connectionString: DATABASE_URL });
    let active = 0;
    const realConnect = inner.connect.bind(inner);
    const wrapped = {
      query: inner.query.bind(inner),
      connect: async () => {
        const client = await realConnect();
        active += 1;
        const realRelease = client.release.bind(client);
        client.release = ((error?: unknown) => {
          active -= 1;
          realRelease(error as never);
        }) as typeof client.release;
        return client;
      },
      end: inner.end.bind(inner),
    };
    return { pool: wrapped as unknown as Pool, active: () => active };
  };

  it('denies when approval expires during the before_commit wait', async () => {
    const clock = { nowMs: 0 };
    await pool.query(
      "UPDATE commit_test.approvals SET expires_at_ms = 10 WHERE actor_id = 'actor-1'",
    );
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, clock, 'q-main'),
      testObserver: barrier.observer,
      testPoints: ['before_commit'],
      nowMs: () => clock.nowMs,
    });
    try {
      const pending = coordinator.finalize(
        baseRequest({
          key: 'key-exp-wait',
          commandHash: 'h-exp-wait',
          invocationId: 'inv-exp-wait',
        }),
      );
      await barrier.waitUntilReached('before_commit', 'inv-exp-wait');
      clock.nowMs = 11;
      barrier.release('before_commit', 'inv-exp-wait');
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      expect(outcome.failure.commitState).toBe('not_committed');
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-exp-wait'])).toBe(0);
    } finally {
      await pool.query(
        "UPDATE commit_test.approvals SET expires_at_ms = 9999999999999 WHERE actor_id = 'actor-1'",
      );
    }
  });

  it('denies an approval that expires while blocked on the quota row', async () => {
    const clock = { nowMs: 0 };
    await pool.query(
      "INSERT INTO commit_test.approvals (actor_id, approved, expires_at_ms) VALUES ('actor-quota-exp', true, 10) ON CONFLICT (actor_id) DO UPDATE SET approved = true, expires_at_ms = 10",
    );
    // A second client holds the quota row so the finalizer blocks inside
    // the provisional reservation, before the guard decision.
    const locker = new Pool({ connectionString: DATABASE_URL });
    const lockerClient = await locker.connect();
    const guarded = createPostgresCommitExecutor(pool);
    const coordinator = createArtifactCommitCoordinator({
      executor: guarded,
      policy: makeParticipantFactory(pool, clock, 'q-main'),
      nowMs: () => clock.nowMs,
    });
    try {
      await lockerClient.query('BEGIN');
      await lockerClient.query("SELECT used FROM commit_test.quotas WHERE quota_key = 'q-main' FOR UPDATE");
      const { rows: before } = await pool.query<{ used: number }>(
        "SELECT used FROM commit_test.quotas WHERE quota_key = 'q-main'",
      );
      const pending = coordinator.finalize(
        baseRequest({
          key: 'key-quota-exp',
          commandHash: 'h-quota-exp',
          invocationId: 'inv-quota-exp',
          actorId: 'actor-quota-exp',
        }),
      );
      const deadline = Date.now() + 10000;
      for (;;) {
        const { rows } = await pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query ILIKE '%commit_test.quotas%'`,
        );
        if (Number(rows[0]?.n ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error('finalizer never blocked on the quota row');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      clock.nowMs = 11;
      await lockerClient.query('ROLLBACK');
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      expect(outcome.failure.commitState).toBe('not_committed');
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-quota-exp'])).toBe(0);
      const { rows: after } = await pool.query<{ used: number }>(
        "SELECT used FROM commit_test.quotas WHERE quota_key = 'q-main'",
      );
      expect(after[0]?.used).toBe(before[0]?.used);
    } finally {
      try {
        await lockerClient.query('ROLLBACK');
      } catch {
        /* already settled */
      }
      lockerClient.release();
      await locker.end();
      await pool.query("DELETE FROM commit_test.approvals WHERE actor_id = 'actor-quota-exp'");
    }
  });

  it('rejects a fence not minted by this transaction', async () => {
    const abandoned: string[] = [];
    const foreignFenceGuard = async (
      context: ArtifactCommitContext,
    ): Promise<ArtifactAuthorizationDecision> => ({
      allowed: true,
      fence: {
        fenceId: 'unrelated-fence',
        transactionId: 'unrelated-transaction',
        invocationId: context.invocationId,
        policyRevision: 'rev-1',
      },
    });
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const outcome = await coordinator.finalize(
      baseRequest({
        key: 'key-foreign-fence',
        commandHash: 'h-foreign-fence',
        invocationId: 'inv-foreign-fence',
        guard: foreignFenceGuard,
        attemptId: 'attempt-foreign-fence',
        noteAbandonedAttempt: async (attemptId: string) => {
          abandoned.push(attemptId);
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(outcome.failure.httpStatus).toBe(403);
    expect(outcome.failure.commitState).toBe('not_committed');
    expect(abandoned).toEqual(['attempt-foreign-fence']);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-foreign-fence'])).toBe(0);
  });

  it('rejects a replayed fence minted by another transaction', async () => {
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const first = await coordinator.finalize(
      baseRequest({ key: 'key-replay-foreign', commandHash: 'h-replay-foreign' }),
    );
    expect(first.ok).toBe(true);
    const foreignFenceGuard = async (
      context: ArtifactCommitContext,
    ): Promise<ArtifactAuthorizationDecision> => ({
      allowed: true,
      fence: {
        fenceId: 'another-fence',
        transactionId: 'another-transaction',
        invocationId: context.invocationId,
        policyRevision: 'rev-1',
      },
    });
    const replayed = await coordinator.replayGuarded(
      baseRequest({
        key: 'key-replay-foreign',
        commandHash: 'h-replay-foreign',
        invocationId: 'inv-replay-foreign',
        guard: foreignFenceGuard,
      }),
    );
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.failure.category).toBe('unauthorized_at_commit');
    expect(replayed.failure.httpStatus).toBe(403);
  });

  it('runs caller object locks on guarded replay without re-running provisional work', async () => {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS commit_test.lifecycle (obj_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL)',
    );
    await pool.query(
      "INSERT INTO commit_test.lifecycle (obj_id, active) VALUES ('obj-1', true) ON CONFLICT (obj_id) DO NOTHING",
    );
    const lockCalls: string[] = [];
    let provisionalCalls = 0;
    const quotaCalls = { reserveQuota: 0 };
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main', quotaCalls),
    });
    const request = baseRequest({
      key: 'key-replay-locks',
      commandHash: 'h-replay-locks',
      locks: {
        'artifact-lifecycle': [
          async (client: FinalizeTxClient) => {
            lockCalls.push('lifecycle');
            await client.query('SELECT active FROM commit_test.lifecycle WHERE obj_id = $1 FOR UPDATE', [
              'obj-1',
            ]);
          },
        ],
        acl: [
          async (client: FinalizeTxClient) => {
            lockCalls.push('acl');
            await client.query('SELECT 1', []);
          },
        ],
      },
      provisional: async (client: FinalizeTxClient) => {
        provisionalCalls += 1;
        await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [
          'scope-l3',
          'key-replay-locks',
        ]);
      },
    });
    const first = await coordinator.finalize(request);
    expect(first.ok).toBe(true);
    expect(lockCalls).toEqual(['lifecycle', 'acl']);
    expect(provisionalCalls).toBe(1);
    expect(quotaCalls.reserveQuota).toBe(1);
    const second = await coordinator.replayGuarded(request);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(lockCalls).toEqual(['lifecycle', 'acl', 'lifecycle', 'acl']);
    expect(provisionalCalls).toBe(1);
    expect(quotaCalls.reserveQuota).toBe(1);
  });

  it('denies a replay racing a receipt deletion after lookup', async () => {
    const barrier = createArtifactCommitBarrier();
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      testObserver: barrier.observer,
      testPoints: ['after_replay_lookup_before_guard'],
    });
    const first = await coordinator.finalize(
      baseRequest({ key: 'key-replay-del', commandHash: 'h-replay-del' }),
    );
    expect(first.ok).toBe(true);
    const pending = coordinator.replayGuarded(
      baseRequest({
        key: 'key-replay-del',
        commandHash: 'h-replay-del',
        invocationId: 'inv-replay-del',
      }),
    );
    await barrier.waitUntilReached('after_replay_lookup_before_guard', 'inv-replay-del');
    const writer = new Pool({ connectionString: DATABASE_URL });
    try {
      // The receipt was already looked up past this point, so deleting it
      // must not turn the replay into a missing-row error: the guard denies
      // on the looked-up row instead.
      await writer.query("DELETE FROM artifacts.operation_receipts WHERE internal_key = 'key-replay-del'");
      await writer.query("UPDATE commit_test.approvals SET approved = false WHERE actor_id = 'actor-1'");
      barrier.release('after_replay_lookup_before_guard', 'inv-replay-del');
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
    } finally {
      await writer.query("UPDATE commit_test.approvals SET approved = true WHERE actor_id = 'actor-1'");
      await writer.end();
    }
  });

  it('maps the key-row lock timeout to a non-retriable conflict', async () => {
    await pool.query(
      `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
       VALUES ('scope-l3', 'key-lock-timeout') ON CONFLICT DO NOTHING`,
    );
    const locker = new Pool({ connectionString: DATABASE_URL });
    const lockerClient = await locker.connect();
    const inner = createPostgresCommitExecutor(pool);
    const executor: CommitExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        const connection = await inner.beginFinalization();
        const realLock = connection.lockOperationKey.bind(connection);
        connection.lockOperationKey = (async (scopeId: string, internalKey: string) => {
          await connection.query("SET LOCAL lock_timeout = '100ms'", []);
          return realLock(scopeId, internalKey);
        }) as FinalizeConnection['lockOperationKey'];
        return connection;
      },
    };
    try {
      await lockerClient.query('BEGIN');
      await lockerClient.query(
        `SELECT 1 FROM artifacts.operation_keys
         WHERE storage_scope_id = 'scope-l3' AND internal_key = 'key-lock-timeout' FOR UPDATE`,
      );
      const coordinator = createArtifactCommitCoordinator({
        executor,
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(
        baseRequest({ key: 'key-lock-timeout', commandHash: 'h-lock-timeout' }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('conflict');
      expect(outcome.failure.variant).toBe('key_contention');
      expect(outcome.failure.httpStatus).toBe(409);
      expect(outcome.failure.retriable).toBe(false);
      expect(outcome.failure.phase).toBe('lock');
      expect(outcome.failure.commitState).toBe('not_committed');
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-lock-timeout'])).toBe(0);
    } finally {
      await lockerClient.query('ROLLBACK');
      lockerClient.release();
      await locker.end();
    }
  });

  it('maps a quota-row lock timeout to retriable unavailability', async () => {
    // Characterization: only the scoped key-row lock timeout is a qualified
    // key conflict; every other lock timeout stays retriable unavailability.
    const locker = new Pool({ connectionString: DATABASE_URL });
    const lockerClient = await locker.connect();
    const factory = makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main');
    const lockingFactory: CommitPolicyParticipantFactory = {
      createParticipant: (client, token) => {
        const participant = factory.createParticipant(client, token);
        return {
          ...participant,
          reserveQuota: async (input: { actorId: string; operation: string }) => {
            await client.query("SET LOCAL lock_timeout = '100ms'", []);
            return participant.reserveQuota(input);
          },
        };
      },
    };
    try {
      await lockerClient.query('BEGIN');
      await lockerClient.query("SELECT used FROM commit_test.quotas WHERE quota_key = 'q-main' FOR UPDATE");
      const coordinator = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(pool),
        policy: lockingFactory,
      });
      const outcome = await coordinator.finalize(
        baseRequest({ key: 'key-quota-timeout', commandHash: 'h-quota-timeout' }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('provider_unavailable');
      expect(outcome.failure.httpStatus).toBe(503);
      expect(outcome.failure.retriable).toBe(true);
      expect(outcome.failure.commitState).toBe('not_committed');
    } finally {
      await lockerClient.query('ROLLBACK');
      lockerClient.release();
      await locker.end();
    }
  });

  it('classifies serialization, deadlock and cancel errors as retriable', async () => {
    const throwingExecutor = (thrown: unknown): CommitExecutor => ({
      ensureCoordinationRow: async () => {},
      beginFinalization: async () => {
        throw thrown;
      },
    });
    for (const code of ['40001', '40P01', '57014']) {
      const coordinator = createArtifactCommitCoordinator({
        executor: throwingExecutor(boom(code)),
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(baseRequest({ key: `key-cls-${code}` }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.failure.category).toBe('provider_unavailable');
      expect(outcome.failure.httpStatus).toBe(503);
      expect(outcome.failure.retriable).toBe(true);
      expect(outcome.failure.phase).toBe('acquire');
      expect(outcome.failure.commitState).toBe('not_committed');
    }
    const coordinator = createArtifactCommitCoordinator({
      executor: throwingExecutor(boom('XX999')),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const outcome = await coordinator.finalize(baseRequest({ key: 'key-cls-other' }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('provider_error');
    expect(outcome.failure.httpStatus).toBe(500);
    expect(outcome.failure.retriable).toBe(false);
  });

  it('returns an outcome instead of rejecting when acquisition fails', async () => {
    const refused: CommitExecutor = {
      ensureCoordinationRow: async () => {
        throw boom('ECONNREFUSED');
      },
      beginFinalization: async () => {
        throw new Error('unreachable');
      },
    };
    const refusedCoordinator = createArtifactCommitCoordinator({
      executor: refused,
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const refusedOutcome = await refusedCoordinator.finalize(baseRequest({ key: 'key-acq-refused' }));
    expect(refusedOutcome.ok).toBe(false);
    if (refusedOutcome.ok) return;
    expect(refusedOutcome.failure.category).toBe('provider_unavailable');
    expect(refusedOutcome.failure.httpStatus).toBe(503);
    expect(refusedOutcome.failure.commitState).toBe('not_committed');
    const broken: CommitExecutor = {
      ensureCoordinationRow: async () => {},
      beginFinalization: async () => {
        throw boom('XX000');
      },
    };
    const brokenCoordinator = createArtifactCommitCoordinator({
      executor: broken,
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const brokenOutcome = await brokenCoordinator.finalize(baseRequest({ key: 'key-acq-broken' }));
    expect(brokenOutcome.ok).toBe(false);
    if (brokenOutcome.ok) return;
    expect(brokenOutcome.failure.category).toBe('provider_error');
    expect(brokenOutcome.failure.httpStatus).toBe(500);
  });

  it('reports server-side commit with lost acknowledgment as unknown, then replays', async () => {
    // Characterization: the unknown outcome and same-key replay recovery hold
    // when COMMIT really landed on the server before the acknowledgment loss.
    const sabotaged = new Pool({ connectionString: DATABASE_URL });
    const inner = createPostgresCommitExecutor(sabotaged);
    let sabotageArmed = true;
    const sabotagingExecutor: CommitExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        const connection = await inner.beginFinalization();
        const realCommit = connection.commit.bind(connection);
        connection.commit = (async () => {
          // Commit for real on the server, then lose the acknowledgment.
          await realCommit();
          if (sabotageArmed) {
            sabotageArmed = false;
            throw boom('57P06');
          }
        }) as FinalizeConnection['commit'];
        return connection;
      },
    };
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: sabotagingExecutor,
        policy: makeParticipantFactory(sabotaged, { nowMs: Date.now() }, 'q-main'),
      });
      const first = await coordinator.finalize(
        baseRequest({ key: 'key-unknown-real', commandHash: 'h-unknown-real' }),
      );
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.failure.category).toBe('provider_unavailable');
      expect(first.failure.commitState).toBe('unknown');
      const retry = await coordinator.finalize(
        baseRequest({ key: 'key-unknown-real', commandHash: 'h-unknown-real' }),
      );
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      expect(retry.replayed).toBe(true);
      expect(retry.commitState).toBe('committed');
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-unknown-real'])).toBe(1);
    } finally {
      await sabotaged.end();
    }
  });

  it('disposes the client when BEGIN fails and returns an outcome', async () => {
    const tracked = trackingPool();
    const realConnect = (tracked.pool as unknown as { connect: Pool['connect'] }).connect.bind(tracked.pool);
    const breaking = {
      query: (tracked.pool as unknown as Pool).query.bind(tracked.pool),
      connect: async () => {
        const client = await realConnect();
        const realQuery = client.query.bind(client);
        client.query = (async (text: unknown, params?: unknown[]) => {
          if (typeof text === 'string' && text.startsWith('BEGIN')) throw boom('XX000');
          return realQuery(text as string, params as never[]);
        }) as typeof client.query;
        return client;
      },
      end: tracked.pool.end.bind(tracked.pool),
    };
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(breaking as unknown as Pool),
        policy: makeParticipantFactory(breaking as unknown as Pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(baseRequest({ key: 'key-begin-fail' }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('provider_error');
      expect(outcome.failure.commitState).toBe('not_committed');
      expect(tracked.active()).toBe(0);
    } finally {
      await endPool(tracked.pool);
    }
  });

  it('settles the resolve transaction once when its lock read fails', async () => {
    const tracked = trackingPool();
    const inner = createPostgresCommitExecutor(tracked.pool);
    let begins = 0;
    const sabotagingExecutor: CommitExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        begins += 1;
        const connection = await inner.beginFinalization();
        if (begins === 1) {
          connection.insertReceipt = (async () => {
            throw boom('23505');
          }) as FinalizeConnection['insertReceipt'];
        } else {
          connection.lockOperationKey = (async () => {
            throw boom('XX001');
          }) as FinalizeConnection['lockOperationKey'];
        }
        return connection;
      },
    };
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: sabotagingExecutor,
        policy: makeParticipantFactory(tracked.pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(baseRequest({ key: 'key-resolve-settle' }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('provider_error');
      expect(outcome.failure.commitState).toBe('not_committed');
      expect(tracked.active()).toBe(0);
    } finally {
      await endPool(tracked.pool);
    }
  });

  it('keeps the denial when the abandonment hook fails', async () => {
    const tracked = trackingPool();
    const deniedGuard = async (): Promise<ArtifactAuthorizationDecision> => ({
      allowed: false,
      reason: 'denied',
      publicCode: 'access_denied',
      status: 403,
      retriable: false,
    });
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(tracked.pool),
        policy: makeParticipantFactory(tracked.pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(
        baseRequest({
          key: 'key-deny-abandon',
          commandHash: 'h-deny-abandon',
          guard: deniedGuard,
          attemptId: 'attempt-deny-abandon',
          noteAbandonedAttempt: async () => {
            throw new Error('cleanup failed');
          },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('unauthorized_at_commit');
      expect(outcome.failure.httpStatus).toBe(403);
      expect(tracked.active()).toBe(0);
      expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-deny-abandon'])).toBe(0);
    } finally {
      await tracked.pool.end();
    }
  });

  it('marks invalid-fence attempts abandoned', async () => {
    const abandoned: string[] = [];
    const foreignFenceGuard = async (
      context: ArtifactCommitContext,
    ): Promise<ArtifactAuthorizationDecision> => ({
      allowed: true,
      fence: {
        fenceId: 'unrelated-fence',
        transactionId: 'unrelated-transaction',
        invocationId: context.invocationId,
        policyRevision: 'rev-1',
      },
    });
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const outcome = await coordinator.finalize(
      baseRequest({
        key: 'key-fence-abandon',
        commandHash: 'h-fence-abandon',
        invocationId: 'inv-fence-abandon',
        guard: foreignFenceGuard,
        attemptId: 'attempt-fence-abandon',
        noteAbandonedAttempt: async (attemptId: string) => {
          abandoned.push(attemptId);
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(abandoned).toEqual(['attempt-fence-abandon']);
  });

  it('settles once and abandons on quarantine', async () => {
    const tracked = trackingPool();
    const abandoned: string[] = [];
    await pool.query(
      `INSERT INTO artifacts.operation_receipts (storage_scope_id, internal_key, command_codec, command_hash, receipt)
       VALUES ('scope-l3', 'key-legacy-settle', 'legacy-0.1', 'h-legacy-settle', '{"releaseId": "r-old"}')`,
    );
    await pool.query(
      `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
       VALUES ('scope-l3', 'key-legacy-settle') ON CONFLICT DO NOTHING`,
    );
    try {
      const coordinator = createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(tracked.pool),
        policy: makeParticipantFactory(tracked.pool, { nowMs: Date.now() }, 'q-main'),
      });
      await expect(
        coordinator.finalize(
          baseRequest({
            key: 'key-legacy-settle',
            commandHash: 'h-legacy-settle',
            attemptId: 'attempt-legacy-settle',
            noteAbandonedAttempt: async (attemptId: string) => {
              abandoned.push(attemptId);
            },
          }),
        ),
      ).rejects.toThrow('commit quarantine');
      expect(tracked.active()).toBe(0);
      expect(abandoned).toEqual(['attempt-legacy-settle']);
    } finally {
      await tracked.pool.end();
    }
  });

  it('rejects unknown request codecs before touching storage', async () => {
    const coordinator = createArtifactCommitCoordinator({
      executor: createPostgresCommitExecutor(pool),
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    await expect(
      coordinator.finalize(baseRequest({ key: 'key-bad-codec', codecVersion: 'unknown-codec' })),
    ).rejects.toThrow('supported command codec');
    await expect(
      coordinator.replayGuarded(baseRequest({ key: 'key-bad-codec', codecVersion: 'unknown-codec' })),
    ).rejects.toThrow('supported command codec');
    expect(await countRows('artifacts.operation_keys', ' WHERE internal_key = $1', ['key-bad-codec'])).toBe(0);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-bad-codec'])).toBe(0);
  });

  it('rejects arming a preparation-only test point', async () => {
    const coordinatorOf = (): unknown =>
      createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(pool),
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
        testPoints: ['before_blob_put' as CoordinatorTestPoint],
      });
    expect(coordinatorOf).toThrow('unknown coordinator test point');
  });
});

describe('coordinator sol-r2 regressions', () => {
  interface StubLog {
    statements: string[];
    commits: number;
    rollbacks: number;
    releases: number;
  }

  const makeStubExecutor = (hooks?: {
    commit?: () => Promise<void>;
    existing?: StoredCommitReceipt | undefined;
  }): { executor: CommitExecutor; log: StubLog } => {
    const log: StubLog = { statements: [], commits: 0, rollbacks: 0, releases: 0 };
    const connection: FinalizeConnection = {
      query: async <T>(
        text: string,
        _params: readonly unknown[],
      ): Promise<{ rows: T[]; rowCount: number }> => {
        log.statements.push(text);
        return { rows: [], rowCount: 0 };
      },
      beginReadCommitted: async () => {},
      lockOperationKey: async () => {},
      readReceipt: async () => hooks?.existing,
      insertReceipt: async () => {},
      commit: async () => {
        log.commits += 1;
        await hooks?.commit?.();
      },
      rollback: async () => {
        log.rollbacks += 1;
      },
      release: (_error?: unknown) => {
        log.releases += 1;
      },
    };
    return {
      log,
      executor: {
        ensureCoordinationRow: async () => {},
        beginFinalization: async () => connection,
      },
    };
  };

  const makeStubPolicy = (): CommitPolicyParticipantFactory => ({
    createParticipant: (
      _client: FinalizeTxClient,
      transactionToken: string,
    ): CommitPolicyParticipant => ({
      readRevision: async () => 'rev-1',
      checkApproval: async () => ({ approved: true as const }),
      reserveQuota: async () => ({ reserved: true }),
      mintFence: (revision: string, invocationId: string) => ({
        fenceId: `fence-${transactionToken}`,
        transactionId: transactionToken,
        invocationId,
        policyRevision: revision,
      }),
    }),
  });

  const failUnlessFlushed = (
    log: StubLog,
    transaction: ArtifactCommitTransaction,
    context: ArtifactCommitContext,
  ): Promise<ArtifactAuthorizationDecision> => {
    const flushed = log.statements.some((text) => text === 'SET CONSTRAINTS ALL IMMEDIATE');
    if (!flushed) {
      return Promise.resolve({
        allowed: false as const,
        reason: 'expired' as const,
        publicCode: 'access_denied',
        status: 403,
        retriable: false,
      });
    }
    return Promise.resolve({
      allowed: true as const,
      fence: transaction.participant.mintFence(context.policyRevision, context.invocationId),
    });
  };

  it('flushes deferred work before the final authorization decision', async () => {
    const { executor, log } = makeStubExecutor();
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    let calls = 0;
    const guard = async (
      context: ArtifactCommitContext,
      transaction: ArtifactCommitTransaction,
    ): Promise<ArtifactAuthorizationDecision> => {
      calls += 1;
      if (calls === 1) {
        return {
          allowed: true as const,
          fence: transaction.participant.mintFence(context.policyRevision, context.invocationId),
        };
      }
      return failUnlessFlushed(log, transaction, context);
    };
    const outcome = await coordinator.finalize(
      baseRequest({ key: 'key-deferred-flush', commandHash: 'h-flush', guard }),
    );
    expect(calls).toBe(2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.commitState).toBe('committed');
    expect(log.commits).toBe(1);
  });

  it('flushes deferred work before the guarded replay decision', async () => {
    const key = 'key-replay-flush';
    const commandHash = 'h-replay-flush';
    const existing: StoredCommitReceipt = {
      scopeId: 'scope-l3',
      internalKey: key as InternalIdempotencyKey,
      commandHash,
      codecVersion: 'artifacts-command/v1',
      receipt: {},
      createdAt: new Date(0).toISOString(),
    };
    const { executor, log } = makeStubExecutor({ existing });
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const guard = async (
      context: ArtifactCommitContext,
      transaction: ArtifactCommitTransaction,
    ): Promise<ArtifactAuthorizationDecision> => failUnlessFlushed(log, transaction, context);
    const outcome = await coordinator.replayGuarded(baseRequest({ key, commandHash, guard }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.replayed).toBe(true);
    expect(outcome.commitState).toBe('committed');
  });

  it('rejects a same-transaction fence that was never minted', async () => {
    const { executor } = makeStubExecutor();
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const guard = async (
      context: ArtifactCommitContext,
      transaction: ArtifactCommitTransaction,
    ): Promise<ArtifactAuthorizationDecision> => ({
      allowed: true as const,
      fence: {
        fenceId: 'never-minted',
        transactionId: transaction.transactionId,
        invocationId: context.invocationId,
        policyRevision: context.policyRevision,
      },
    });
    const outcome = await coordinator.finalize(
      baseRequest({ key: 'key-unminted', commandHash: 'h-unminted', guard }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(outcome.failure.httpStatus).toBe(403);
    expect(outcome.failure.commitState).toBe('not_committed');
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-unminted'])).toBe(0);
  });

  it('rejects an unminted fence on guarded replay', async () => {
    const key = 'key-unminted-replay';
    const commandHash = 'h-unminted-replay';
    const existing: StoredCommitReceipt = {
      scopeId: 'scope-l3',
      internalKey: key as InternalIdempotencyKey,
      commandHash,
      codecVersion: 'artifacts-command/v1',
      receipt: {},
      createdAt: new Date(0).toISOString(),
    };
    const { executor } = makeStubExecutor({ existing });
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const guard = async (
      context: ArtifactCommitContext,
      transaction: ArtifactCommitTransaction,
    ): Promise<ArtifactAuthorizationDecision> => ({
      allowed: true as const,
      fence: {
        fenceId: 'never-minted-replay',
        transactionId: transaction.transactionId,
        invocationId: context.invocationId,
        policyRevision: context.policyRevision,
      },
    });
    const outcome = await coordinator.replayGuarded(baseRequest({ key, commandHash, guard }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('unauthorized_at_commit');
    expect(outcome.failure.commitState).toBe('not_committed');
  });

  it('reports unacknowledged commit loss as unknown, not not_committed', async () => {
    const commitLoss = async (): Promise<void> => {
      const error = new Error('lost commit acknowledgment') as Error & { code?: string };
      error.code = 'artifact_connection_lost';
      throw error;
    };
    const { executor } = makeStubExecutor({ commit: commitLoss });
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const outcome = await coordinator.finalize(
      baseRequest({ key: 'key-ack-loss', commandHash: 'h-ack-loss' }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.category).toBe('provider_unavailable');
    expect(outcome.failure.httpStatus).toBe(503);
    expect(outcome.failure.retriable).toBe(true);
    expect(outcome.failure.commitState).toBe('unknown');
  });

  it('reports an unclassified commit error as unknown once commit was attempted', async () => {
    const commitBoom = async (): Promise<void> => {
      const error = new Error('commit blew up') as Error & { code?: string };
      error.code = 'XX000';
      throw error;
    };
    const { executor } = makeStubExecutor({ commit: commitBoom });
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const outcome = await coordinator.finalize(
      baseRequest({ key: 'key-commit-boom', commandHash: 'h-commit-boom' }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.commitState).toBe('unknown');
  });

  it('maps receipt-table contention to retriable unavailability', async () => {
    await pool.query(
      `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
       VALUES ('scope-l3', 'key-receipt-lock') ON CONFLICT DO NOTHING`,
    );
    const locker = new Pool({ connectionString: DATABASE_URL });
    const lockerClient = await locker.connect();
    const inner = createPostgresCommitExecutor(pool);
    const executor: CommitExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        const connection = await inner.beginFinalization();
        const realRead = connection.readReceipt.bind(connection);
        connection.readReceipt = (async (scopeId: string, internalKey: string) => {
          await connection.query("SET LOCAL lock_timeout = '200ms'", []);
          return realRead(scopeId, internalKey);
        }) as FinalizeConnection['readReceipt'];
        return connection;
      },
    };
    try {
      await lockerClient.query('BEGIN');
      await lockerClient.query('LOCK TABLE artifacts.operation_receipts IN ACCESS EXCLUSIVE MODE');
      const coordinator = createArtifactCommitCoordinator({
        executor,
        policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
      });
      const outcome = await coordinator.finalize(
        baseRequest({ key: 'key-receipt-lock', commandHash: 'h-receipt-lock' }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.category).toBe('provider_unavailable');
      expect(outcome.failure.httpStatus).toBe(503);
      expect(outcome.failure.retriable).toBe(true);
      expect(outcome.failure.commitState).toBe('not_committed');
    } finally {
      // Release the ACCESS EXCLUSIVE holder before reading: the receipt
      // lookup below would otherwise queue behind this test's own lock.
      await lockerClient.query('ROLLBACK');
      lockerClient.release();
      await locker.end();
    }
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', ['key-receipt-lock'])).toBe(0);
  });

  it('settles the unit when a hook raises quarantine before settlement', async () => {
    const inner = createPostgresCommitExecutor(pool);
    let rollbacks = 0;
    let releases = 0;
    const executor: CommitExecutor = {
      ensureCoordinationRow: inner.ensureCoordinationRow.bind(inner),
      beginFinalization: async () => {
        const connection = await inner.beginFinalization();
        const realRollback = connection.rollback.bind(connection);
        const realRelease = connection.release.bind(connection);
        connection.rollback = (async () => {
          rollbacks += 1;
          return realRollback();
        }) as FinalizeConnection['rollback'];
        connection.release = ((error?: unknown) => {
          releases += 1;
          realRelease(error);
        }) as FinalizeConnection['release'];
        return connection;
      },
    };
    const coordinator = createArtifactCommitCoordinator({
      executor,
      policy: makeParticipantFactory(pool, { nowMs: Date.now() }, 'q-main'),
    });
    const key = 'key-hook-quarantine';
    await expect(
      coordinator.finalize(
        baseRequest({
          key,
          commandHash: 'h-hook-quarantine',
          provisional: async () => {
            throw new CommitQuarantineError('scope-l3', key, 'legacy-9.9');
          },
        }),
      ),
    ).rejects.toThrow('commit quarantine');
    expect(rollbacks).toBe(1);
    expect(releases).toBe(1);
  });

  it('carries the frozen operational kind on produced failures', async () => {
    const { executor } = makeStubExecutor();
    const coordinator = createArtifactCommitCoordinator({ executor, policy: makeStubPolicy() });
    const denied = async (): Promise<ArtifactAuthorizationDecision> => ({
      allowed: false as const,
      reason: 'denied' as const,
      publicCode: 'access_denied',
      status: 403,
      retriable: false,
    });
    const outcome = await coordinator.finalize(
      baseRequest({ key: 'key-kind', commandHash: 'h-kind', guard: denied }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect((outcome.failure as { kind?: unknown }).kind).toBe('operational');
    const frozen: FrozenArtifactFailure = outcome.failure;
    expect(frozen.kind).toBe('operational');
  });

  it('keeps the coordinator points inside the frozen barrier points', () => {
    const frozenPoints: readonly FrozenBarrierPoint[] = COORDINATOR_TEST_POINTS;
    expect([...frozenPoints]).toEqual([
      'before_connection_acquire',
      'before_key_lock',
      'before_finalization_row_lock',
      'after_finalization_locks_before_guard',
      'after_replay_lookup_before_guard',
      'before_commit',
    ]);
  });
});
