/**
 * outbox-ordering.test.ts — BR-60 per-aggregate ordering tests.
 *
 * Verifies:
 *   1. Seq numbers are monotonically increasing within an aggregate.
 *   2. UNIQUE (aggregate_type, aggregate_id, seq) constraint is enforced.
 *   3. Different aggregates have independent seq counters.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { OutboxWriter } from '../../src/services/outbox/outbox-writer';

async function cleanupOutbox(): Promise<void> {
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'test_ordering'`);
}

describe('Outbox per-aggregate ordering (BR-60)', () => {
  afterEach(async () => {
    await cleanupOutbox();
  });

  it('should assign monotonically increasing seq per aggregate', async () => {
    const writer = new OutboxWriter();
    const aggregateId = createId();
    const seqs: number[] = [];

    for (let i = 0; i < 3; i++) {
      await db.transaction(async (tx) => {
        const seq = await writer.append(tx, {
          aggregateType: 'test_ordering',
          aggregateId,
          envelope: { i },
          channel: 'test_channel',
        });
        seqs.push(seq);
      });
    }

    expect(seqs).toEqual([1, 2, 3]);
  });

  it('should start seq at 1 for a new aggregate', async () => {
    const writer = new OutboxWriter();
    const aggregateId = createId();
    let seq: number = -1;

    await db.transaction(async (tx) => {
      seq = await writer.append(tx, {
        aggregateType: 'test_ordering',
        aggregateId,
        envelope: { first: true },
        channel: 'test_channel',
      });
    });

    expect(seq).toBe(1);
  });

  it('should maintain independent seq counters for different aggregate_ids', async () => {
    const writer = new OutboxWriter();
    const aggId1 = createId();
    const aggId2 = createId();
    const seqs1: number[] = [];
    const seqs2: number[] = [];

    for (let i = 0; i < 2; i++) {
      await db.transaction(async (tx) => {
        const s1 = await writer.append(tx, {
          aggregateType: 'test_ordering',
          aggregateId: aggId1,
          envelope: { agg: 1, i },
          channel: 'test_channel',
        });
        seqs1.push(s1);
      });
      await db.transaction(async (tx) => {
        const s2 = await writer.append(tx, {
          aggregateType: 'test_ordering',
          aggregateId: aggId2,
          envelope: { agg: 2, i },
          channel: 'test_channel',
        });
        seqs2.push(s2);
      });
    }

    // Each aggregate's seq starts at 1 independently.
    expect(seqs1).toEqual([1, 2]);
    expect(seqs2).toEqual([1, 2]);
  });

  it('should enforce UNIQUE (aggregate_type, aggregate_id, seq) constraint', async () => {
    const aggregateId = createId();

    // Insert seq=1 manually.
    await db.run(sql`
      INSERT INTO control.event_outbox (id, aggregate_type, aggregate_id, seq, envelope, status, attempts, channel, created_at)
      VALUES (${createId()}, 'test_ordering', ${aggregateId}, 1, '{}'::jsonb, 'pending', 0, 'test_channel', now())
    `);

    // Attempt to insert duplicate seq=1 — should violate UNIQUE constraint.
    await expect(
      db.run(sql`
        INSERT INTO control.event_outbox (id, aggregate_type, aggregate_id, seq, envelope, status, attempts, channel, created_at)
        VALUES (${createId()}, 'test_ordering', ${aggregateId}, 1, '{}'::jsonb, 'pending', 0, 'test_channel', now())
      `),
    ).rejects.toThrow();
  });
});
