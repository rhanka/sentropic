/**
 * outbox-round-trip.test.ts — BR-60 outbox-v0 round-trip test.
 *
 * Tests the full append → dispatch → dispatched status path:
 *   1. OutboxWriter.append() co-writes a row inside a transaction.
 *   2. OutboxDispatcher.runDispatchSweep() claims the pending row.
 *   3. Row status becomes 'dispatched'.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { OutboxWriter } from '../../src/services/outbox/outbox-writer';
import { OutboxDispatcher } from '../../src/services/outbox/outbox-dispatcher';
import type { EventBusPort } from '../../src/services/outbox/event-bus';
import { PostgresClusterMeshRuntimeStore } from '../../src/services/cluster-mesh/postgres-runtime-store';
import { idempotencyKey } from '@sentropic/contracts';

// --- Helpers ---

async function getOutboxRow(id: string): Promise<Record<string, unknown> | null> {
  const rows = (await db.all(sql`
    SELECT id, aggregate_type, aggregate_id, seq, status, channel, attempts, last_error, dispatched_at
    FROM control.event_outbox
    WHERE id = ${id}
  `)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

async function cleanupOutbox(): Promise<void> {
  await db.run(sql`DELETE FROM control.cluster_mesh_receipts`);
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'test_round_trip'`);
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'cluster_mesh_receipt'`);
}

// Spy EventBus that records publish calls.
class SpyEventBus implements EventBusPort {
  public calls: Array<{ channel: string; payload: unknown }> = [];
  async publish(channel: string, payload: unknown): Promise<void> {
    this.calls.push({ channel, payload });
  }
}

// --- Tests ---

describe('Outbox round-trip (BR-60)', () => {
  afterEach(async () => {
    await cleanupOutbox();
  });

  it('should write an outbox row in pending status via OutboxWriter.append', async () => {
    const writer = new OutboxWriter();
    const aggregateId = createId();
    let insertedSeq: number = -1;

    // Get the row id from the inserted row.
    let insertedId: string | null = null;
    await db.transaction(async (tx) => {
      // We need the id to look it up after — capture it via a query after insert.
      insertedSeq = await writer.append(tx, {
        aggregateType: 'test_round_trip',
        aggregateId,
        envelope: { type: 'test.created', id: aggregateId },
        channel: 'test_channel',
      });
    });

    expect(insertedSeq).toBe(1);

    // Find the row by aggregate type and id.
    const rows = (await db.all(sql`
      SELECT id, status, seq, channel
      FROM control.event_outbox
      WHERE aggregate_type = 'test_round_trip' AND aggregate_id = ${aggregateId}
    `)) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(Number(rows[0].seq)).toBe(1);
    expect(rows[0].channel).toBe('test_channel');

    insertedId = rows[0].id as string;
    expect(insertedId).toBeTruthy();
  });

  it('should dispatch a pending outbox row to dispatched status', async () => {
    const writer = new OutboxWriter();
    const spy = new SpyEventBus();
    const dispatcher = new OutboxDispatcher({ maxAttempts: 3 }, spy);

    const aggregateId = createId();

    await db.transaction(async (tx) => {
      await writer.append(tx, {
        aggregateType: 'test_round_trip',
        aggregateId,
        envelope: { type: 'test.created', id: aggregateId },
        channel: 'test_channel',
      });
    });

    const result = await dispatcher.runDispatchSweep();
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    // Verify the row is now dispatched.
    const rows = (await db.all(sql`
      SELECT status, dispatched_at
      FROM control.event_outbox
      WHERE aggregate_type = 'test_round_trip' AND aggregate_id = ${aggregateId}
    `)) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('dispatched');
    expect(rows[0].dispatched_at).not.toBeNull();

    // Verify the spy received the publish call.
    const publishCall = spy.calls.find((c) => c.channel === 'test_channel');
    expect(publishCall).toBeTruthy();
  });

  it('should not dispatch rows belonging to a failed aggregate (per-aggregate blocking)', async () => {
    const writer = new OutboxWriter();
    const spy = new SpyEventBus();
    const dispatcher = new OutboxDispatcher({ maxAttempts: 3 }, spy);

    const aggregateId = createId();

    // Insert seq=1 manually as 'failed' to simulate a stuck aggregate.
    await db.run(sql`
      INSERT INTO control.event_outbox (id, aggregate_type, aggregate_id, seq, envelope, status, attempts, channel, created_at)
      VALUES (${createId()}, 'test_round_trip', ${aggregateId}, 1, '{"type":"test.failed"}'::jsonb, 'failed', 3, 'test_channel', now())
    `);

    // Insert seq=2 as 'pending' — should be blocked.
    await db.transaction(async (tx) => {
      await writer.append(tx, {
        aggregateType: 'test_round_trip',
        aggregateId,
        envelope: { type: 'test.blocked', id: aggregateId },
        channel: 'test_channel',
      });
    });

    await dispatcher.runDispatchSweep();

    // seq=2 should remain pending due to blocking.
    const rows = (await db.all(sql`
      SELECT seq, status
      FROM control.event_outbox
      WHERE aggregate_type = 'test_round_trip' AND aggregate_id = ${aggregateId}
      ORDER BY seq
    `)) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('failed'); // seq=1
    expect(rows[1].status).toBe('pending'); // seq=2 blocked
  });

  it('should co-write one cluster mesh receipt against the shared outbox', async () => {
    const store = new PostgresClusterMeshRuntimeStore();
    const receipt = {
      receiptId: createId(),
      invocationId: createId(),
      correlationId: createId(),
      generationId: createId(),
      idempotencyKey: idempotencyKey(createId()),
      stage: 'transported' as const,
      occurredAt: '2026-08-30T12:00:00.000Z',
    };

    await store.append(receipt);
    await store.append(receipt);

    const rows = (await db.all(sql`
      SELECT receipt.receipt_id, receipt.outbox_event_id, outbox.id, outbox.aggregate_id
      FROM control.cluster_mesh_receipts AS receipt
      JOIN control.event_outbox AS outbox ON outbox.id = receipt.outbox_event_id
      WHERE receipt.receipt_id = ${receipt.receiptId}
    `)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].outbox_event_id).toBe(rows[0].id);
    expect(rows[0].aggregate_id).toBe(receipt.invocationId);

    const [{ count }] = (await db.all(sql`
      SELECT count(*)::int AS count FROM control.event_outbox
      WHERE aggregate_type = 'cluster_mesh_receipt' AND aggregate_id = ${receipt.invocationId}
    `)) as Array<{ count: number }>;
    expect(count).toBe(1);
  });
});
