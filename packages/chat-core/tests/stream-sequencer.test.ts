/**
 * BR14b Lot 20 — InMemoryStreamSequencer unit tests.
 *
 * Covers the reference in-memory adapter for the `StreamSequencer` port
 * introduced in Lot 20. Exercises:
 *   - monotonicity per streamId (no duplicate, no gap)
 *   - per-stream isolation (allocate on one stream does not move others)
 *   - peek returns 0 before any allocation
 *   - peek returns last-allocated value after one or more allocations
 *   - reset wipes all internal state
 *   - snapshot returns the current cursor map
 */
import { describe, expect, it } from 'vitest';

import { InMemoryStreamSequencer } from '../src/in-memory/stream-sequencer.js';

describe('InMemoryStreamSequencer (Lot 20)', () => {
  it('allocates monotonic sequences starting at 1 for a fresh stream', async () => {
    const seq = new InMemoryStreamSequencer();
    expect(await seq.allocate('s-1')).toBe(1);
    expect(await seq.allocate('s-1')).toBe(2);
    expect(await seq.allocate('s-1')).toBe(3);
    expect(await seq.allocate('s-1')).toBe(4);
  });

  it('isolates counters per stream id', async () => {
    const seq = new InMemoryStreamSequencer();
    expect(await seq.allocate('a')).toBe(1);
    expect(await seq.allocate('b')).toBe(1);
    expect(await seq.allocate('a')).toBe(2);
    expect(await seq.allocate('c')).toBe(1);
    expect(await seq.allocate('b')).toBe(2);
    expect(await seq.allocate('a')).toBe(3);
  });

  it('peek returns 0 before any allocation for a stream', async () => {
    const seq = new InMemoryStreamSequencer();
    expect(await seq.peek('never-allocated')).toBe(0);
    // Allocating on another stream must not affect peek of an unrelated stream.
    await seq.allocate('other');
    expect(await seq.peek('never-allocated')).toBe(0);
  });

  it('peek returns the last allocated value without consuming', async () => {
    const seq = new InMemoryStreamSequencer();
    await seq.allocate('s');
    expect(await seq.peek('s')).toBe(1);
    expect(await seq.peek('s')).toBe(1); // idempotent
    await seq.allocate('s');
    expect(await seq.peek('s')).toBe(2);
    // Next allocate continues from the peeked value (no gap).
    expect(await seq.allocate('s')).toBe(3);
  });

  it('reset wipes the counters for every stream', async () => {
    const seq = new InMemoryStreamSequencer();
    await seq.allocate('a');
    await seq.allocate('a');
    await seq.allocate('b');
    seq.reset();
    expect(await seq.peek('a')).toBe(0);
    expect(await seq.peek('b')).toBe(0);
    expect(await seq.allocate('a')).toBe(1);
  });

  it('snapshot exposes the current counter map', async () => {
    const seq = new InMemoryStreamSequencer();
    await seq.allocate('a');
    await seq.allocate('a');
    await seq.allocate('b');
    expect(seq.snapshot()).toEqual({ a: 2, b: 1 });
  });
});
