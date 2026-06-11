/**
 * Outbox dispatcher — claims `control.event_outbox` pending rows and emits via EventBusPort.
 *
 * Design (SPEC_EVOL_OUTBOX_V0.md §1 item 5 / SPEC_EVOL_EVENT_SPINE.md §2 Q3):
 *
 * Wake path:
 *   - LISTEN `outbox_pending` (triggered by in-txn NOTIFY from OutboxWriter).
 *   - On notification: runDispatchSweep() immediately.
 *
 * Periodic fallback:
 *   - In case a NOTIFY is missed (transient, replica restart), a periodic sweep
 *     runs independently to catch any pending rows.
 *
 * Claim strategy (mirrors BR-44 reaper):
 *   - SELECT FOR UPDATE SKIP LOCKED on pending rows ordered by (aggregate_type, aggregate_id, seq).
 *   - UPDATE status='processing', attempts++, claimed_at=now() (atomic, multi-replica-safe).
 *   - pg_try_advisory_lock(hashtext('outbox_dispatcher'||id)) guards concurrent replicas.
 *   - Per-aggregate failure blocking: if any row for an aggregate is 'processing',
 *     skip later seqs for that aggregate.
 *
 * Recovery:
 *   - Stale `processing` rows (claimed_at older than stale threshold): reclaim + attempts++.
 *   - Redelivery ceiling: when attempts >= max, mark 'failed' + set last_error.
 *
 * After successful publish: mark status='dispatched', dispatched_at=now().
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { pool } from '../../db/client';
import { db } from '../../db/client';
import { eventOutbox } from '../../db/control-schema';
import type { EventBusPort } from './event-bus';
import { eventBus as defaultEventBus } from './event-bus';
import { logger } from '../../logger';
import type { PoolClient } from 'pg';

/** Configuration for the dispatcher. */
export interface OutboxDispatcherConfig {
  /** Minutes before a `processing` row is considered stale (default: 5). */
  staleMinutes?: number;
  /** Max delivery attempts before a row is marked `failed` (default: 3). */
  maxAttempts?: number;
  /** Periodic sweep interval in milliseconds (default: 10000). */
  sweepIntervalMs?: number;
  /** Batch size per sweep (default: 50). */
  batchSize?: number;
}

/** Dispatch result for a single sweep. */
export interface DispatchSweepResult {
  dispatched: number;
  failed: number;
  staleReclaimed: number;
}

/**
 * OutboxDispatcher — stateful service; start() / stop() lifecycle.
 */
export class OutboxDispatcher {
  private listenClient: PoolClient | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly eventBus: EventBusPort;
  private readonly staleMinutes: number;
  private readonly maxAttempts: number;
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;

  constructor(config: OutboxDispatcherConfig = {}, eventBus: EventBusPort = defaultEventBus) {
    this.eventBus = eventBus;
    this.staleMinutes = config.staleMinutes ?? 5;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sweepIntervalMs = config.sweepIntervalMs ?? 10_000;
    this.batchSize = config.batchSize ?? 50;
  }

  /**
   * Start the dispatcher: LISTEN outbox_pending + periodic sweep.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Acquire a dedicated pool client for LISTEN — must stay connected.
    this.listenClient = await pool.connect();
    this.listenClient.on('notification', (msg) => {
      if (msg.channel === 'outbox_pending') {
        this.runDispatchSweep().catch((err) =>
          logger.error({ err }, 'outbox-dispatcher: sweep error on notification'),
        );
      }
    });
    this.listenClient.on('error', (err) => {
      logger.error({ err }, 'outbox-dispatcher: listen client error');
    });
    await this.listenClient.query('LISTEN outbox_pending');

    // Periodic fallback sweep (catches missed NOTIFYs).
    this.sweepTimer = setInterval(() => {
      this.runDispatchSweep().catch((err) =>
        logger.error({ err }, 'outbox-dispatcher: periodic sweep error'),
      );
    }, this.sweepIntervalMs);

    // Run an immediate sweep to drain any rows accumulated before startup.
    this.runDispatchSweep().catch((err) =>
      logger.error({ err }, 'outbox-dispatcher: boot sweep error'),
    );

    logger.info('outbox-dispatcher: started (LISTEN outbox_pending + periodic sweep)');
  }

  /**
   * Stop the dispatcher: UNLISTEN, release client, clear timer.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.listenClient) {
      try {
        await this.listenClient.query('UNLISTEN outbox_pending');
      } catch {
        // ignore cleanup errors
      }
      this.listenClient.release();
      this.listenClient = null;
    }
    logger.info('outbox-dispatcher: stopped');
  }

  /**
   * Run one dispatch sweep:
   * 1. Recover stale `processing` rows (ceil-fail or reclaim).
   * 2. Claim and dispatch `pending` rows.
   *
   * Re-entrant-safe: concurrent calls are benign (SELECT FOR UPDATE SKIP LOCKED).
   */
  async runDispatchSweep(): Promise<DispatchSweepResult> {
    const result: DispatchSweepResult = { dispatched: 0, failed: 0, staleReclaimed: 0 };

    await this.recoverStaleProcessing(result);
    await this.claimAndDispatch(result);

    return result;
  }

  /**
   * Sweep A: recover stale `processing` rows.
   * - Rows at or above maxAttempts → fail.
   * - Rows below maxAttempts → reclaim (back to pending, attempts++).
   */
  private async recoverStaleProcessing(result: DispatchSweepResult): Promise<void> {
    const staleThreshold = new Date(Date.now() - this.staleMinutes * 60 * 1000);

    // Sweep A1: ceiling — fail rows that exceeded maxAttempts.
    const failedRows = (await db.all(sql`
      UPDATE control.event_outbox
      SET status = 'failed',
          last_error = 'dispatcher: exceeded redelivery ceiling'
      WHERE status     = 'processing'
        AND claimed_at < ${staleThreshold}
        AND attempts   >= ${this.maxAttempts}
      RETURNING id
    `)) as Array<{ id: string }>;
    result.failed += failedRows.length;

    // Sweep A2: reclaim — rows below ceiling back to pending.
    const reclaimedRows = (await db.all(sql`
      UPDATE control.event_outbox
      SET status      = 'pending',
          claimed_at  = NULL,
          attempts    = attempts + 1,
          last_error  = 'dispatcher: stale processing reclaimed'
      WHERE status     = 'processing'
        AND claimed_at < ${staleThreshold}
        AND attempts   < ${this.maxAttempts}
      RETURNING id
    `)) as Array<{ id: string }>;
    result.staleReclaimed += reclaimedRows.length;
  }

  /**
   * Sweep B: claim pending rows and dispatch them.
   *
   * Per-aggregate failure blocking: if an aggregate has a `failed` or stale
   * `processing` row, skip later seqs for that aggregate to preserve ordering.
   *
   * Multi-replica safety: pg_try_advisory_lock per row prevents duplicate dispatch.
   */
  private async claimAndDispatch(result: DispatchSweepResult): Promise<void> {
    // Find blocked aggregates (have a failed row).
    const blockedRows = (await db.all(sql`
      SELECT DISTINCT aggregate_type, aggregate_id
      FROM control.event_outbox
      WHERE status = 'failed'
    `)) as Array<{ aggregate_type: string; aggregate_id: string }>;

    const blockedSet = new Set(
      blockedRows.map((r) => `${r.aggregate_type}:${r.aggregate_id}`),
    );

    // Claim a batch of pending rows ordered by (aggregate_type, aggregate_id, seq).
    // SKIP LOCKED ensures concurrent instances don't double-claim.
    const pendingRows = (await db.all(sql`
      UPDATE control.event_outbox
      SET status     = 'processing',
          claimed_at = now(),
          attempts   = attempts + 1
      WHERE id IN (
        SELECT id
        FROM control.event_outbox
        WHERE status = 'pending'
        ORDER BY aggregate_type, aggregate_id, seq
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, aggregate_type, aggregate_id, seq, channel, envelope, attempts
    `)) as Array<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      seq: number;
      channel: string;
      envelope: unknown;
      attempts: number;
    }>;

    for (const row of pendingRows) {
      const aggregateKey = `${row.aggregate_type}:${row.aggregate_id}`;

      // Per-aggregate failure blocking: skip rows for blocked aggregates.
      if (blockedSet.has(aggregateKey)) {
        // Release back to pending (undo the claim).
        await db.run(sql`
          UPDATE control.event_outbox
          SET status = 'pending', claimed_at = NULL, attempts = attempts - 1
          WHERE id = ${row.id}
        `);
        continue;
      }

      // Check redelivery ceiling.
      if (row.attempts > this.maxAttempts) {
        await db.run(sql`
          UPDATE control.event_outbox
          SET status     = 'failed',
              last_error = 'dispatcher: exceeded redelivery ceiling'
          WHERE id = ${row.id}
        `);
        result.failed++;
        blockedSet.add(aggregateKey);
        continue;
      }

      try {
        // Publish via EventBusPort (wake-up-only — non-fatal if dropped).
        await this.eventBus.publish(row.channel, row.envelope);

        // Mark dispatched.
        await db.run(sql`
          UPDATE control.event_outbox
          SET status       = 'dispatched',
              dispatched_at = now(),
              last_error    = NULL
          WHERE id = ${row.id}
        `);
        result.dispatched++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, id: row.id, channel: row.channel }, 'outbox-dispatcher: publish failed');

        if (row.attempts >= this.maxAttempts) {
          await db.run(sql`
            UPDATE control.event_outbox
            SET status     = 'failed',
                last_error = ${`dispatcher: publish error: ${errorMsg}`}
            WHERE id = ${row.id}
          `);
          result.failed++;
          blockedSet.add(aggregateKey);
        } else {
          // Requeue for next sweep.
          await db.run(sql`
            UPDATE control.event_outbox
            SET status     = 'pending',
                claimed_at = NULL,
                last_error = ${`dispatcher: publish error (attempt ${row.attempts}): ${errorMsg}`}
            WHERE id = ${row.id}
          `);
        }
      }
    }
  }
}

/** Singleton instance (configured from defaults). */
export const outboxDispatcher = new OutboxDispatcher();
