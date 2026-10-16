import { describe, expect, it } from 'vitest';
import { NativeSseFramer, NativeSseFrameOverflowError, concatBytes } from '../src/native-sse.js';
import { NativeCumulativeUsageAccumulator } from '../src/native-usage.js';

const enc = (s: string) => new TextEncoder().encode(s);
const start = {
  input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 }, output_tokens: 1,
};

describe('native relay regression contracts', () => {
  it('M1 rejects a complete oversized frame', () => {
    expect(() => new NativeSseFramer().push(enc('data: ' + 'x'.repeat(1_048_576) + '\n\n')))
      .toThrow(NativeSseFrameOverflowError);
  });
  it('M1 rejects overflow completed in the next chunk', () => {
    const f = new NativeSseFramer(20);
    f.push(enc('data: 1234567890'));
    expect(() => f.push(enc('1234567890\n\n'))).toThrow(NativeSseFrameOverflowError);
  });
  it('M2 preserves repeated empty frames', () => {
    const f = new NativeSseFramer();
    const frames = [...f.push(enc('data: 1\n\n\n')), ...f.push(enc('data: 2\n\n')), ...f.finish()];
    expect(concatBytes(frames.map(x => x.rawBytes))).toEqual(enc('data: 1\n\n\ndata: 2\n\n'));
  });
  it.each(['\n', '\r\n', '\r'])('preserves every chunk boundary and UTF-8 with %j', ending => {
    const bytes = enc(ending + ': comment' + ending + ending + 'data: 🤖' + ending + ending + ending);
    for (let split = 0; split <= bytes.length; split++) {
      const f = new NativeSseFramer();
      const frames = [...f.push(bytes.subarray(0, split)), ...f.push(bytes.subarray(split)), ...f.finish()];
      expect(concatBytes(frames.map(x => x.rawBytes))).toEqual(bytes);
      expect(frames.find(x => x.data)?.data).toBe('🤖');
    }
  });
  it('bounds exact CRLF frames separately in a large transport chunk', () => {
    const bytes = enc('data: 🤖\r\n\r\n');
    const frames = new NativeSseFramer(bytes.length).push(concatBytes([bytes, bytes, bytes]));
    expect(frames).toHaveLength(3);
    expect(() => new NativeSseFramer(bytes.length - 1).push(bytes)).toThrow(NativeSseFrameOverflowError);
  });
  it('M3 never restores revoked input proof on a repeated start or growth', () => {
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: 10000.5 });
    a.acceptStart(start);
    a.applyDelta({ input_tokens: 200 });
    expect(a.getState().inputUsageValidated).toBe(false);
    expect(a.getState().proofRevoked).toBe(true);
    expect(a.getState().physicalLowerBound).toBe(10400);
  });
  it('M4 invalid output cannot hide malformed input', () => {
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: 10000.5, output_tokens: -1 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: false, proofRevoked: true,
      uncertaintyReason: 'invalid_input', acceptedInputTokens: 100, physicalLowerBound: 10300 });
  });
  it('M5 rejects unsafe start and delta sums atomically', () => {
    const initial = new NativeCumulativeUsageAccumulator({ input_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_input_tokens: 1, cache_creation_input_tokens: 0 });
    expect(initial.getState()).toMatchObject({ inputUsageValidated: false, physicalLowerBound: 0 });
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: Number.MAX_SAFE_INTEGER });
    expect(a.getState()).toMatchObject({ inputUsageValidated: false, acceptedInputTokens: 100, physicalLowerBound: 10300 });
  });
  it('M6 partial unanchored input does not invent other categories or physical proof', () => {
    const a = new NativeCumulativeUsageAccumulator();
    a.applyDelta({ input_tokens: 100 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: false, physicalLowerBound: 0 });
    expect(a.getRawUsage()).toEqual({ input_tokens: 100 });
  });
  it('M7 default TTL inference is not reported evidence and can resolve explicitly', () => {
    const a = new NativeCumulativeUsageAccumulator({ input_tokens: 100, cache_read_input_tokens: 10000,
      cache_creation_input_tokens: 200 }, { defaultTtlEligible: true });
    expect(a.getRawUsage().cache_creation).toBeUndefined();
    a.applyDelta({ cache_creation_input_tokens: 300 });
    expect(a.getRawUsage().cache_creation).toBeUndefined();
    expect(a.applyDelta({ cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 } })).toBe(true);
    expect(a.getState().proofRevoked).toBe(false);
  });
  it('N5 malformed input remains revoked and nullable aggregate growth advances P once', () => {
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: 10000.5 });
    a.applyDelta({ input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 300 });
    a.applyDelta({ cache_creation_input_tokens: 300 });
    a.applyDelta({ cache_creation_input_tokens: 299 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: false, physicalLowerBound: 10400, proofRevoked: true });
  });
  it('equal aggregate inherits the reported one-hour split and growth preserves raw evidence', () => {
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 200 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: true, reportedCacheCreation1h: 200, physicalInput: 10300 });
    a.applyDelta({ cache_creation_input_tokens: 300 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: true, inferredCacheCreation1h: 300, physicalInput: 10400 });
    expect(a.getRawUsage().cache_creation?.ephemeral_1h_input_tokens).toBe(200);
  });
  it('official V-1 accepts cumulative input growth and permanently revokes a later decrease', () => {
    const a = new NativeCumulativeUsageAccumulator({ input_tokens: 2679, cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0, output_tokens: 3 });
    a.applyDelta({ input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      output_tokens: 510, server_tool_use: { web_search_requests: 1 } });
    expect(a.getState()).toMatchObject({ inputUsageValidated: true, physicalInput: 10682 });
    a.applyDelta({ input_tokens: 10681 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: false, proofRevoked: true, physicalLowerBound: 10682 });
  });
  it('valid input delta keeps input proof when output is malformed', () => {
    const a = new NativeCumulativeUsageAccumulator(start);
    a.applyDelta({ input_tokens: 200, output_tokens: -1 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: true, proofRevoked: false,
      physicalInput: 10400, estimated: true, uncertaintyReason: 'invalid_output' });
  });
  it('official V-1 input-bearing delta retains the valid observed cumulative output', () => {
    const a = new NativeCumulativeUsageAccumulator({ input_tokens: 2679, cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0, output_tokens: 3 });
    a.applyDelta({ input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      output_tokens: 510, server_tool_use: { web_search_requests: 1 } });
    expect(a.getState().acceptedOutputTokens).toBe(510);
    expect(a.getRawUsage().output_tokens).toBe(510);
  });
  it('recomputes pinned reference amounts using integer rational arithmetic', () => {
    const cost = (u: bigint, r: bigint, w1: bigint, readWeight: bigint, output: bigint) =>
      (40n * u + readWeight * r + 80n * w1 + 39n) / 40n + 2n * output;
    expect([4n, 1n].map(weight => cost(100n, 10000n, 200n, weight, 500n))).toEqual([2500n, 1750n]);
    expect([4n, 1n].map(weight => cost(100n, 10000n, 200n, weight, 32000n))).toEqual([65500n, 64750n]);
    expect([4n, 1n].map(weight => cost(100n, 10000n, 300n, weight, 500n))).toEqual([2700n, 1950n]);
    expect(10300n + 2n * 32000n).toBe(74300n);
    expect(10682n + 2n * 510n).toBe(11702n);
    expect(10682n + 2n * 32000n).toBe(74682n);
  });
  it('valid start input remains an anchor when provisional output is malformed', () => {
    const a = new NativeCumulativeUsageAccumulator({ ...start, output_tokens: -1 });
    expect(a.getState()).toMatchObject({ inputUsageValidated: true, physicalInput: 10300, physicalLowerBound: 10300 });
  });
  it('all-null unanchored usage does not manufacture raw zeros', () => {
    const a = new NativeCumulativeUsageAccumulator();
    a.applyDelta({ input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: null });
    expect(a.getRawUsage()).toEqual({});
  });
  it('malformed start fields do not manufacture raw zeros or discard safe evidence', () => {
    const a = new NativeCumulativeUsageAccumulator({ input_tokens: 1.5, cache_read_input_tokens: 10,
      cache_creation_input_tokens: 0, output_tokens: 2 });
    expect(a.getRawUsage()).toEqual({ cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 2 });
  });
});
