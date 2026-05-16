/**
 * BR14b Lot 20 — InMemoryStreamSequencer.
 *
 * Reference in-memory adapter for the `StreamSequencer` port. Single-
 * process per-`streamId` counter map. `allocate` returns the next
 * sequence (1-based, monotonic per streamId, no gap); `peek` returns the
 * last-allocated value (0 before any allocation).
 *
 * Behaviour mirrors `InMemoryStreamBuffer.getNextSequence` semantically
 * (MAX(sequence)+1 over the per-stream event list) but the sequencer is
 * decoupled from event storage so the runtime can drive the cursor
 * without owning the events themselves.
 */
import type { StreamSequencer } from '../stream-sequencer-port.js';

export class InMemoryStreamSequencer implements StreamSequencer {
  private counters = new Map<string, number>();

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.counters.clear();
  }

  /** Test helper — read the current counter without mutating. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }

  async allocate(streamId: string): Promise<number> {
    const next = (this.counters.get(streamId) ?? 0) + 1;
    this.counters.set(streamId, next);
    return next;
  }

  async peek(streamId: string): Promise<number> {
    return this.counters.get(streamId) ?? 0;
  }
}
