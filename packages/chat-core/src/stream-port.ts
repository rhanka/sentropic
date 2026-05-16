/**
 * Per SPEC §4 (Stream protocol) + §5 (Ports list) + §10.6 (offline-first replay).
 * Owns chat-stream persistence + sequence allocation + active-stream discovery
 * + replay range reads. Wire-format and SSE transport remain OUTSIDE this port
 * (per SPEC §7 anti-pattern: inline transport must not leak into chat-core core).
 *
 * Isolated from `./ports.ts` (which pulls @sentropic/contracts and
 * @sentropic/events) so that downstream packages can consume the
 * StreamBuffer surface without the full chat-core dependency closure.
 * Mirrors the isolation pattern established in `./checkpoint-port.ts`
 * (BR14b Lot 4) and `./message-port.ts` (BR14b Lot 6): pre BR14b wiring of
 * contracts/events into the api Dockerfile, this lets the api workspace
 * import the port via relative path.
 *
 * Event-type taxonomy is intentionally kept as the existing `api`-side wire
 * union (`reasoning_delta | content_delta | tool_call_start | tool_call_delta
 * | tool_call_result | status | error | done`) — that union is what
 * `chat_stream_events.event_type` stores today. The SPEC §4 `StreamEvent`
 * envelope (versioned wire shape) is a separate, future protocol layer and
 * lives in `@sentropic/events`. BR14b preserves 100% of current behavior;
 * wire-protocol migration is deferred.
 */
export type StreamEventTypeName =
  | 'reasoning_delta'
  | 'content_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_result'
  | 'status'
  | 'error'
  | 'done';

/**
 * Stored stream event row shape (mirrors `chat_stream_events` table verbatim).
 * Mirrors what `stream-service.readStreamEvents` returned pre BR14b Lot 7.
 */
export type StoredStreamEvent = {
  readonly id: string;
  readonly messageId: string | null;
  readonly streamId: string;
  readonly eventType: string;
  readonly data: unknown;
  readonly sequence: number;
  readonly createdAt: Date;
};

/**
 * Dependency-injection hooks for `appendWithSequenceRetry`. Preserves the
 * existing test contract from `api/tests/unit/stream-service.test.ts` where
 * unit tests inject fakes for `getNextSequence` + `append`.
 */
export type SequenceRetryDeps = {
  readonly getNextSequenceFn?: (streamId: string) => Promise<number>;
  readonly writeStreamEventFn?: (
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ) => Promise<number | void>;
};

export type AppendWithRetryOptions = {
  readonly messageId?: string | null;
  readonly maxAttempts?: number;
  readonly deps?: SequenceRetryDeps;
};

export type ListActiveOptions = {
  readonly sinceMinutes?: number;
  readonly limit?: number;
};

export type ReadRangeOptions = {
  readonly sinceSequence?: number;
  readonly limit?: number;
};

/**
 * StreamBuffer port — contracts-free surface for chat-stream persistence.
 *
 * `append` writes at a caller-allocated sequence (existing optimistic path).
 * `appendWithSequenceRetry` performs atomic allocation (advisory lock +
 * MAX(sequence)+1 inside one tx) on the default path, and falls back to a
 * retry loop driven by `getNextSequence` + `append` only when `deps` is
 * provided (preserves the legacy unit-test injection contract).
 */
export interface StreamBuffer {
  /**
   * Derive a deterministic / fallback streamId from the caller context.
   * Pure policy, no I/O. Priority: messageId > jobId > promptId > random.
   */
  generateStreamId(
    promptId?: string,
    jobId?: string,
    messageId?: string,
  ): string;

  /**
   * Append one event at the caller-supplied `sequence` (must be > 0).
   * Retries on UNIQUE (stream_id, sequence) conflicts by re-querying
   * `getNextSequence` up to a small bounded number of attempts.
   * Returns the sequence actually stored.
   */
  append(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ): Promise<number>;

  /**
   * Returns the next free sequence for `streamId` (= MAX(sequence) + 1).
   */
  getNextSequence(streamId: string): Promise<number>;

  /**
   * Append with atomic sequence allocation (advisory lock + MAX+1 in one
   * transaction) on the default path. When `options.deps` is provided,
   * uses the legacy retry-loop driven by the injected helpers — required
   * by `api/tests/unit/stream-service.test.ts` writeStreamEventWithSequenceRetry
   * cases that simulate 23505 conflicts.
   */
  appendWithSequenceRetry(
    streamId: string,
    eventType: StreamEventTypeName,
    data: unknown,
    options?: AppendWithRetryOptions,
  ): Promise<number>;

  /**
   * Read stored events for `streamId`, optionally filtered by `sinceSequence`
   * (strict greater-than) and `limit`. Always ordered by sequence ASC.
   */
  read(
    streamId: string,
    options?: ReadRangeOptions,
  ): Promise<StoredStreamEvent[]>;

  /**
   * List "active" stream ids: started AND not yet done within the window.
   * Used by the monitor widget to subscribe to every in-flight stream.
   */
  listActive(options?: ListActiveOptions): Promise<string[]>;
}
