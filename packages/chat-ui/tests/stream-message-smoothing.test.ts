import { describe, expect, it } from 'vitest';
import {
  getSmoothStepSize,
  shouldAnimateSmoothDelta,
  takeSmoothChunk,
} from '../src/state/streamMessageSmoothing.js';

describe('StreamMessage smoothing helpers', () => {
  it('uses larger pump chunks for larger pending buffers', () => {
    expect(getSmoothStepSize(100)).toBe(6);
    expect(getSmoothStepSize(241)).toBe(12);
    expect(getSmoothStepSize(601)).toBe(20);
    expect(getSmoothStepSize(1201)).toBe(32);
    expect(getSmoothStepSize(2401)).toBe(48);
  });

  it('animates only large deltas or already-buffered streams', () => {
    expect(shouldAnimateSmoothDelta({
      delta: 'short',
      pendingText: '',
      hasTimer: false,
      threshold: 80,
    })).toBe(false);
    expect(shouldAnimateSmoothDelta({
      delta: 'x'.repeat(80),
      pendingText: '',
      hasTimer: false,
      threshold: 80,
    })).toBe(true);
    expect(shouldAnimateSmoothDelta({
      delta: 'short',
      pendingText: 'pending',
      hasTimer: false,
      threshold: 80,
    })).toBe(true);
    expect(shouldAnimateSmoothDelta({
      delta: 'short',
      pendingText: '',
      hasTimer: true,
      threshold: 80,
    })).toBe(true);
  });

  it('takes one chunk and returns the remaining pending text', () => {
    const result = takeSmoothChunk('abcdefghi');
    expect(result).toEqual({ chunk: 'abcdef', remaining: 'ghi' });
  });
});
