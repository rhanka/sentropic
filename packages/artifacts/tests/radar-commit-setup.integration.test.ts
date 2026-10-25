/**
 * L3 (immo #861) — runs the typed Radar construction example on real PostgreSQL.
 *
 * Proves the example builds: finalize commits one success row, denial
 * lands the attempt in the abandonment queue, the sweeper drains it, and
 * guarded replay charges no extra quota. Runs only under
 * `make test-artifacts-integration` (needs DATABASE_URL).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createArtifactCommitBarrier } from '../src/testing.js';
import {
  createRadarCommitSetup,
  prepareRadarCommitExample,
  type AbandonedAttempt,
} from '../examples/radar-commit-setup.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('example proof needs DATABASE_URL (make test-artifacts-integration)');
}

const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql'].map(
  (name) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'),
);

const pool = new Pool({ connectionString: DATABASE_URL });
const clock = { nowMs: Date.now() };

beforeAll(async () => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query('DROP SCHEMA IF EXISTS radar_commit_example CASCADE');
  for (const sql of MIGRATIONS) await setup.query(sql);
  await prepareRadarCommitExample(setup);
  await setup.end();
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS radar_commit_example CASCADE');
  await pool.end();
});

describe('radar commit setup example', () => {
  it('finalizes through the example construction', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    const outcome = await setup.finalizePrepared({
      scopeId: 'example-scope',
      internalKey: 'example-key-1',
      commandHash: 'h-example-1',
      invocationId: 'inv-example-1',
      operation: 'publish',
      receiptData: { releaseId: 'r-1' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.replayed).toBe(false);
    expect(outcome.commitState).toBe('committed');
    expect(outcome.result.internalKey).toBe('example-key-1');
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM artifacts.operation_receipts WHERE internal_key = 'example-key-1'`,
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it('queues denied attempts and drains them through the sweeper', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    await pool.query(
      "UPDATE radar_commit_example.approvals SET approved = false WHERE actor_id = 'radar-actor'",
    );
    try {
      const denied = await setup.finalizePrepared({
        scopeId: 'example-scope',
        internalKey: 'example-key-2',
        commandHash: 'h-example-2',
        invocationId: 'inv-example-2',
        operation: 'publish',
        receiptData: { releaseId: 'r-2' },
      });
      expect(denied.ok).toBe(false);
      expect(setup.abandonedAttempts.map((attempt) => attempt.attemptId)).toEqual(['inv-example-2']);
      const swept: AbandonedAttempt[][] = [];
      setup.drainAbandonedAttempts((batch) => {
        swept.push(batch);
      });
      expect(swept).toHaveLength(1);
      expect(swept[0]?.map((attempt) => attempt.attemptId)).toEqual(['inv-example-2']);
      expect(setup.abandonedAttempts).toHaveLength(0);
    } finally {
      await pool.query(
        "UPDATE radar_commit_example.approvals SET approved = true WHERE actor_id = 'radar-actor'",
      );
    }
  });

  it('retains the batch when the sweeper throws', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    setup.abandonedAttempts.push({
      attemptId: 'inv-sweep-throw',
      scopeId: 'example-scope',
      internalKey: 'example-key-throw',
      atMs: clock.nowMs,
    });
    expect(() =>
      setup.drainAbandonedAttempts(() => {
        throw new Error('sweep down');
      }),
    ).toThrow('sweep down');
    expect(setup.abandonedAttempts.map((attempt) => attempt.attemptId)).toEqual(['inv-sweep-throw']);
    const swept: AbandonedAttempt[][] = [];
    setup.drainAbandonedAttempts((batch) => {
      swept.push(batch);
    });
    expect(swept[0]?.map((attempt) => attempt.attemptId)).toEqual(['inv-sweep-throw']);
    expect(setup.abandonedAttempts).toHaveLength(0);
  });

  it('replays without an extra quota charge and sweeps on an interval', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    const first = await setup.finalizePrepared({
      scopeId: 'example-scope',
      internalKey: 'example-key-3',
      commandHash: 'h-example-3',
      invocationId: 'inv-example-3',
      operation: 'publish',
      receiptData: { releaseId: 'r-3' },
    });
    expect(first.ok).toBe(true);
    const { rows: before } = await pool.query<{ used: number }>(
      "SELECT used FROM radar_commit_example.quotas WHERE quota_key = 'radar-quota'",
    );
    const replayed = await setup.replayPrepared({
      scopeId: 'example-scope',
      internalKey: 'example-key-3',
      commandHash: 'h-example-3',
      invocationId: 'inv-example-3r',
      operation: 'publish',
      receiptData: { releaseId: 'r-3' },
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.replayed).toBe(true);
    const { rows: after } = await pool.query<{ used: number }>(
      "SELECT used FROM radar_commit_example.quotas WHERE quota_key = 'radar-quota'",
    );
    expect(after[0]?.used).toBe(before[0]?.used);
    setup.abandonedAttempts.push({
      attemptId: 'inv-sweep-probe',
      scopeId: 'example-scope',
      internalKey: 'example-key-3',
      atMs: clock.nowMs,
    });
    const swept: string[] = [];
    const stop = setup.startAbandonedAttemptSweep(
      (batch) => {
        swept.push(...batch.map((attempt) => attempt.attemptId));
      },
      5,
    );
    try {
      const deadline = Date.now() + 2000;
      while (swept.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(swept).toEqual(['inv-sweep-probe']);
    } finally {
      stop();
    }
  });

  it('keeps arrivals that land during an async sweep', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    setup.abandonedAttempts.push({
      attemptId: 'inv-sweep-a',
      scopeId: 'example-scope',
      internalKey: 'example-key-a',
      atMs: clock.nowMs,
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseLater!: () => void;
    const laterGate = new Promise<void>((resolve) => {
      releaseLater = resolve;
    });
    const batches: string[][] = [];
    const stop = setup.startAbandonedAttemptSweep(async (batch) => {
      const ids = batch.map((attempt) => attempt.attemptId);
      batches.push(ids);
      // The first sweep carries only the pre-sweep arrival; any follow-up
      // sweep (which would legitimately pick up later arrivals) stays parked
      // so the test observes the queue exactly after the first sweep.
      if (ids.includes('inv-sweep-a')) {
        await firstGate;
      } else {
        await laterGate;
      }
    }, 5);
    try {
      const startDeadline = Date.now() + 2000;
      while (batches.length === 0 && Date.now() < startDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(batches[0]).toEqual(['inv-sweep-a']);
      setup.abandonedAttempts.push({
        attemptId: 'inv-sweep-b',
        scopeId: 'example-scope',
        internalKey: 'example-key-b',
        atMs: clock.nowMs,
      });
      releaseFirst();
      const doneDeadline = Date.now() + 2000;
      while (setup.abandonedAttempts.length !== 1 && Date.now() < doneDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // The in-flight sweep removed only its own batch; the mid-sweep
      // arrival is still queued.
      expect(batches[0]).toEqual(['inv-sweep-a']);
      expect(setup.abandonedAttempts.map((attempt) => attempt.attemptId)).toEqual(['inv-sweep-b']);
      releaseLater();
    } finally {
      stop();
      setup.abandonedAttempts.length = 0;
    }
  });

  it('serializes overlapping interval sweeps', async () => {
    const setup = createRadarCommitSetup({ pool, clock });
    setup.abandonedAttempts.push(
      {
        attemptId: 'inv-overlap-1',
        scopeId: 'example-scope',
        internalKey: 'example-key-o1',
        atMs: clock.nowMs,
      },
      {
        attemptId: 'inv-overlap-2',
        scopeId: 'example-scope',
        internalKey: 'example-key-o2',
        atMs: clock.nowMs,
      },
    );
    let entered = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    let releaseSweep!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const stop = setup.startAbandonedAttemptSweep(async () => {
      entered += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate;
      concurrent -= 1;
    }, 5);
    try {
      const startDeadline = Date.now() + 2000;
      while (entered === 0 && Date.now() < startDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(entered).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(entered).toBe(1);
      releaseSweep();
      const doneDeadline = Date.now() + 2000;
      while (setup.abandonedAttempts.length > 0 && Date.now() < doneDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(setup.abandonedAttempts).toHaveLength(0);
      expect(maxConcurrent).toBe(1);
    } finally {
      stop();
      setup.abandonedAttempts.length = 0;
    }
  });

  it('forwards armed barrier observations through the example construction', async () => {
    const barrier = createArtifactCommitBarrier();
    const setup = createRadarCommitSetup({
      pool,
      clock,
      testObserver: barrier.observer,
      testPoints: ['before_commit'],
    });
    const pending = setup.finalizePrepared({
      scopeId: 'example-scope',
      internalKey: 'example-key-obs',
      commandHash: 'h-example-obs',
      invocationId: 'inv-example-obs',
      operation: 'publish',
      receiptData: { releaseId: 'r-obs' },
    });
    await barrier.waitUntilReached('before_commit', 'inv-example-obs');
    barrier.release('before_commit', 'inv-example-obs');
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
  });
});
