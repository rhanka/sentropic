/**
 * N30: pending SSE keepalive emission (owner option a). After commitment, the
 * native relay emits `: keepalive\n\n` only between complete frames after
 * 15 s of upstream silence; upstream bytes stay identical and no usage is
 * recorded for comments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NATIVE_SSE_KEEPALIVE_MS } from '../src/index.js';
import { KEEPALIVE, START, STOP, setup, text, upstreamSource } from './fixtures/native-keepalive.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native SSE keepalive emission (N30)', () => {
  it(`emits one keepalive per ${NATIVE_SSE_KEEPALIVE_MS} ms of silence, preserving upstream bytes`, async () => {
    const upstream = upstreamSource([START, STOP]);
    const { execution } = setup();
    execution.attach(upstream.iterator);
    const priming = execution.prime();
    upstream.gates[0]!.resolve(START);
    await priming;
    const exposed = execution.expose();
    expect(text((await exposed.next()).value!.bytes)).toBe(text(START));
    // Exactly one comment per silence bound, then the timer re-arms.
    const first = exposed.next();
    await vi.advanceTimersByTimeAsync(NATIVE_SSE_KEEPALIVE_MS);
    expect((await first).value!.bytes).toEqual(KEEPALIVE);
    const second = exposed.next();
    await vi.advanceTimersByTimeAsync(NATIVE_SSE_KEEPALIVE_MS);
    expect((await second).value!.bytes).toEqual(KEEPALIVE);
    // The pending upstream read still delivers its frame intact afterwards.
    const pending = exposed.next();
    upstream.gates[1]!.resolve(STOP);
    expect(text((await pending).value!.bytes)).toBe(text(STOP));
    expect((await exposed.next()).done).toBe(true);
  });

  it('emits no keepalive when frames flow faster than the silence bound', async () => {
    const upstream = upstreamSource([START, STOP]);
    const { execution } = setup();
    execution.attach(upstream.iterator);
    const priming = execution.prime();
    upstream.gates[0]!.resolve(START);
    await priming;
    const exposed = execution.expose();
    await exposed.next();
    const pending = exposed.next();
    await vi.advanceTimersByTimeAsync(NATIVE_SSE_KEEPALIVE_MS - 1);
    upstream.gates[1]!.resolve(STOP);
    expect(text((await pending).value!.bytes)).toBe(text(STOP));
  });

  it('emits no keepalive before commitment', async () => {
    const upstream = upstreamSource([START]);
    const { execution } = setup();
    execution.attach(upstream.iterator);
    // Silence before the first frame: prime still waits for upstream bytes.
    const priming = execution.prime();
    await vi.advanceTimersByTimeAsync(2 * NATIVE_SSE_KEEPALIVE_MS);
    upstream.gates[0]!.resolve(START);
    await priming;
  });

  it('records no usage for keepalive comments', async () => {
    const upstream = upstreamSource([START, STOP]);
    const { execution, settle, attempt } = setup();
    execution.attach(upstream.iterator);
    const priming = execution.prime();
    upstream.gates[0]!.resolve(START);
    await priming;
    const exposed = execution.expose();
    await exposed.next();
    const keepalive = exposed.next();
    await vi.advanceTimersByTimeAsync(NATIVE_SSE_KEEPALIVE_MS);
    await keepalive;
    const pending = exposed.next();
    upstream.gates[1]!.resolve(STOP);
    await pending;
    await exposed.next();
    expect(attempt.complete).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('success');
    const firstCall = attempt.complete.mock.calls[0] as unknown as readonly unknown[] | undefined;
    const usage = firstCall?.[0] as { inputTokens: number; outputTokens: number };
    expect([usage.inputTokens, usage.outputTokens]).toEqual([0, 0]);
  });
});
