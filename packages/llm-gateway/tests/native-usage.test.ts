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
});
