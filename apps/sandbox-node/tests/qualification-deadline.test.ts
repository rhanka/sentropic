import { describe, expect, it, vi } from 'vitest';
import { QualificationDeadline, qualificationDeadline } from '../src/qualification-deadline.js';

describe('qualification cancellation', () => {
  it('should default to 120 seconds and reject invalid or excessive overrides', () => {
    expect(qualificationDeadline()).toBe(120_000);
    expect(qualificationDeadline('2000')).toBe(2000);
    for (const value of ['0', '-1', '', 'NaN', '300001', '1.5']) expect(() => qualificationDeadline(value)).toThrow();
  });
  it.each(['deadline', 'SIGTERM', 'SIGINT', 'scope-exit'])('should interrupt a hung probe and release listeners on %s', async cause => {
    vi.useFakeTimers();
    const term = process.listenerCount('SIGTERM'), int = process.listenerCount('SIGINT');
    const run = new QualificationDeadline(120_000);
    let cleaned = false;
    const work = (async () => {
      try { await run.wait(new Promise<void>(() => {})); }
      finally { cleaned = true; run.close(); }
    })();
    const result = expect(work).rejects.toThrow(cause === 'deadline' ? 'deadline' : cause === 'scope-exit' ? 'scope exited' : 'interrupted');
    try {
      if (cause === 'deadline') await vi.advanceTimersByTimeAsync(120_000);
      else if (cause === 'scope-exit') {
        let alive = true;
        run.monitor(() => { if (!alive) throw new Error('scope exited'); });
        alive = false; await vi.advanceTimersByTimeAsync(100);
      } else process.emit(cause as 'SIGTERM' | 'SIGINT');
      await result;
      expect(cleaned).toBe(true);
      expect(process.listenerCount('SIGTERM')).toBe(term);
      expect(process.listenerCount('SIGINT')).toBe(int);
      expect(vi.getTimerCount()).toBe(0);
    } finally { run.close(); vi.useRealTimers(); }
  });
});
