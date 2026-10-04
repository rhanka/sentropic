import { describe, expect, it } from 'vitest';
import { NativeCumulativeUsageAccumulator } from '../src/native-usage.js';

describe('native usage accumulator', () => {
  const validStart = {
    input_tokens: 100,
    cache_read_input_tokens: 10_000,
    cache_creation_input_tokens: 200,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
    output_tokens: 1,
  };

  it('should retain V-1 cumulative output independently of input-bearing deltas (R1)', () => {
    const acc = new NativeCumulativeUsageAccumulator({ input_tokens: 2679,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 });
    acc.applyDelta({ input_tokens: 10682, cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0, output_tokens: 510, server_tool_use: { web_search_requests: 1 } });
    expect(acc.getState()).toMatchObject({ physicalInput: 10682, acceptedOutputTokens: 510 });
    expect(acc.getRawUsage().output_tokens).toBe(510);
    acc.applyDelta({ output_tokens: 510 });
    expect(acc.getState().acceptedOutputTokens).toBe(510);
    acc.applyDelta({ input_tokens: 1.5, output_tokens: 520 });
    expect(acc.getState()).toMatchObject({ proofRevoked: true, acceptedOutputTokens: 520 });
    expect(acc.getRawUsage().output_tokens).toBe(520);
    acc.applyDelta({ output_tokens: 519 });
    expect(acc.getState().acceptedOutputTokens).toBe(520);
  });

  it('permanently retains attempt-lifetime revocation and rejects second start as conflict', () => {
    const acc = new NativeCumulativeUsageAccumulator(validStart);
    expect(acc.getState().inputUsageValidated).toBe(true);
    expect(acc.getState().proofRevoked).toBe(false);

    expect(acc.applyDelta({ input_tokens: 10000.5 })).toBe(false);
    expect(acc.getState().inputUsageValidated).toBe(false);
    expect(acc.getState().proofRevoked).toBe(true);
    expect(acc.getState().uncertaintyReason).toBe('invalid_input');

    expect(acc.acceptStart(validStart)).toBe(false);
    expect(acc.getState().inputUsageValidated).toBe(false);
    expect(acc.getState().proofRevoked).toBe(true);
    expect(acc.getState().physicalLowerBound).toBe(10300);

    acc.applyDelta({ input_tokens: 200 });
    expect(acc.getState().inputUsageValidated).toBe(false);
    expect(acc.getState().proofRevoked).toBe(true);

    const acc2 = new NativeCumulativeUsageAccumulator(validStart);
    expect(acc2.applyDelta({ input_tokens: 50 })).toBe(false);
    expect(acc2.getState().proofRevoked).toBe(true);
    expect(acc2.getState().uncertaintyReason).toBe('input_breakdown_changed');
    expect(acc2.acceptStart(validStart)).toBe(false);
    expect(acc2.getState().inputUsageValidated).toBe(false);
  });

  it.each(['start', 'input delta', 'output delta'])('should preserve valid input with invalid output in %s (M4-R)', phase => {
    const acc = new NativeCumulativeUsageAccumulator({ ...validStart,
      ...(phase === 'start' ? { output_tokens: -1 } : {}) });
    if (phase !== 'start') acc.applyDelta({ output_tokens: -1,
      ...(phase === 'input delta' ? { input_tokens: 200 } : {}) });
    expect(acc.getState()).toMatchObject({ inputUsageValidated: true, proofRevoked: false,
      physicalInput: phase === 'input delta' ? 10400 : 10300,
      estimated: true, uncertaintyReason: 'invalid_output' });
    acc.applyDelta({ input_tokens: 10000.5, output_tokens: -1 });
    expect(acc.getState()).toMatchObject({ inputUsageValidated: false, proofRevoked: true,
      uncertaintyReason: 'invalid_input' });
  });

  it('validates input update independently of output validity and revokes malformed input', () => {
    const acc = new NativeCumulativeUsageAccumulator(validStart);
    expect(acc.getState().inputUsageValidated).toBe(true);

    const res = acc.applyDelta({ input_tokens: 10000.5, output_tokens: -1 });
    expect(res).toBe(false);
    expect(acc.getState().inputUsageValidated).toBe(false);
    expect(acc.getState().proofRevoked).toBe(true);
    expect(acc.getState().uncertaintyReason).toBe('invalid_input');
    expect(acc.getState().estimated).toBe(true);
    expect(acc.getState().acceptedInputTokens).toBe(100);
    expect(acc.getState().physicalLowerBound).toBe(10300);
  });

  it('rejects unsafe totals computed with bigint atomically without advancing bounds (M5)', () => {
    const accStart = new NativeCumulativeUsageAccumulator({
      input_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 0,
    });
    expect(accStart.getState().inputUsageValidated).toBe(false);
    expect(accStart.getState().proofRevoked).toBe(true);
    expect(accStart.getState().uncertaintyReason).toBe('invalid_input');
    expect(accStart.getState().physicalLowerBound).toBe(0);

    const accDelta = new NativeCumulativeUsageAccumulator(validStart);
    const res = accDelta.applyDelta({
      input_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_input_tokens: 10_000,
    });
    expect(res).toBe(false);
    expect(accDelta.getState().inputUsageValidated).toBe(false);
    expect(accDelta.getState().proofRevoked).toBe(true);
    expect(accDelta.getState().uncertaintyReason).toBe('invalid_input');
    expect(accDelta.getState().physicalLowerBound).toBe(10300);
  });

  it('requires physical anchor and preserves absent fields in raw usage (M6)', () => {
    const fresh = new NativeCumulativeUsageAccumulator();
    fresh.applyDelta({ input_tokens: 100 });
    expect(fresh.getState().physicalLowerBound).toBe(0);
    expect(fresh.getState().physicalInput).toBe(0);
    expect(fresh.getState().inputUsageValidated).toBe(false);
    expect(fresh.getRawUsage()).toEqual({ input_tokens: 100 });

    const acc = new NativeCumulativeUsageAccumulator(validStart);
    expect(acc.getState().physicalLowerBound).toBe(10300);

    acc.applyDelta({ cache_creation_input_tokens: 300 });
    expect(acc.getState().physicalLowerBound).toBe(10400);

    acc.applyDelta({ cache_creation_input_tokens: 300 });
    expect(acc.getState().physicalLowerBound).toBe(10400);

    acc.applyDelta({ input_tokens: 10000.5 });
    expect(acc.getState().physicalLowerBound).toBe(10400);

    acc.applyDelta({ cache_creation_input_tokens: 299 });
    expect(acc.getState().physicalLowerBound).toBe(10400);
  });

  it('separates inferred TTL from provider-reported evidence (M7)', () => {
    const acc = new NativeCumulativeUsageAccumulator({
      input_tokens: 100,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 200,
      output_tokens: 1,
    }, { defaultTtlEligible: true });

    expect(acc.getState().reportedCacheCreation5m).toBeUndefined();
    expect(acc.getState().reportedCacheCreation1h).toBeUndefined();
    expect(acc.getState().inferredCacheCreation1h).toBeUndefined();
    expect(acc.getRawUsage().cache_creation).toBeUndefined();

    const res = acc.applyDelta({
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
      cache_creation_input_tokens: 200,
    });
    expect(res).toBe(true);
    expect(acc.getState().reportedCacheCreation5m).toBe(0);
    expect(acc.getState().reportedCacheCreation1h).toBe(200);
    expect(acc.getRawUsage().cache_creation).toEqual({
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 200,
    });
  });
});
