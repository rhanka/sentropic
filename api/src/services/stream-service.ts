/**
 * BR14b Lot 7 — thin delegation shim over the StreamBuffer port.
 *
 * Real implementation moved to `./chat/postgres-stream-buffer.ts` which
 * implements `StreamBuffer` from `@sentropic/chat-core` (imported via
 * relative path until BR14b wires the package fully into the api Dockerfile).
 *
 * Public surface (function names + signatures) is preserved verbatim so
 * existing call sites in chat-service.ts, queue-manager.ts,
 * context-document.ts, routes/api/chat.ts, routes/api/queue.ts, and
 * routes/api/streams.ts compile and behave identically.
 */
import type { StreamEventType } from './llm-runtime';
import type { StreamEventTypeName } from '../../../packages/chat-core/src/stream-port';
import { postgresStreamBuffer } from './chat/postgres-stream-buffer';

/**
 * Generates a unique stream_id
 * - For classic generations: `prompt_id` + timestamp (or `job_id` if available)
 * - For chat: `message_id`
 */
export function generateStreamId(
  promptId?: string,
  jobId?: string,
  messageId?: string,
): string {
  return postgresStreamBuffer.generateStreamId(promptId, jobId, messageId);
}

/**
 * Writes a streaming event to the database and emits a PostgreSQL NOTIFY
 * for realtime SSE consumers.
 */
export async function writeStreamEvent(
  streamId: string,
  eventType: StreamEventType,
  data: unknown,
  sequence: number,
  messageId?: string | null,
): Promise<number> {
  return postgresStreamBuffer.append(
    streamId,
    eventType as StreamEventTypeName,
    data,
    sequence,
    messageId,
  );
}

/**
 * Returns the next sequence number for `streamId` (= MAX(sequence) + 1).
 */
export async function getNextSequence(streamId: string): Promise<number> {
  return postgresStreamBuffer.getNextSequence(streamId);
}

type SequenceRetryDeps = {
  getNextSequenceFn?: (streamId: string) => Promise<number>;
  writeStreamEventFn?: (
    streamId: string,
    eventType: StreamEventType,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ) => Promise<number | void>;
};

/**
 * Writes a stream event with optimistic sequence assignment and retries when
 * a concurrent insert hits the unique (stream_id, sequence) constraint.
 *
 * Default path (no `options.deps`) uses an atomic advisory-lock + MAX+1
 * transaction. The `deps` path preserves the legacy injection contract used
 * by `api/tests/unit/stream-service.test.ts`.
 */
export async function writeStreamEventWithSequenceRetry(
  streamId: string,
  eventType: StreamEventType,
  data: unknown,
  options?: {
    messageId?: string | null;
    maxAttempts?: number;
    deps?: SequenceRetryDeps;
  },
): Promise<number> {
  return postgresStreamBuffer.appendWithSequenceRetry(
    streamId,
    eventType as StreamEventTypeName,
    data,
    {
      messageId: options?.messageId ?? null,
      maxAttempts: options?.maxAttempts,
      deps: options?.deps as
        | import('../../../packages/chat-core/src/stream-port').SequenceRetryDeps
        | undefined,
    },
  );
}

/**
 * Reads events for a stream from the database (rehydration / replay).
 */
export async function readStreamEvents(
  streamId: string,
  sinceSequence?: number,
  limit?: number,
): Promise<
  Array<{
    id: string;
    messageId: string | null;
    streamId: string;
    eventType: string;
    data: unknown;
    sequence: number;
    createdAt: Date;
  }>
> {
  const rows = await postgresStreamBuffer.read(streamId, {
    sinceSequence,
    limit,
  });
  return rows.map((row) => ({
    id: row.id,
    messageId: row.messageId,
    streamId: row.streamId,
    eventType: row.eventType,
    data: row.data,
    sequence: row.sequence,
    createdAt: row.createdAt,
  }));
}

/**
 * Lists "active" stream_ids (started but not yet finished).
 * Used by the monitor widget to subscribe to all in-flight streams.
 */
export async function listActiveStreamIds(options?: {
  sinceMinutes?: number;
  limit?: number;
}): Promise<string[]> {
  return postgresStreamBuffer.listActive(options);
}
