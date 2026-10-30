import { describe, expect, it } from 'vitest';
import {
  FRAME_CAP,
  LOGICAL_CAP,
  MCP_JSON_CAP,
  reassemble,
  splitForTransport,
} from '../../src/services/canvas-live/sync-framing';

describe('canvas live sync framing', () => {
  it('should enforce a 1 MiB per-frame cap and an 8 MiB logical-update cap', () => {
    expect(FRAME_CAP).toBe(1024 * 1024);
    expect(LOGICAL_CAP).toBe(8 * 1024 * 1024);
    expect(MCP_JSON_CAP).toBe(256 * 1024);
    expect(() => reassemble([new Uint8Array(FRAME_CAP + 1)])).toThrow('frame-too-large');
    const frames = Array.from({ length: 9 }, () => new Uint8Array(FRAME_CAP));
    expect(() => reassemble(frames)).toThrow('logical-update-too-large');
  });

  it('should reassemble bounded frames without truncation', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    expect([...reassemble([first, second])]).toEqual([1, 2, 3, 4, 5]);
  });

  it('should refuse a partial logical update instead of applying it', () => {
    const frame = new Uint8Array([9, 9, 9]);
    expect(() => reassemble([frame], 4)).toThrow('incomplete-frame');
    expect(() => reassemble([], 0)).toThrow('incomplete-frame');
  });

  it('should frame a legitimate catch-up larger than the MCP JSON cap', () => {
    const large = new Uint8Array(FRAME_CAP + 1024);
    large.fill(7);
    const frames = splitForTransport(large);
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame.byteLength).toBeLessThanOrEqual(FRAME_CAP);
    expect(reassemble(frames)).toEqual(large);
  });

  it('should refuse an empty update and an oversized split', () => {
    expect(() => splitForTransport(new Uint8Array(0))).toThrow('incomplete-frame');
    expect(() => splitForTransport(new Uint8Array(LOGICAL_CAP + 1))).toThrow('logical-update-too-large');
  });
});
