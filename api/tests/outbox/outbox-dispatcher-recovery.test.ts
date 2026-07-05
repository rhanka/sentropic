/**
 * outbox-dispatcher-recovery.test.ts — BR-60 dispatcher crash recovery tests.
 *
 * Tests:
 *   1. Stale `processing` rows are reclaimed (back to pending) by the recovery sweep.
 *   2. Stale `processing` rows at or above maxAttempts are marked `failed`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { OutboxDispatcher } from '../../src/services/outbox/outbox-dispatcher';
import type { EventBusPort } from '../../src/services/outbox/event-bus';

class NoopEventBus implements EventBusPort {
  async publish(_channel: string, _payload: unknown): Promise<void> {
    // no-op
  }
}

async function cleanupOutbox(): Promise<void> {
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'test_recovery'`);
}

async function insertStrandedOutboxRow(opts: {
  attempts: number;
  staleMinutesAgo?: number;
}): Promise<string> {
  const id = createId();
  const staleAgo = opts.staleMinutesAgo ?? 10;
  const claimedAt = new Date(Date.now() - staleAgo * 60 * 1000);

  await db.run(sql`
    INSERT INTO control.event_outbox
      (id, aggregate_type, aggregate_id, seq, envelope, status, attempts, claimed_at, channel, created_at)
    VALUES
      (${id}, 'test_recovery', ${createId()}, 1, '{}'::jsonb, 'processing', ${opts.attempts}, ${claimedAt}, 'test_channel', now())
  `);
  return id;
}

describe('Outbox dispatcher crash recovery (BR-60)', () => {
  afterEach(async () => {
    await cleanupOutbox();
  });

  it('should reclaim a stale processing row back to pending (below ceiling)', async () => {
    const dispatcher = new OutboxDispatcher(
      { staleMinutes: 5, maxAttempts: 3 },
      new NoopEventBus(),
    );

    const id = await insertStrandedOutboxRow({ attempts: 1, staleMinutesAgo: 10 });

    const result = await dispatcher.runDispatchSweep();

    const rows = (await db.all(sql`
      SELECT status, attempts, claimed_at
      FROM control.event_outbox WHERE id = ${id}
    `)) as Array<Record<string, unknown>>;

    // A single sweep RECOVERS the below-ceiling stale row (recoverStaleProcessing:
    // status→pending, attempts 1→2, claimed_at cleared) AND THEN — in the same pass —
    // claims + delivers the now-pending row via the NoopEventBus (claimAndDispatch:
    // attempts 2→3, status→dispatched). Recover-then-deliver is the intended one-sweep
    // behaviour. Assert the RECLAIM happened (distinguishes the below-ceiling path from
    // the at-ceiling 'failed' path) and that the row was recovered + delivered.
    expect(result.staleReclaimed).toBeGreaterThanOrEqual(1); // reclaimed, not failed
    expect(rows[0].status).toBe('dispatched');
    expect(Number(rows[0].attempts)).toBe(3); // reclaim (1→2) + dispatch claim (2→3)
  });

  it('should fail a stale processing row at or above the redelivery ceiling', async () => {
    const dispatcher = new OutboxDispatcher(
      { staleMinutes: 5, maxAttempts: 3 },
      new NoopEventBus(),
    );

    const id = await insertStrandedOutboxRow({ attempts: 3, staleMinutesAgo: 10 });

    const result = await dispatcher.runDispatchSweep();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const rows = (await db.all(sql`
      SELECT status, last_error
      FROM control.event_outbox WHERE id = ${id}
    `)) as Array<Record<string, unknown>>;

    expect(rows[0].status).toBe('failed');
    expect(String(rows[0].last_error)).toContain('ceiling');
  });

  it('should NOT reclaim a fresh processing row (not yet stale)', async () => {
    const dispatcher = new OutboxDispatcher(
      { staleMinutes: 5, maxAttempts: 3 },
      new NoopEventBus(),
    );

    // claimed 1 minute ago — not stale yet (threshold is 5 minutes).
    const id = await insertStrandedOutboxRow({ attempts: 1, staleMinutesAgo: 1 });

    await dispatcher.runDispatchSweep();

    const rows = (await db.all(sql`
      SELECT status FROM control.event_outbox WHERE id = ${id}
    `)) as Array<Record<string, unknown>>;

    // Should still be processing (or dispatched if the sweep tried to dispatch it).
    // The row has status='processing' and was inserted directly — the dispatcher
    // would need to claim it. Since it's not stale, the recovery sweep skips it.
    // The dispatch sweep may try to dispatch it as a 'processing' row — but the claim
    // query only claims 'pending' rows. So it stays 'processing'.
    expect(rows[0].status).toBe('processing');
  });
});
