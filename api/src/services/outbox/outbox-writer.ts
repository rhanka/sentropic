/**
 * OutboxWriter — co-writes `control.event_outbox` rows inside the CALLER's transaction.
 *
 * Seq allocation:
 *   - Acquires `pg_advisory_xact_lock(hashtext(aggregateType||aggregateId))` inside the
 *     caller's transaction (the postgres-stream-buffer.ts:168 pattern).
 *   - Reads `MAX(seq)` within the lock and assigns `MAX(seq)+1`.
 *   - This serializes concurrent writers for the same aggregate; the advisory lock is
 *     transaction-scoped and released on commit/rollback.
 *   - NOT the unlocked `MAX+1` pattern (races on hot aggregates).
 *
 * Wake-up:
 *   - Emits `NOTIFY outbox_pending` WITHIN the transaction so the dispatcher fires
 *     immediately on commit — required to keep <2s UI-wait latency (ARCH-14 Q3).
 *   - If the transaction rolls back, the NOTIFY is not delivered.
 *
 * Usage:
 *   await db.transaction(async (tx) => {
 *     // ... your domain mutation ...
 *     await outboxWriter.append(tx, {
 *       aggregateType: 'job_queue',
 *       aggregateId: jobId,
 *       envelope: { type: 'job.created', jobId },
 *       tenantId: null,
 *       workspaceId,
 *       channel: 'job_events',
 *     });
 *   });
 */

import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { eventOutbox } from '../../db/control-schema';
import { createId } from '../../utils/id';

export interface OutboxAppendParams {
  /** Aggregate type (e.g. 'job_queue', 'organization', 'todo'). */
  aggregateType: string;
  /** Aggregate identifier (soft reference — NO cross-namespace FK). */
  aggregateId: string;
  /**
   * Event envelope (NOT contract-bound — can carry EventEnvelope shape or DD10 UBO
   * object envelope). Stored as JSONB.
   */
  envelope: unknown;
  /** Optional trace identifier for distributed tracing (internal — no contracts mutation). */
  traceId?: string | null;
  /** Optional lineage JSONB (internal metadata). */
  lineage?: unknown | null;
  /** Optional origin tag (internal metadata). */
  origin?: string | null;
  /** Tenant scope (DD9 isolation). */
  tenantId?: string | null;
  /** Workspace scope (DD9 isolation). */
  workspaceId?: string | null;
  /** EventBus channel the dispatcher should publish to after claiming this row. */
  channel: string;
}

// The transaction type accepted by OutboxWriter.
// PgTransaction from drizzle covers the `tx` handle inside db.transaction().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgTx = PgTransaction<NodePgQueryResultHKT, any, any>;

export class OutboxWriter {
  /**
   * Append an outbox row to `control.event_outbox` within the caller's transaction.
   *
   * @param tx  - The active drizzle transaction handle (from `db.transaction(async (tx) => …)`).
   * @param params - The outbox row parameters.
   * @returns The inserted row's seq number.
   */
  async append(tx: AnyPgTx, params: OutboxAppendParams): Promise<number> {
    const { aggregateType, aggregateId } = params;

    // Acquire a transaction-scoped advisory lock for this aggregate.
    // hashtext(aggregateType || aggregateId) maps the aggregate key to a 32-bit int.
    // The lock is automatically released at the end of the transaction.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${aggregateType} || ${aggregateId}))`,
    );

    // Read MAX(seq) within the advisory lock (safe — no concurrent writer can proceed
    // for the same aggregate key until we release the lock).
    const maxSeqResult = await tx
      .select({
        maxSeq: sql<number>`COALESCE(MAX(${eventOutbox.seq}), 0)`,
      })
      .from(eventOutbox)
      .where(
        sql`${eventOutbox.aggregateType} = ${aggregateType} AND ${eventOutbox.aggregateId} = ${aggregateId}`,
      );

    const nextSeq = Number(maxSeqResult[0]?.maxSeq ?? 0) + 1;

    // Insert the outbox row.
    await tx.insert(eventOutbox).values({
      id: createId(),
      aggregateType,
      aggregateId,
      seq: nextSeq,
      envelope: params.envelope,
      traceId: params.traceId ?? null,
      lineage: params.lineage ?? null,
      origin: params.origin ?? null,
      tenantId: params.tenantId ?? null,
      workspaceId: params.workspaceId ?? null,
      status: 'pending',
      attempts: 0,
      channel: params.channel,
    });

    // Emit in-transaction wake NOTIFY. The notification is only delivered to
    // subscribers if and when the transaction commits.
    await tx.execute(sql`NOTIFY outbox_pending`);

    return nextSeq;
  }
}

/** Singleton instance. */
export const outboxWriter = new OutboxWriter();
