/**
 * BR14b Lot 20 — StreamSequencer port.
 *
 * Allocates monotonic sequence numbers per `streamId`, decoupled from event
 * append. Existing `StreamBuffer.getNextSequence` (Lot 7) already exposes
 * a peek-style allocator backed by `MAX(sequence) + 1` over the
 * `chat_stream_events` table; this port is the **consumed** allocator
 * boundary the runtime can drive without owning `streamSeq` mutation
 * caller-side.
 *
 * Required by the upcoming tool-loop migration (Lots 21+): the loop in
 * `ChatService.runAssistantGeneration` mutates a shared `streamSeq`
 * counter across the reasoning + tool-call + continuation phases. To
 * migrate those phases into `ChatRuntime` we must lift sequence
 * ownership into a port so the runtime can advance the cursor itself
 * (without exposing a stateful `let streamSeq` to the caller).
 *
 * Concrete proof of contract in Lot 20: the two `writeStreamEvent` calls
 * that bracket `ChatRuntime.evaluateReasoningEffort` post-Lot 18
 * (`reasoning_effort_eval_failed` + `reasoning_effort_selected`)
 * reclaim caller-side `streamSeq` mutation. Post-Lot 20 they live inside
 * the runtime; the caller no longer needs to mutate the cursor around
 * the runtime call.
 *
 * Isolated from `./ports.ts` (which pulls @sentropic/contracts and
 * @sentropic/events) so that downstream packages can consume the
 * StreamSequencer surface without the full chat-core dependency closure.
 * Mirrors the isolation pattern established in `./checkpoint-port.ts`
 * (BR14b Lot 4), `./message-port.ts` (BR14b Lot 6), `./stream-port.ts`
 * (BR14b Lot 7), and `./session-port.ts` (BR14b Lot 8).
 *
 * Postgres adapter semantics: `allocate` and `peek` both delegate to the
 * existing `PostgresStreamBuffer.getNextSequence` / a direct
 * `MAX(sequence)` SELECT. The advisory-lock atomic path that
 * `appendWithSequenceRetry` uses is intentionally NOT mirrored here:
 * concurrent allocate+append races are handled by the existing retry
 * loop in `StreamBuffer.append` (Lot 7) which re-queries
 * `getNextSequence` on 23505 conflicts. Lot 20 therefore preserves the
 * exact semantics the runtime had pre-extraction: optimistic allocate
 * via `MAX+1`, retry on conflict.
 *
 * In-memory adapter semantics: a per-`streamId` counter map. Allocation
 * is `++counter[streamId]` and peek returns the current value (or 0).
 * Single-process so no contention; never used in production paths.
 */
export interface StreamSequencer {
  /**
   * Allocate the next sequence number for `streamId`. Strictly monotonic
   * within a single `streamId` (no gap, no duplicate under non-concurrent
   * access). Returns `1` when the stream has never been allocated.
   */
  allocate(streamId: string): Promise<number>;

  /**
   * Peek the latest allocated sequence for `streamId` without consuming.
   * Returns `0` when the stream has never been allocated.
   *
   * Used by callers that need to re-sync a local `streamSeq` cursor with
   * the runtime after the runtime has appended one or more events
   * internally (e.g. `ChatRuntime.evaluateReasoningEffort` writes 1 or 2
   * status events before returning).
   */
  peek(streamId: string): Promise<number>;
}
