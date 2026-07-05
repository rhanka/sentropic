/**
 * outbox-advisory-lock.test.ts — BR-60 advisory-lock seq allocation test.
 *
 * Verifies that concurrent OutboxWriter.append() calls for the same aggregate
 * produce no duplicate seq numbers (pg_advisory_xact_lock serializes them).
 *
 * Strategy: fire N concurrent transactions in parallel and collect all seqs.
 * The resulting set must be {1, 2, ..., N} (no duplicates, no gaps).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { OutboxWriter } from '../../src/services/outbox/outbox-writer';

async function cleanupOutbox(): Promise<void> {
  await db.run(sql`DELETE FROM control.event_outbox WHERE aggregate_type = 'test_advisory_lock'`);
}

describe('Outbox advisory-lock seq allocation (BR-60)', () => {
  afterEach(async () => {
    await cleanupOutbox();
  });

  it('should produce unique seq numbers under concurrent appends for the same aggregate', async () => {
    const writer = new OutboxWriter();
    const aggregateId = createId();
    const N = 5;

    // Fire N concurrent transactions.
    const seqs = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        db.transaction(async (tx) =>
          writer.append(tx, {
            aggregateType: 'test_advisory_lock',
            aggregateId,
            envelope: { i },
            channel: 'test_channel',
          }),
        ),
      ),
    );

    // All seq values must be unique.
    const seqSet = new Set(seqs);
    expect(seqSet.size).toBe(N);

    // The set must be exactly {1, 2, 3, 4, 5}.
    const expected = new Set(Array.from({ length: N }, (_, i) => i + 1));
    expect(seqSet).toEqual(expected);

    // Verify DB rows match.
    const rows = (await db.all(sql`
      SELECT seq FROM control.event_outbox
      WHERE aggregate_type = 'test_advisory_lock' AND aggregate_id = ${aggregateId}
      ORDER BY seq
    `)) as Array<{ seq: number }>;

    expect(rows).toHaveLength(N);
    rows.forEach((row, idx) => {
      expect(Number(row.seq)).toBe(idx + 1);
    });
  });

  it('should produce independent seq series for different aggregates (no cross-aggregate lock interference)', async () => {
    const writer = new OutboxWriter();
    const aggA = createId();
    const aggB = createId();

    // Interleave appends across two different aggregates concurrently.
    const results = await Promise.all([
      db.transaction(async (tx) =>
        writer.append(tx, { aggregateType: 'test_advisory_lock', aggregateId: aggA, envelope: {}, channel: 'ch' }),
      ),
      db.transaction(async (tx) =>
        writer.append(tx, { aggregateType: 'test_advisory_lock', aggregateId: aggB, envelope: {}, channel: 'ch' }),
      ),
      db.transaction(async (tx) =>
        writer.append(tx, { aggregateType: 'test_advisory_lock', aggregateId: aggA, envelope: {}, channel: 'ch' }),
      ),
      db.transaction(async (tx) =>
        writer.append(tx, { aggregateType: 'test_advisory_lock', aggregateId: aggB, envelope: {}, channel: 'ch' }),
      ),
    ]);

    // aggA seqs should be 1, 2; aggB seqs should be 1, 2.
    const aggASeqs = (await db.all(sql`
      SELECT seq FROM control.event_outbox
      WHERE aggregate_type = 'test_advisory_lock' AND aggregate_id = ${aggA}
      ORDER BY seq
    `)) as Array<{ seq: number }>;
    const aggBSeqs = (await db.all(sql`
      SELECT seq FROM control.event_outbox
      WHERE aggregate_type = 'test_advisory_lock' AND aggregate_id = ${aggB}
      ORDER BY seq
    `)) as Array<{ seq: number }>;

    expect(aggASeqs.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(aggBSeqs.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(results).toHaveLength(4); // all 4 appends succeeded
  });
});
