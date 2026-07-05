/**
 * producer-job-events.test.ts — BR-60 producer end-to-end test.
 *
 * Tests the ONE chosen producer (job_queue / job_events channel):
 *   1. queueManager.addJob() creates a job_queue row AND an outbox row in the same txn.
 *   2. The outbox row has aggregate_type='job_queue', channel='job_events'.
 *   3. After dispatch, the outbox row reaches 'dispatched' status.
 *
 * The existing SSE consumer (streams.ts) is UNCHANGED — it still listens on
 * 'job_events' directly. The outbox row is an additional durability guarantee.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { OutboxDispatcher } from '../../src/services/outbox/outbox-dispatcher';
import type { EventBusPort } from '../../src/services/outbox/event-bus';

class SpyEventBus implements EventBusPort {
  public calls: Array<{ channel: string; payload: unknown }> = [];
  async publish(channel: string, payload: unknown): Promise<void> {
    this.calls.push({ channel, payload });
  }
}

// Helper: get the outbox row for a job.
async function getOutboxRowForJob(jobId: string): Promise<Record<string, unknown> | null> {
  const rows = (await db.all(sql`
    SELECT id, aggregate_type, aggregate_id, seq, status, channel, envelope
    FROM control.event_outbox
    WHERE aggregate_type = 'job_queue' AND aggregate_id = ${jobId}
  `)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

// Helper: clean up test data.
async function cleanupTestData(jobId: string): Promise<void> {
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'job_queue' AND aggregate_id = ${jobId}`);
  await db.run(sql`DELETE FROM job_queue WHERE id = ${jobId}`);
}

describe('Producer: job_events end-to-end (BR-60)', () => {
  let queueManager: import('../../src/services/queue-manager').QueueManager;

  beforeEach(async () => {
    const mod = await import('../../src/services/queue-manager');
    queueManager = mod.queueManager;
  });

  afterEach(async () => {
    // Cleanup is done per test.
  });

  it('should create a job_queue row when addJob is called', async () => {
    const jobId = await queueManager.addJob('organization_enrich', {
      organizationId: 'test-org-e2e',
      organizationName: 'Test Org E2E',
    }, { workspaceId: ADMIN_WORKSPACE_ID });

    try {
      const rows = (await db.all(sql`
        SELECT id, type, status FROM job_queue WHERE id = ${jobId}
      `)) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('organization_enrich');
      expect(rows[0].status).toBe('pending');
    } finally {
      await cleanupTestData(jobId);
    }
  });

  it('should co-write an outbox row with aggregate_type=job_queue and channel=job_events', async () => {
    const jobId = await queueManager.addJob('organization_enrich', {
      organizationId: 'test-org-e2e-outbox',
      organizationName: 'Test Org E2E Outbox',
    }, { workspaceId: ADMIN_WORKSPACE_ID });

    try {
      const outboxRow = await getOutboxRowForJob(jobId);

      expect(outboxRow).not.toBeNull();
      expect(outboxRow!.aggregate_type).toBe('job_queue');
      expect(outboxRow!.aggregate_id).toBe(jobId);
      expect(outboxRow!.channel).toBe('job_events');
      expect(outboxRow!.status).toBe('pending');
      expect(Number(outboxRow!.seq)).toBe(1);
    } finally {
      await cleanupTestData(jobId);
    }
  });

  it('should dispatch the job_events outbox row via the dispatcher', async () => {
    const spy = new SpyEventBus();
    const dispatcher = new OutboxDispatcher({ maxAttempts: 3 }, spy);

    const jobId = await queueManager.addJob('organization_enrich', {
      organizationId: 'test-org-dispatch',
      organizationName: 'Test Org Dispatch',
    }, { workspaceId: ADMIN_WORKSPACE_ID });

    try {
      // Run a dispatch sweep.
      const result = await dispatcher.runDispatchSweep();
      expect(result.dispatched).toBeGreaterThanOrEqual(1);

      // Check the outbox row is now dispatched.
      const outboxRow = await getOutboxRowForJob(jobId);
      expect(outboxRow!.status).toBe('dispatched');

      // Check the spy received the job_events publish call.
      const publishCall = spy.calls.find((c) => c.channel === 'job_events');
      expect(publishCall).toBeTruthy();
    } finally {
      await cleanupTestData(jobId);
    }
  });

  it('should NOT modify existing SSE consumer behavior (backward compatibility)', async () => {
    // The streams.ts SSE consumer listens directly to 'job_events' NOTIFY.
    // queueManager.addJob still calls notifyJobEvent() directly after the transaction.
    // This test verifies addJob still works end-to-end without throwing.
    const jobId = await queueManager.addJob('initiative_list', {
      folderId: 'test-folder-compat',
      input: 'test',
    }, { workspaceId: ADMIN_WORKSPACE_ID });

    try {
      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');

      const rows = (await db.all(sql`
        SELECT id, status FROM job_queue WHERE id = ${jobId}
      `)) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
    } finally {
      await cleanupTestData(jobId);
    }
  });
});
