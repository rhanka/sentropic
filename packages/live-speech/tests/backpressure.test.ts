// Backpressure: the final is never starved behind window decodes (r3 L3, P1-4).
// The fake engine busy-blocks the worker thread (not the session loop) per decode.
// At most one window decode is ever in flight, so the endpoint decode waits behind
// at most one bounded blocking call however many cadence ticks fired.
import { describe, expect, it } from 'vitest';
import { LocalSttSession, type LocalSttEvent } from '../src/node/local-stt.js';
import { NodeWorkerClient } from '../src/node/worker-port.js';
import { fakeClientOptions, fakeTinyProfile, flush, silence, tone } from './helpers.js';

describe('backpressure', () => {
  it('should deliver the final without waiting behind stale window decodes', async () => {
    // 8 rapid cadence ticks against a 250 ms blocking worker: uncoalesced, the
    // endpoint would queue behind ~2000 ms of stale windows. Exactly two worker
    // calls happen (one window, then the endpoint); extras fall back to done.
    const script = [{ blockMs: 250 }, { segments: [{ startSec: 0, endSec: 8, text: 'done' }] }];
    const client = await NodeWorkerClient.create(fakeClientOptions(script));
    const events: LocalSttEvent[] = [];
    const session_ = new LocalSttSession({ profile: fakeTinyProfile(), port: client, emit: (event) => events.push(event) });
    try {
      for (let push = 0; push < 8; push++) {
        session_.pushFrames(tone(0.5));
        await flush(2);
      }
      // The worker is blocked; the session loop stays responsive the whole time.
      let alive = 0;
      const beat = setInterval(() => { alive += 1; }, 10);
      const started = Date.now();
      session_.pushFrames(silence(0.7));
      // Wall-time bounded wait: flush() alone yields microtasks without advancing
      // the blocked worker's 250 ms spins.
      let done = events.filter((event) => event.type === 'final');
      while (done.length === 0 && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        done = events.filter((event) => event.type === 'final');
      }
      const elapsedMs = Date.now() - started;
      clearInterval(beat);
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({ utteranceId: 'u1', text: 'done' });
      // One bounded in-flight window plus the endpoint: far below the ~2000 ms
      // an 8-deep stale queue would impose.
      expect(elapsedMs).toBeLessThan(1500);
      expect(alive).toBeGreaterThan(0);
    } finally {
      session_.close();
    }
  });
});
