/**
 * BR14b Lot 19 — pure steer-interruption helpers.
 *
 * Extracted verbatim from `api/src/services/chat-service.ts`
 * (`runAssistantGeneration`). The two helpers below were inline definitions
 * before this lot:
 *   - `normalizeSteerMessage(value)` (line 2813-2816 pre-Lot 19): whitespace
 *     collapse + trim of a steer message string.
 *   - `consumePendingSteerMessages()` (line 2998-3018 pre-Lot 19): closure
 *     that read pending stream events via `readStreamEvents` since a captured
 *     cursor `lastObservedStreamSequence`, filtered the `status` /
 *     `steer_received` events, normalized their `message` field, and
 *     mutated the captured cursor in-place.
 *
 * Lot 19 turns the closure into a pure function: the captured cursor
 * `lastObservedStreamSequence` and the captured stream identifier
 * (assistant message id used as stream id by chat-service.ts) become
 * explicit input fields. The function now returns the updated cursor
 * value alongside the normalized messages so the caller can advance
 * its own local `lastObservedStreamSequence` from the returned
 * `nextSinceSequence`.
 *
 * Behavior preservation is the absolute contract — same filter,
 * same normalization, same ordering, same empty-events short-circuit
 * (returns the input `sinceSequence` unchanged when no events are
 * observed). Mirrors the Lot 14b `history.ts` pure-helper extraction
 * pattern so any future CLI/runtime consumer can wire its own
 * `StreamBuffer` adapter.
 */
import type { StreamBuffer } from './stream-port.js';

/**
 * Type-narrow helper duplicated from `chat-service.ts` (`asRecord`,
 * line ~246). Kept private to this module; chat-core duplicates such
 * tiny pure helpers rather than importing from api/* to preserve
 * the chat-core boundary.
 */
const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/**
 * Normalize a steer message string by collapsing all whitespace runs into
 * single spaces and trimming the result. Verbatim port of the inline
 * helper at `chat-service.ts` line 2813-2816 (pre-Lot 19).
 */
export const normalizeSteerMessage = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

/**
 * Input contract for `consumePendingSteerMessages`. The chat-service.ts
 * call site uses `options.assistantMessageId` as both the stream id and
 * the message id, and reads/mutates the local `lastObservedStreamSequence`
 * counter. The pure helper turns those captures into explicit fields.
 */
export type ConsumePendingSteerMessagesInput = {
  readonly streamBuffer: StreamBuffer;
  readonly streamId: string;
  readonly sinceSequence: number;
};

/**
 * Pure result of `consumePendingSteerMessages`. `messages` carries the
 * normalized steer message texts in stream order. `nextSinceSequence`
 * advances the caller's cursor to the sequence of the last observed
 * event (whether or not it was a steer_received event). When no events
 * are observed, `nextSinceSequence` equals the input `sinceSequence`
 * (mirrors the closure's no-mutation short-circuit pre-Lot 19).
 */
export type ConsumePendingSteerMessagesResult = {
  readonly messages: string[];
  readonly nextSinceSequence: number;
};

/**
 * Read pending stream events strictly past `input.sinceSequence` for
 * `input.streamId`, then return the normalized `steer_received`
 * messages and the advanced cursor.
 *
 * Verbatim port of the closure body at `chat-service.ts` line
 * 2998-3018 (pre-Lot 19). The cursor mutation that lived inside the
 * closure (`lastObservedStreamSequence = ...`) is now expressed as
 * `nextSinceSequence` in the return value — the caller assigns it
 * back to its local counter.
 */
export const consumePendingSteerMessages = async (
  input: ConsumePendingSteerMessagesInput,
): Promise<ConsumePendingSteerMessagesResult> => {
  const events = await input.streamBuffer.read(input.streamId, {
    sinceSequence: input.sinceSequence,
  });
  if (events.length === 0) {
    return { messages: [], nextSinceSequence: input.sinceSequence };
  }
  const nextSinceSequence =
    events[events.length - 1]?.sequence ?? input.sinceSequence;

  const messages: string[] = [];
  for (const event of events) {
    if (event.eventType !== 'status') continue;
    const data = asRecord(event.data);
    if (!data || data.state !== 'steer_received') continue;
    const message =
      typeof data.message === 'string' ? normalizeSteerMessage(data.message) : '';
    if (message) messages.push(message);
  }
  return { messages, nextSinceSequence };
};
