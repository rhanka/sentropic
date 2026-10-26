import { describe, expect, it } from 'vitest';
import { Playback } from '../src/core/playback.js';

const frame = (sequence = 0, sampleOffset = 0) => ({
  connectionEpoch: 1, turnEpoch: 1, outputItemId: 'output-1', responseId: 'response-1',
  sequence, sampleOffset, sampleCount: 480, sampleRateHz: 24000, payload: new Uint8Array(960),
});

describe('heard prefix and stale output', () => {
  it('should measure rendered samples and never equate generation done with heard audio', () => {
    const p = new Playback(1, 1);
    expect(p.enqueue(frame())).toBe(true);
    expect(p.enqueue(frame(1, 480))).toBe(true);
    p.generatedDone('output-1');
    expect(p.progress('output-1')).toMatchObject({ playedSamples: 0, generatedSamples: 960 });
    p.rendered('output-1', 700, 10);
    p.rendered('output-1', 100, 0);
    expect(p.progress('output-1')).toMatchObject({ playedSamples: 700, uncertaintySamples: 10 });
    p.rendered('output-1', 2000, 5);
    expect(p.progress('output-1')?.playedSamples).toBe(960);
  });

  it('should clear immediately and reject late old-epoch output across channel reordering', () => {
    const p = new Playback(1, 1);
    p.enqueue(frame());
    expect(p.clear()).toEqual([{ outputItemId: 'output-1', playedSamples: 0, uncertaintySamples: 0 }]);
    expect(p.take()).toBeUndefined();
    expect(p.enqueue(frame(1, 480))).toBe(false);
    p.bind(2, 2);
    expect(p.enqueue(frame())).toBe(false);
    expect(p.enqueue({ ...frame(), connectionEpoch: 2, turnEpoch: 2 })).toBe(true);
    expect(() => p.bind(1, 3)).toThrow('epoch');
  });

  it('should refuse duplicates, gaps, invalid payloads and queues over 250ms', () => {
    const p = new Playback(1, 1);
    expect(p.enqueue(frame())).toBe(true);
    expect(p.enqueue(frame())).toBe(false);
    expect(p.enqueue(frame(2, 960))).toBe(false);
    expect(p.enqueue({ ...frame(1, 480), payload: new Uint8Array(2) })).toBe(false);
    for (let i = 1; i < 12; i++) expect(p.enqueue(frame(i, i * 480))).toBe(true);
    expect(p.enqueue(frame(12, 5760))).toBe(false);
    p.take();
    expect(p.enqueue(frame(12, 5760))).toBe(true);
  });
});
