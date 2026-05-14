/**
 * BR14b Lot 15.5 — InMemoryStreamBuffer.
 *
 * Reference in-memory adapter for the `StreamBuffer` port. Mandated by
 * SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5.
 *
 * Behavior mirrors `PostgresStreamBuffer` minus the PostgreSQL `NOTIFY`
 * side-effect (transport stays outside the port per SPEC §7) and the
 * advisory-lock atomic-allocation path: in-memory storage is naturally
 * single-threaded so sequence allocation cannot conflict.
 *
 * `appendWithSequenceRetry` honors the legacy `deps` injection contract
 * (used by `api/tests/unit/stream-service.test.ts`) by routing through
 * `getNextSequenceFn` + `writeStreamEventFn` when provided; without
 * `deps` it falls back to a simple `MAX(sequence)+1` allocation.
 */
import type {
  AppendWithRetryOptions,
  ListActiveOptions,
  ReadRangeOptions,
  StoredStreamEvent,
  StreamBuffer,
  StreamEventTypeName,
} from '../stream-port.js';

let eventCounter = 0;
const nextEventId = (): string => {
  eventCounter += 1;
  return `mem-event-${eventCounter}-${Date.now().toString(36)}`;
};

let streamCounter = 0;
const nextStreamId = (): string => {
  streamCounter += 1;
  return `stream_mem-${streamCounter}_${Date.now().toString(36)}`;
};

export class InMemoryStreamBuffer implements StreamBuffer {
  private eventsByStream = new Map<string, StoredStreamEvent[]>();

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.eventsByStream.clear();
  }

  /** Test helper — snapshot of all events for a stream. */
  snapshot(streamId: string): StoredStreamEvent[] {
    return [...(this.eventsByStream.get(streamId) ?? [])].map((event) => ({
      ...event,
    }));
  }

  generateStreamId(
    promptId?: string,
    jobId?: string,
    messageId?: string,
  ): string {
    if (messageId) return messageId;
    if (jobId) return `job_${jobId}`;
    if (promptId) return `prompt_${promptId}_${Date.now()}`;
    return nextStreamId();
  }

  async append(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ): Promise<number> {
    const list = this.eventsByStream.get(streamId) ?? [];
    const finalSequence =
      Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
    if (list.some((event) => event.sequence === finalSequence)) {
      throw Object.assign(new Error('stream sequence conflict'), {
        code: '23505',
      });
    }
    const stored: StoredStreamEvent = {
      id: nextEventId(),
      messageId: messageId ?? null,
      streamId,
      eventType,
      data,
      sequence: finalSequence,
      createdAt: new Date(),
    };
    list.push(stored);
    list.sort((a, b) => a.sequence - b.sequence);
    this.eventsByStream.set(streamId, list);
    return finalSequence;
  }

  async getNextSequence(streamId: string): Promise<number> {
    const list = this.eventsByStream.get(streamId) ?? [];
    const max = list.reduce(
      (acc, event) => (event.sequence > acc ? event.sequence : acc),
      0,
    );
    return max + 1;
  }

  async appendWithSequenceRetry(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    options?: AppendWithRetryOptions,
  ): Promise<number> {
    if (!options?.deps) {
      const sequence = await this.getNextSequence(streamId);
      return this.append(
        streamId,
        eventType,
        data,
        sequence,
        options?.messageId ?? null,
      );
    }

    const maxAttempts = Math.max(1, options?.maxAttempts ?? 6);
    const getNextSequenceFn =
      options.deps.getNextSequenceFn ?? ((id: string) => this.getNextSequence(id));
    const writeStreamEventFn =
      options.deps.writeStreamEventFn ??
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
        const inserted = await writeStreamEventFn(
          streamId,
          eventType,
          data,
          sequence,
          options?.messageId ?? null,
        );
        return typeof inserted === 'number' ? inserted : sequence;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === '23505' && attempt < maxAttempts - 1) {
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
    const list = this.eventsByStream.get(streamId) ?? [];
    const filtered = list.filter((event) =>
      options?.sinceSequence !== undefined
        ? event.sequence > options.sinceSequence
        : true,
    );
    const sorted = [...filtered].sort((a, b) => a.sequence - b.sequence);
    const limited =
      typeof options?.limit === 'number' && options.limit >= 0
        ? sorted.slice(0, options.limit)
        : sorted;
    return limited.map((event) => ({ ...event }));
  }

  async listActive(options?: ListActiveOptions): Promise<string[]> {
    const sinceMinutes = options?.sinceMinutes ?? 360;
    const limit = options?.limit ?? 200;
    const cutoff = Date.now() - sinceMinutes * 60_000;
    const active: string[] = [];
    for (const [streamId, events] of this.eventsByStream.entries()) {
      const inWindow = events.some(
        (event) => event.createdAt.getTime() >= cutoff,
      );
      if (!inWindow) continue;
      const hasStarted = events.some(
        (event) =>
          event.eventType === 'status' &&
          (event.data as { state?: unknown } | null)?.state === 'started',
      );
      const hasDone = events.some((event) => event.eventType === 'done');
      if (hasStarted && !hasDone) active.push(streamId);
    }
    return active.sort().slice(0, limit);
  }
}
