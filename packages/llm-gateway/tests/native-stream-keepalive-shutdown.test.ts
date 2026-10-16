/**
 * N30: keepalive shutdown. Aborting the downstream settles the execution
 * promptly, emits nothing after terminal, and leaves no timer behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NATIVE_SSE_KEEPALIVE_MS } from '../src/index.js';
import { START, STOP, setup, upstreamSource } from './fixtures/native-keepalive.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native SSE keepalive shutdown (N30)', () => {
  it('stops timers on abort and never emits after terminal', async () => {
    const upstream = upstreamSource([START, STOP]);
    const { execution, controller } = setup();
    execution.attach(upstream.iterator);
    const priming = execution.prime();
    upstream.gates[0]!.resolve(START);
    await priming;
    const exposed = execution.expose();
    await exposed.next();
    const pending = exposed.next();
    controller.abort(new Error('downstream gone'));
    expect((await pending).done).toBe(true);
    // Flush without firing the 15 s bound: a leaked silence timer is still
    // pending here, so the count proves cleanup instead of vacuous zero.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * NATIVE_SSE_KEEPALIVE_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
