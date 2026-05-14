/**
 * BR14b Lot 20 — PostgresStreamSequencer adapter.
 *
 * Postgres-backed adapter for the `StreamSequencer` port introduced in
 * Lot 20. Both methods delegate to the existing `chat_stream_events`
 * table semantics:
 *
 *   - `allocate(streamId)`: wraps `PostgresStreamBuffer.getNextSequence`
 *     (MAX(sequence)+1 over `chat_stream_events` for the streamId).
 *     The existing optimistic-allocate + retry-on-23505 pattern in
 *     `PostgresStreamBuffer.append` (Lot 7) handles concurrent
 *     allocate+append races — the sequencer port itself is allocation-
 *     only and does not synchronise with appends.
 *
 *   - `peek(streamId)`: SELECT MAX(sequence) WHERE stream_id = $1, or
 *     0 when the stream has no events.
 *
 * Postgres `MAX(sequence)` semantics under concurrent writes: when two
 * writers race to allocate, both may receive the same `MAX+1` value;
 * the loser will then hit a 23505 unique-constraint conflict on the
 * actual `INSERT` and retry through the existing
 * `appendWithSequenceRetry` advisory-lock path. Lot 20 preserves this
 * semantic exactly: `allocate` is optimistic, `append`-side retries are
 * the recovery mechanism.
 */
import { eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatStreamEvents } from '../../db/schema';
import type { StreamSequencer } from '../../../../packages/chat-core/src/stream-sequencer-port';

import { postgresStreamBuffer } from './postgres-stream-buffer';

export class PostgresStreamSequencer implements StreamSequencer {
  async allocate(streamId: string): Promise<number> {
    // Delegate to the existing buffer-side allocator (MAX(sequence)+1).
    // Same SQL the runtime had pre-Lot 20 — preserves byte-for-byte
    // behavior of the existing `let streamSeq = await getNextSequence(...)`
    // call sites that the runtime will own from Lot 20+ onward.
    return postgresStreamBuffer.getNextSequence(streamId);
  }

  async peek(streamId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${chatStreamEvents.sequence})` })
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, streamId));

    return Number(result[0]?.maxSequence ?? 0);
  }
}

export const postgresStreamSequencer = new PostgresStreamSequencer();
