/**
 * Stream events purge — batched DELETE of old chat_stream_events (BR-44 WI-2).
 *
 * Design decisions (spec SPEC_EVOL_DATA_HARDENING.md §2 WI-2):
 *   D2.a — batched DELETE loop: no .returning() copy; deletes up to BATCH_SIZE
 *           rows per iteration to avoid long transactions on large tables.
 *   D2.b — 7d retention >> 6h active window; safe margin proven by spec §2 D2.b.
 *   D2.c — since_minutes clamp enforced at the route layer (streams.ts).
 *   D2.d — created_at index declared in schema.ts (plain migration, row count < 2M).
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

const BATCH_SIZE = 1000;

/**
 * Purge chat_stream_events rows older than `retentionDays` days.
 *
 * Uses a batched DELETE loop so large purges do not materialise millions of
 * ids or hold a long-running transaction. Returns the total count deleted.
 */
export async function purgeOldStreamEvents(retentionDays: number): Promise<number> {
  const days = Number.isFinite(retentionDays) ? retentionDays : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  for (;;) {
    const result = (await db.run(sql`
      DELETE FROM chat_stream_events
      WHERE id IN (
        SELECT id FROM chat_stream_events
        WHERE created_at < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
    `)) as { rowCount?: number; rowsAffected?: number };

    // Drizzle run() returns a driver result; rowCount is for pg, rowsAffected for sqlite.
    const deleted = result.rowCount ?? result.rowsAffected ?? 0;
    totalDeleted += deleted;
    if (deleted === 0) break;
  }

  return totalDeleted;
}
