import { and, eq, gt, sql } from 'drizzle-orm';

import { db, pool } from '../../db/client';
import { chatStreamEvents } from '../../db/schema';
import { createId } from '../../utils/id';
import { findPgError } from '../../utils/pg-errors';
import type {
  AppendWithRetryOptions,
  ListActiveOptions,
  ReadRangeOptions,
  StoredStreamEvent,
  StreamBuffer,
  StreamEventTypeName,
} from '../../../../packages/chat-core/src/stream-port';

const DEFAULT_SEQUENCE_RETRY_ATTEMPTS = 6;
const STREAM_SEQUENCE_LOCK_NAMESPACE = 'chat_stream_events';

const isStreamSequenceConflictError = (error: unknown): boolean => {
  const pgError = findPgError(error, '23505');
  if (!pgError) return false;
  return (
    (pgError.constraint?.includes('chat_stream_events_stream_id_sequence_unique') ?? false) ||
    (pgError.message?.includes('chat_stream_events_stream_id_sequence_unique') ?? false)
  );
};

/**
 * The parent `chat_messages` row referenced by `message_id` was deleted
 * (e.g. session cascade) while a stream event for it was still being flushed.
 * The FK declares `ON DELETE CASCADE`, so the parent's removal is meant to take
 * these events with it — inserting a now-orphaned event is therefore a no-op,
 * not a fatal error for the generation job. We only swallow the specific
 * message-FK violation; any other FK error still propagates.
 */
const isOrphanMessageFkError = (error: unknown): boolean => {
  const pgError = findPgError(error, '23503');
  if (!pgError) return false;
  return (
    (pgError.constraint?.includes('chat_stream_events_message_id_chat_messages_id_fk') ??
      false) ||
    (pgError.message?.includes('chat_stream_events_message_id_chat_messages_id_fk') ??
      false)
  );
};

/**
 * Per SPEC §4 (Stream protocol) + §5 (Ports list).
 * PostgresStreamBuffer implements StreamBuffer over Drizzle + `chat_stream_events`.
 *
 * BR14b Lot 7 — verbatim extraction from `api/src/services/stream-service.ts`.
 * All six methods carry the EXACT SQL/Drizzle logic that previously lived in
 * the free functions. The legacy `stream-service.ts` becomes a thin re-export
 * shim wrapping this adapter so existing consumers (chat-service.ts,
 * queue-manager.ts, context-document.ts, routes/api/*) keep their imports
 * unchanged.
 *
 * Per SPEC §7 anti-pattern: inline transport (SSE) does NOT leak into
 * chat-core. The PostgreSQL `NOTIFY` emit is an implementation detail of
 * this adapter (signaling the SSE listeners in routes/namespaces/streams.ts);
 * the port itself stays transport-free.
 */
export class PostgresStreamBuffer implements StreamBuffer {
  generateStreamId(promptId?: string, jobId?: string, messageId?: string): string {
    if (messageId) {
      return messageId; // For chat, stream_id = message_id
    }

    if (jobId) {
      // IMPORTANT: deterministic streamId for jobs so the UI can derive
      // streamId from jobId without polling /streams/active.
      return `job_${jobId}`;
    }

    if (promptId) {
      return `prompt_${promptId}_${Date.now()}`;
    }

    // Fallback: generate a unique ID.
    return `stream_${createId()}_${Date.now()}`;
  }

  private async notifyStreamEvent(
    streamId: string,
    eventType: StreamEventTypeName,
    sequence: number,
  ): Promise<void> {
    const notifyPayload = JSON.stringify({
      stream_id: streamId,
      sequence,
      event_type: eventType,
    });

    const client = await pool.connect();
    try {
      await client.query(`NOTIFY stream_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  async append(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ): Promise<number> {
    const eventId = createId();
    let nextSequence =
      Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;

    for (let attempt = 1; attempt <= DEFAULT_SEQUENCE_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await db.insert(chatStreamEvents).values({
          id: eventId,
          messageId: messageId || null,
          streamId,
          eventType,
          data,
          sequence: nextSequence,
        });

        await this.notifyStreamEvent(streamId, eventType, nextSequence);
        return nextSequence;
      } catch (error) {
        if (
          isStreamSequenceConflictError(error) &&
          attempt < DEFAULT_SEQUENCE_RETRY_ATTEMPTS
        ) {
          nextSequence = await this.getNextSequence(streamId);
          continue;
        }
        if (isOrphanMessageFkError(error)) {
          // Parent chat_messages row was deleted (cascade) mid-flight. The
          // ON DELETE CASCADE FK means this event would be removed anyway, so
          // dropping it is the correct no-op rather than crashing the job.
          return nextSequence;
        }
        throw error;
      }
    }

    throw new Error('Unable to append stream event');
  }

  async getNextSequence(streamId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${chatStreamEvents.sequence})` })
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, streamId));

    const maxSequence = result[0]?.maxSequence ?? 0;
    return maxSequence + 1;
  }

  private async appendAtomically(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    messageId?: string | null,
  ): Promise<number> {
    const eventId = createId();
    let insertedSequence = 1;
    let orphaned = false;

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${STREAM_SEQUENCE_LOCK_NAMESPACE}), hashtext(${streamId}))`,
        );

        const result = await tx
          .select({
            maxSequence: sql<number>`COALESCE(MAX(${chatStreamEvents.sequence}), 0)`,
          })
          .from(chatStreamEvents)
          .where(eq(chatStreamEvents.streamId, streamId));

        insertedSequence = Number(result[0]?.maxSequence ?? 0) + 1;

        await tx.insert(chatStreamEvents).values({
          id: eventId,
          messageId: messageId || null,
          streamId,
          eventType,
          data,
          sequence: insertedSequence,
        });
      });
    } catch (error) {
      if (isOrphanMessageFkError(error)) {
        // Parent chat_messages row was deleted (cascade) mid-flight. The
        // ON DELETE CASCADE FK means this event would be removed anyway, so
        // dropping it is the correct no-op rather than crashing the job.
        orphaned = true;
      } else {
        throw error;
      }
    }

    if (orphaned) return insertedSequence;

    await this.notifyStreamEvent(streamId, eventType, insertedSequence);
    return insertedSequence;
  }

  async appendWithSequenceRetry(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    options?: AppendWithRetryOptions,
  ): Promise<number> {
    if (!options?.deps) {
      return this.appendAtomically(
        streamId,
        eventType,
        data,
        options?.messageId ?? null,
      );
    }

    const maxAttempts = Math.max(
      1,
      options?.maxAttempts ?? DEFAULT_SEQUENCE_RETRY_ATTEMPTS,
    );
    const getNextSequenceFn =
      options?.deps?.getNextSequenceFn ?? ((id: string) => this.getNextSequence(id));
    const writeStreamEventFn =
      options?.deps?.writeStreamEventFn ??
      ((
        sid: string,
        et: StreamEventTypeName,
        d: unknown,
        seq: number,
        mid?: string | null,
      ) => this.append(sid, et, d, seq, mid));
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      const sequence = await getNextSequenceFn(streamId);
      try {
        const insertedSequence = await writeStreamEventFn(
          streamId,
          eventType,
          data,
          sequence,
          options?.messageId ?? null,
        );
        return typeof insertedSequence === 'number' ? insertedSequence : sequence;
      } catch (error) {
        if (isStreamSequenceConflictError(error) && attempt < maxAttempts - 1) {
          attempt += 1;
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error('Unable to append stream event');
  }

  async read(
    streamId: string,
    options?: ReadRangeOptions,
  ): Promise<StoredStreamEvent[]> {
    const sinceSequence = options?.sinceSequence;
    const limit = options?.limit;

    const conditions =
      sinceSequence !== undefined
        ? and(
            eq(chatStreamEvents.streamId, streamId),
            gt(chatStreamEvents.sequence, sinceSequence),
          )
        : eq(chatStreamEvents.streamId, streamId);

    const q = db
      .select()
      .from(chatStreamEvents)
      .where(conditions)
      .orderBy(chatStreamEvents.sequence);
    const events = limit ? await q.limit(limit) : await q;

    return events.map((event) => ({
      id: event.id,
      messageId: event.messageId,
      streamId: event.streamId,
      eventType: event.eventType,
      data: event.data,
      sequence: event.sequence,
      createdAt: event.createdAt,
    }));
  }

  async listActive(options?: ListActiveOptions): Promise<string[]> {
    const sinceMinutes = options?.sinceMinutes ?? 360; // 6h default
    const limit = options?.limit ?? 200;
    const sinceDate = new Date(Date.now() - sinceMinutes * 60_000);

    const rows = (await db.all(sql`
      SELECT DISTINCT e.stream_id AS "streamId"
      FROM chat_stream_events e
      WHERE e.created_at >= ${sinceDate}
        AND EXISTS (
          SELECT 1
          FROM chat_stream_events s
          WHERE s.stream_id = e.stream_id
            AND s.event_type = 'status'
            AND (s.data->>'state') = 'started'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM chat_stream_events d
          WHERE d.stream_id = e.stream_id
            AND d.event_type = 'done'
        )
      ORDER BY e.stream_id
      LIMIT ${limit}
    `)) as Array<{ streamId: string }>;

    return rows.map((r) => r.streamId).filter(Boolean);
  }
}

export const postgresStreamBuffer = new PostgresStreamBuffer();
