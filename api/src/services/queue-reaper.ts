/**
 * Queue reaper — stranded `processing` job recovery (BR-44 WI-1).
 *
 * A worker crash leaves jobs in `processing` forever, permanently consuming
 * the `maxConcurrentJobs` budget. This module recovers them via atomic
 * single-statement UPDATE sweeps so concurrent/duplicate runs are benign
 * (the second run always matches 0 rows).
 *
 * Design decisions (spec SPEC_EVOL_DATA_HARDENING.md §2 WI-1):
 *   D1.a — atomic single-statement sweeps (no select-then-update).
 *   D1.b — periodic sweep skips ids present in `liveJobIds` (jobControllers).
 *   D1.c — ceiling enforced in the BOOT sweep too (crash-loop guard).
 *   D1.d — `attempts` column (distinct from `_retry` in data JSON).
 *   D1.e — `chat_message` strands → fail+finalize (never requeue).
 *   D1.f — `started_at`/`completed_at` are now timestamp with time zone.
 *   D1.g — (status, started_at) index declared in schema.ts.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../config/env';
import { chatService } from './chat-service';
import { logger } from '../logger';

export type ReaperResult = {
  requeued: number;
  failed: number;
  chatMessagesFailed: number;
};

/**
 * Build a SQL fragment that excludes a list of job ids from a WHERE clause.
 * Uses individual parameterized sql`` placeholders — safe, no sql.raw injection.
 * When the list is empty, returns an empty fragment (boot-sweep path).
 */
function buildLiveExclusion(ids: string[]) {
  if (ids.length === 0) return sql``;
  const params = ids.map((id) => sql`${id}`);
  const joined = params.reduce((acc, p, i) => (i === 0 ? p : sql`${acc}, ${p}`));
  return sql` AND id NOT IN (${joined})`;
}

/**
 * Finalize a stale chat_message job's assistant stream safely.
 * Errors are swallowed — the job row has already been marked failed.
 */
async function finalizeChatMessage(jobId: string, data: string, reason: string): Promise<void> {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const assistantMessageId =
      typeof parsed?.assistantMessageId === 'string' ? parsed.assistantMessageId : null;
    if (assistantMessageId) {
      await chatService.finalizeAssistantMessageFromStream({
        assistantMessageId,
        reason,
        fallbackContent: 'Réponse interrompue.',
      });
    }
  } catch (err) {
    logger.warn({ err, jobId }, 'queue-reaper: failed to finalize chat_message stream');
  }
}

/**
 * Run the queue reaper sweeps.
 *
 * @param liveJobIds - ids of jobs currently in-flight in this process
 *   (from `queueManager.getLiveJobIds()`). These are NEVER reaped by the
 *   periodic sweep. The boot sweep should pass [] (called before any local
 *   job starts).
 */
export async function runQueueReaper(liveJobIds: string[]): Promise<ReaperResult> {
  const staleMinutes = Number.isFinite(env.QUEUE_REAPER_STALE_MINUTES ?? undefined)
    ? (env.QUEUE_REAPER_STALE_MINUTES as number)
    : 30;
  const maxRedeliveries = Number.isFinite(env.QUEUE_MAX_REDELIVERIES ?? undefined)
    ? (env.QUEUE_MAX_REDELIVERIES as number)
    : 2;

  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000);
  const liveExcl = buildLiveExclusion(liveJobIds);

  // -------------------------------------------------------------------------
  // Sweep A: fail-ceiling — ALL types at or above the redelivery ceiling → fail.
  // (Including chat_message: ceiling failure is terminal regardless of type.)
  // -------------------------------------------------------------------------
  const failCeilingRows = (await db.all(sql`
    UPDATE job_queue
    SET status = 'failed',
        error  = 'reaped: exceeded redelivery ceiling'
    WHERE status     = 'processing'
      AND started_at < ${staleThreshold}
      AND attempts   >= ${maxRedeliveries}
      ${liveExcl}
    RETURNING id, type, data
  `)) as Array<{ id: string; type: string; data: string }>;

  let chatMessagesFailed = 0;
  for (const row of failCeilingRows) {
    if (row.type === 'chat_message') {
      chatMessagesFailed++;
      await finalizeChatMessage(row.id, row.data, 'reaped: exceeded redelivery ceiling');
    }
  }

  // -------------------------------------------------------------------------
  // Sweep B: chat_message fail-fast — stale chat_message below ceiling → fail+finalize.
  // Replaying against the same assistantMessageId hours later is user-hostile.
  // -------------------------------------------------------------------------
  const chatFailRows = (await db.all(sql`
    UPDATE job_queue
    SET status = 'failed',
        error  = 'reaped: stale chat_message strand'
    WHERE status     = 'processing'
      AND type       = 'chat_message'
      AND started_at < ${staleThreshold}
      AND attempts   < ${maxRedeliveries}
      ${liveExcl}
    RETURNING id, type, data
  `)) as Array<{ id: string; type: string; data: string }>;

  for (const row of chatFailRows) {
    chatMessagesFailed++;
    await finalizeChatMessage(row.id, row.data, 'reaped: stale chat_message strand');
  }

  // -------------------------------------------------------------------------
  // Sweep C: requeue — all other stale types below ceiling → pending, attempts+1.
  // -------------------------------------------------------------------------
  const requeueRows = (await db.all(sql`
    UPDATE job_queue
    SET status     = 'pending',
        started_at = NULL,
        attempts   = attempts + 1
    WHERE status     = 'processing'
      AND type       <> 'chat_message'
      AND started_at < ${staleThreshold}
      AND attempts   < ${maxRedeliveries}
      ${liveExcl}
    RETURNING id
  `)) as Array<{ id: string }>;

  return {
    requeued: requeueRows.length,
    failed: failCeilingRows.length,
    chatMessagesFailed,
  };
}
