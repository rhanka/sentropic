/**
 * L3 (immo #861) — typed Radar construction example (conductor-directed).
 *
 * Shows the exact construction Radar wires: a real coordinator over the
 * PostgreSQL executor, a transaction-bound PG policy/quota participant
 * registered at construction, fence minting in the host guard, and the
 * preparation-abandonment queue bound to a cleanup sweeper. Imports only
 * L3 src modules. The compiled profile and the app construction stay
 * L6-provided: pass this coordinator plus L1's compiled profile to
 * `createHttpArtifactApp` (r2 section 3.2); nothing here invents that seam.
 * The `radar_commit_example` tables below are illustrative host tables so
 * the example runs standalone; Radar's real adapter owns its own tables.
 */
import type { Pool } from 'pg';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import type {
  ArtifactAuthorizationDecision,
  ArtifactCommitContext,
  ArtifactCommitTransaction,
  CommitPolicyParticipant,
  CommitPolicyParticipantFactory,
  CommitCoordinatorOptions,
  CoordinatorTestPoint,
  FinalizationCoordinator,
  FinalizeRequest,
  FinalizeResult,
  InternalIdempotencyKey,
} from '../src/server/commit/types.js';

/** One abandoned preparation awaiting host cleanup. */
export interface AbandonedAttempt {
  readonly attemptId: string;
  readonly scopeId: string;
  readonly internalKey: string;
  readonly atMs: number;
}

/** Create the illustrative host tables and seed one approved actor plus quota. */
export async function prepareRadarCommitExample(pool: Pool): Promise<void> {
  await pool.query('CREATE SCHEMA IF NOT EXISTS radar_commit_example');
  await pool.query(
    `CREATE TABLE IF NOT EXISTS radar_commit_example.policy_revision
       (id INT PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)`,
  );
  await pool.query(
    `INSERT INTO radar_commit_example.policy_revision (id, revision)
     VALUES (1, 'rev-1') ON CONFLICT (id) DO UPDATE SET revision = 'rev-1'`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS radar_commit_example.approvals
       (actor_id TEXT PRIMARY KEY, approved BOOLEAN NOT NULL, expires_at_ms BIGINT NOT NULL)`,
  );
  await pool.query(
    `INSERT INTO radar_commit_example.approvals (actor_id, approved, expires_at_ms)
     VALUES ('radar-actor', true, 9999999999999)
     ON CONFLICT (actor_id) DO UPDATE SET approved = true, expires_at_ms = 9999999999999`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS radar_commit_example.quotas
       (quota_key TEXT PRIMARY KEY, total INT NOT NULL, used INT NOT NULL)`,
  );
  await pool.query(
    `INSERT INTO radar_commit_example.quotas (quota_key, total, used)
     VALUES ('radar-quota', 100, 0) ON CONFLICT (quota_key) DO UPDATE SET used = 0`,
  );
}

/** The host guard Radar wires: current revision, approval and fence minting. */
export async function allowRadarGuard(
  context: ArtifactCommitContext,
  transaction: ArtifactCommitTransaction,
): Promise<ArtifactAuthorizationDecision> {
  const revision = await transaction.participant.readRevision();
  if (context.policyRevision !== revision) {
    return {
      allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false,
    };
  }
  const check = await transaction.participant.checkApproval({
    actorId: context.actorId,
    operation: context.operation,
  });
  if (!check.approved) {
    return {
      allowed: false, reason: check.reason ?? 'denied',
      publicCode: 'access_denied', status: 403, retriable: false,
    };
  }
  return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
}

const createParticipantFactory = (
  quotaKey: string,
  clock: { nowMs: number },
): CommitPolicyParticipantFactory => ({
  createParticipant: (client, transactionToken): CommitPolicyParticipant => ({
    async readRevision(): Promise<string> {
      const { rows } = await client.query<{ revision: string }>(
        'SELECT revision FROM radar_commit_example.policy_revision WHERE id = 1 FOR SHARE',
        [],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('missing policy revision');
      return row.revision;
    },
    async checkApproval(input: { actorId: string }) {
      const { rows } = await client.query<{ approved: boolean; expires_at_ms: string }>(
        'SELECT approved, expires_at_ms FROM radar_commit_example.approvals WHERE actor_id = $1',
        [input.actorId],
      );
      const row = rows[0];
      if (row === undefined || !row.approved) return { approved: false as const, reason: 'denied' as const };
      if (Number(row.expires_at_ms) <= clock.nowMs) {
        return { approved: false as const, reason: 'expired' as const };
      }
      return { approved: true as const };
    },
    async reserveQuota(): Promise<{ reserved: boolean }> {
      const { rowCount } = await client.query(
        'UPDATE radar_commit_example.quotas SET used = used + 1 WHERE quota_key = $1 AND used < total',
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

export interface RadarCommitInput {
  readonly scopeId: string;
  readonly internalKey: string;
  readonly commandHash: string;
  readonly invocationId: string;
  readonly operation: string;
  readonly receiptData: unknown;
}

export interface RadarCommitSetup {
  readonly coordinator: FinalizationCoordinator;
  readonly abandonedAttempts: AbandonedAttempt[];
  finalize(input: RadarCommitInput): Promise<FinalizeResult>;
  replayGuarded(input: RadarCommitInput): Promise<FinalizeResult>;
  drainAbandonedAttempts(onSweep: (batch: AbandonedAttempt[]) => void): void;
  startAbandonedAttemptSweep(
    onSweep: (batch: AbandonedAttempt[]) => void | Promise<void>,
    intervalMs: number,
  ): () => void;
}

/**
 * Build the exact Radar construction over one pool. The optional
 * `testObserver` forwards barrier observations to the coordinator;
 * `testPoints` optionally filters them (see `testing.ts`).
 */
export function createRadarCommitSetup(options: {
  pool: Pool;
  clock: { nowMs: number };
  quotaKey?: string;
  testObserver?: CommitCoordinatorOptions['testObserver'];
  testPoints?: readonly CoordinatorTestPoint[];
}): RadarCommitSetup {
  const quotaKey = options.quotaKey ?? 'radar-quota';
  const abandonedAttempts: AbandonedAttempt[] = [];
  const coordinator = createArtifactCommitCoordinator({
    executor: createPostgresCommitExecutor(options.pool),
    policy: createParticipantFactory(quotaKey, options.clock),
    nowMs: () => options.clock.nowMs,
    testObserver: options.testObserver,
    testPoints: options.testPoints,
  });
  const toRequest = (
    input: RadarCommitInput,
  ): FinalizeRequest & { attemptId: string } => ({
    scopeId: input.scopeId,
    internalKey: input.internalKey as InternalIdempotencyKey,
    commandHash: input.commandHash,
    codecVersion: 'artifacts-command/v1',
    invocationId: input.invocationId,
    actorId: 'radar-actor',
    operation: input.operation,
    artifactId: null,
    bindingName: null,
    policyRevision: 'rev-1',
    guard: allowRadarGuard,
    receiptData: input.receiptData,
    attemptId: input.invocationId,
    noteAbandonedAttempt: async (attemptId: string) => {
      abandonedAttempts.push({
        attemptId,
        scopeId: input.scopeId,
        internalKey: input.internalKey,
        atMs: options.clock.nowMs,
      });
    },
  });
  const drainAbandonedAttempts = (onSweep: (batch: AbandonedAttempt[]) => void): void => {
    if (abandonedAttempts.length === 0) return;
    // Retain-then-remove: a throwing sweeper keeps the batch for the next
    // sweep instead of losing it. Durable cleanup state, per-attempt
    // deadlines and restart recovery stay L4-owned (intent metadata).
    const batch = abandonedAttempts.slice();
    onSweep(batch);
    abandonedAttempts.splice(0, batch.length);
  };
  return {
    coordinator,
    abandonedAttempts,
    finalize: (input: RadarCommitInput) => coordinator.finalize(toRequest(input)),
    replayGuarded: (input: RadarCommitInput) => coordinator.replayGuarded(toRequest(input)),
    drainAbandonedAttempts,
    startAbandonedAttemptSweep: (onSweep, intervalMs) => {
      // Serialized sweeps: an overlapping tick queues behind the running
      // sweep instead of sweeping concurrently, and only the swept entries
      // are removed, so arrivals landing mid-sweep are never deleted.
      let sweeping = false;
      let queued = false;
      const runSweep = (): void => {
        if (sweeping) {
          queued = true;
          return;
        }
        sweeping = true;
        void (async () => {
          try {
            do {
              queued = false;
              const batch = abandonedAttempts.slice();
              try {
                await onSweep(batch);
              } catch {
                /* retained for the next sweep */
                break;
              }
              for (const entry of batch) {
                const index = abandonedAttempts.indexOf(entry);
                if (index !== -1) abandonedAttempts.splice(index, 1);
              }
            } while (queued);
          } finally {
            sweeping = false;
          }
        })();
      };
      const timer = setInterval(runSweep, intervalMs);
      return () => clearInterval(timer);
    },
  };
}
