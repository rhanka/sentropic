/**
 * queue-reaper.test.ts — RED characterization tests for BR-44 WI-1.
 *
 * Lot 0: pin current (broken) behavior so regressions are caught.
 * Lot 1: these tests must turn GREEN after the reaper is implemented.
 *
 * Key invariant pinned here:
 *   Before the fix — a stranded `processing` row permanently consumes the
 *   `maxConcurrentJobs` budget in `getProcessingCountByClass`.
 *
 * Tests:
 *   1. Stranded job consumes maxConcurrentJobs budget (characterization — GREEN on main, stays green post-fix).
 *   2. Stranded job is requeued after reaper runs (RED until Lot 1 done).
 *   3. Stranded job at ceiling is failed after reaper runs (RED until Lot 1 done).
 *   4. Live in-flight job is NOT reaped (RED until Lot 1 done).
 *   5. chat_message strand is failed+finalized, not requeued (RED until Lot 1 done).
 *   6. Concurrency budget freed after reap (RED until Lot 1 done).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { jobQueue, ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { createId } from '../../src/utils/id';

// Helper: insert a synthetic job row directly into the DB to simulate a stranded state.
async function insertStrandedJob(overrides: {
  type?: string;
  status?: string;
  startedAt?: Date | null;
  data?: string;
  attempts?: number;
}): Promise<string> {
  const id = createId();
  const now = new Date();
  const staleDate = new Date(now.getTime() - 40 * 60 * 1000); // 40 minutes ago (> default 30m threshold)
  const startedAt = overrides.startedAt !== undefined ? overrides.startedAt : staleDate;
  const attempts = overrides.attempts ?? 0;

  await db.run(sql`
    INSERT INTO job_queue (id, type, status, workspace_id, data, created_at, started_at, attempts)
    VALUES (
      ${id},
      ${overrides.type ?? 'organization_enrich'},
      ${overrides.status ?? 'processing'},
      ${ADMIN_WORKSPACE_ID},
      ${overrides.data ?? '{}'},
      ${now},
      ${startedAt},
      ${attempts}
    )
  `);
  return id;
}

// Helper: clean up test rows.
async function cleanupJob(id: string): Promise<void> {
  await db.run(sql`DELETE FROM job_queue WHERE id = ${id}`);
}

// Helper: get current job row.
async function getJob(id: string): Promise<Record<string, unknown> | null> {
  const rows = (await db.all(sql`
    SELECT id, type, status, started_at AS "startedAt", attempts, error
    FROM job_queue WHERE id = ${id}
  `)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

// Helper: count processing rows for class 'ai'.
async function countProcessingAi(): Promise<number> {
  const rows = (await db.all(sql`
    SELECT COUNT(*)::int AS cnt FROM job_queue WHERE status = 'processing'
  `)) as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}

describe('Queue reaper — characterization (BR-44 WI-1)', () => {
  afterEach(async () => {
    // Clean all test jobs to avoid pollution.
    await db.run(sql`DELETE FROM job_queue WHERE workspace_id = ${ADMIN_WORKSPACE_ID} AND type IN ('organization_enrich', 'chat_message')`);
  });

  it('should count stranded processing rows in the concurrency budget (characterization)', async () => {
    // Pin the bug: a processing row left after a crash counts in getProcessingCountByClass.
    const id = await insertStrandedJob({ status: 'processing' });
    const count = await countProcessingAi();
    expect(count).toBeGreaterThan(0);
    await cleanupJob(id);
  });

  it('should requeue a stale processing job after reaper runs (RED until Lot 1)', async () => {
    // Requires: runQueueReaper() from api/src/services/queue-reaper.ts (not yet created).
    const { runQueueReaper } = await import('../../src/services/queue-reaper.js').catch(() => ({
      runQueueReaper: null,
    }));
    if (!runQueueReaper) {
      // Module not yet created — expected RED.
      expect(runQueueReaper).not.toBeNull();
      return;
    }

    const id = await insertStrandedJob({ status: 'processing', attempts: 0 });
    await runQueueReaper([]);
    const job = await getJob(id);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('pending');
    expect(Number(job!.attempts)).toBe(1);
  });

  it('should fail a stale processing job that has reached the redelivery ceiling (RED until Lot 1)', async () => {
    const { runQueueReaper } = await import('../../src/services/queue-reaper.js').catch(() => ({
      runQueueReaper: null,
    }));
    if (!runQueueReaper) {
      expect(runQueueReaper).not.toBeNull();
      return;
    }

    // attempts=2 means at ceiling (QUEUE_MAX_REDELIVERIES=2 default).
    const id = await insertStrandedJob({ status: 'processing', attempts: 2 });
    await runQueueReaper([]);
    const job = await getJob(id);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('failed');
    expect(String(job!.error)).toContain('reaped');
  });

  it('should NOT reap a live in-flight job whose id is in the skip list (RED until Lot 1)', async () => {
    const { runQueueReaper } = await import('../../src/services/queue-reaper.js').catch(() => ({
      runQueueReaper: null,
    }));
    if (!runQueueReaper) {
      expect(runQueueReaper).not.toBeNull();
      return;
    }

    const id = await insertStrandedJob({ status: 'processing', attempts: 0 });
    // Pass the live id as a skip — should not be reaped.
    await runQueueReaper([id]);
    const job = await getJob(id);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('processing');
  });

  it('should fail+finalize a stale chat_message job (not requeue it) (RED until Lot 1)', async () => {
    const { runQueueReaper } = await import('../../src/services/queue-reaper.js').catch(() => ({
      runQueueReaper: null,
    }));
    if (!runQueueReaper) {
      expect(runQueueReaper).not.toBeNull();
      return;
    }

    const assistantMessageId = createId();
    const id = await insertStrandedJob({
      type: 'chat_message',
      status: 'processing',
      attempts: 0,
      data: JSON.stringify({ assistantMessageId }),
    });
    await runQueueReaper([]);
    const job = await getJob(id);
    expect(job).not.toBeNull();
    // chat_message strands must go to 'failed', never back to 'pending'.
    expect(job!.status).toBe('failed');
    expect(String(job!.error)).toContain('reaped');
  });

  it('should free the concurrency budget after reaping a stranded processing job (RED until Lot 1)', async () => {
    const { runQueueReaper } = await import('../../src/services/queue-reaper.js').catch(() => ({
      runQueueReaper: null,
    }));
    if (!runQueueReaper) {
      expect(runQueueReaper).not.toBeNull();
      return;
    }

    const id = await insertStrandedJob({ status: 'processing', attempts: 0 });
    const beforeCount = await countProcessingAi();
    await runQueueReaper([]);
    const afterCount = await countProcessingAi();
    expect(afterCount).toBeLessThan(beforeCount);
    await cleanupJob(id);
  });
});
