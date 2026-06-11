/**
 * outbox-ceiling.test.ts — BR-60 redelivery ceiling tests.
 *
 * Verifies that when a dispatch attempt fails repeatedly (simulated by a
 * throwing EventBus), the row transitions to 'failed' after maxAttempts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { OutboxWriter } from '../../src/services/outbox/outbox-writer';
import { OutboxDispatcher } from '../../src/services/outbox/outbox-dispatcher';
import type { EventBusPort } from '../../src/services/outbox/event-bus';

class AlwaysFailEventBus implements EventBusPort {
  async publish(_channel: string, _payload: unknown): Promise<void> {
    throw new Error('simulated publish failure');
  }
}

async function cleanupOutbox(): Promise<void> {
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'test_ceiling'`);
}

describe('Outbox redelivery ceiling (BR-60)', () => {
  afterEach(async () => {
    await cleanupOutbox();
  });

  it('should mark a row as failed after maxAttempts dispatch failures', async () => {
    const writer = new OutboxWriter();
    const dispatcher = new OutboxDispatcher(
      { maxAttempts: 2, staleMinutes: 5 },
      new AlwaysFailEventBus(),
    );

    const aggregateId = createId();

    await db.transaction(async (tx) => {
      await writer.append(tx, {
        aggregateType: 'test_ceiling',
        aggregateId,
        envelope: { type: 'test.ceiling', id: aggregateId },
        channel: 'test_channel',
      });
    });

    // Run 3 sweeps to exceed maxAttempts=2.
    // Each sweep: claim → publish fails → requeue (pending, attempts++) or fail.
    // Sweep 1: attempts=1 (claimed, publish fails → requeue → pending with attempts=1... wait)
    // Actually: the claim sweep increments attempts, then publish fails, then since
    // attempts(1) < maxAttempts(2): requeue to pending.
    // Sweep 2: attempts=2, publish fails → attempts(2) >= maxAttempts(2): mark failed.
    for (let i = 0; i < 3; i++) {
      await dispatcher.runDispatchSweep();
    }

    const rows = (await db.all(sql`
      SELECT status, last_error, attempts
      FROM control.event_outbox
      WHERE aggregate_type = 'test_ceiling' AND aggregate_id = ${aggregateId}
    `)) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(String(rows[0].last_error)).toContain('publish error');
  });

  it('should record last_error with publish failure details when failing', async () => {
    const writer = new OutboxWriter();
    const dispatcher = new OutboxDispatcher(
      { maxAttempts: 1, staleMinutes: 5 },
      new AlwaysFailEventBus(),
    );

    const aggregateId = createId();

    await db.transaction(async (tx) => {
      await writer.append(tx, {
        aggregateType: 'test_ceiling',
        aggregateId,
        envelope: { type: 'test.ceiling.error' },
        channel: 'test_channel',
      });
    });

    // With maxAttempts=1: sweep 1 claims (attempts=1), publish fails, attempts >= maxAttempts → fail.
    await dispatcher.runDispatchSweep();

    const rows = (await db.all(sql`
      SELECT status, last_error
      FROM control.event_outbox
      WHERE aggregate_type = 'test_ceiling' AND aggregate_id = ${aggregateId}
    `)) as Array<Record<string, unknown>>;

    expect(rows[0].status).toBe('failed');
    expect(String(rows[0].last_error)).toContain('simulated publish failure');
  });
});
