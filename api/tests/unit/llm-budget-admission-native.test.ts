import { describe, expect, it } from 'vitest';
import { usageCost, type AttemptPricingContext, type PricedUsage, type PricingRow } from '../../src/services/llm-metering/budget-admission';
import { redactSettlementAttempt } from '../../src/services/llm-metering/route-settlement';
import type { RouteAttemptSettlement } from '@sentropic/llm-gateway';

const MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1'];
const context = (modelId = MODELS[0]!): AttemptPricingContext => ({ providerId: 'anthropic', modelId, pricingMatch: 'exact' });
const price = (modelId = MODELS[0]!): PricingRow => ({ id: 'pinned', providerId: 'anthropic', modelId,
  input: 1_000_000n, output: 2_000_000n, reasoning: 0n, image: 0n, toolCall: 0n, minCharge: 0n });
const usage = (modelId = MODELS[0]!, units = modelId === MODELS[2] ? 28_000 : 58_000): PricedUsage => ({
  inputTokens: 10_350, outputTokens: 20, nativeInputPriceUnits40: units,
  nativePricingPolicy: 'anthropic-cache-2026-10-02', nativeServedModelId: modelId,
  nativeInputUsageValidated: true, nativeInputUsageSource: 'json',
});

describe('native pinned rational pricing', () => {
  it.each(MODELS)('prices mixed cache reads/writes and output-only interrupted floors for %s', model => {
    const fable = model === MODELS[2];
    expect(usageCost(price(model), usage(model), context(model))).toBe(fable ? 740n : 1490n);
    const interrupted = { ...usage(model), outputTokens: 16, nativeInputUsageSource: 'message_start' as const,
      nativeUsageUncertainty: 'incomplete_output' as const };
    expect(usageCost(price(model), interrupted, context(model))).toBe(fable ? 732n : 1482n);
  });

  it.each(MODELS)('pins one-hour equality/growth and failed-proof amounts for %s', model => {
    const fable = model === MODELS[2];
    const repeated = { ...usage(model, fable ? 30_000 : 60_000), inputTokens: 10_300, outputTokens: 500,
      nativeInputUsageSource: 'message_delta' as const };
    expect(usageCost(price(model), repeated, context(model))).toBe(fable ? 1750n : 2500n);
    expect(usageCost(price(model), { ...repeated, outputTokens: 32_000,
      nativeUsageUncertainty: 'incomplete_output' }, context(model))).toBe(fable ? 64750n : 65500n);
    const growth = { ...repeated, inputTokens: 10_400, nativeInputPriceUnits40: fable ? 38_000 : 68_000,
      nativeCacheWriteSplitReason: 'cache_write_split_inferred' as const };
    expect(usageCost(price(model), growth, context(model))).toBe(fable ? 1950n : 2700n);
    expect(usageCost(price(model), { ...repeated, outputTokens: 32_000, nativeInputUsageValidated: false,
      nativeUsageUncertainty: 'invalid_input', nativeInputPriceUnits40: undefined }, context(model))).toBe(74300n);
  });

  it.each([
    ['wrong provider', { providerId: 'openai' }], ['wrong model', { modelId: MODELS[1] }],
    ['missing provider', { providerId: undefined }], ['missing model', { modelId: undefined }],
  ])('rejects %s pinned identity', (_name, change) => {
    expect(usageCost({ ...price(), ...change }, usage(), context())).toBe(10390n);
  });

  it('rejects absent/wrong attempt context and costliest provenance even with matching row IDs', () => {
    expect(usageCost(price(), usage())).toBe(10390n);
    for (const change of [{ providerId: 'openai' }, { modelId: MODELS[1]! }, { pricingMatch: 'costliest' as const }]) {
      expect(usageCost(price(), usage(), { ...context(), ...change })).toBe(10390n);
    }
  });

  it.each([undefined, -1, 0, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 41_399, 828_001])(
    'falls back to full physical input for invalid units %s', units => {
      expect(usageCost(price(), { ...usage(), nativeInputPriceUnits40: units }, context())).toBe(10390n);
    });

  it('checks model-specific inclusive bounds with bigint products', () => {
    for (const model of MODELS) {
      const min = model === MODELS[2] ? 1 : 4;
      const value = { ...usage(model), inputTokens: 10, outputTokens: 0 };
      expect(usageCost(price(model), { ...value, nativeInputPriceUnits40: min * 10 }, context(model))).toBe(1n);
      expect(usageCost(price(model), { ...value, nativeInputPriceUnits40: min * 10 - 1 }, context(model))).toBe(10n);
      expect(usageCost(price(model), { ...value, nativeInputPriceUnits40: 800 }, context(model))).toBe(20n);
      expect(usageCost(price(model), { ...value, nativeInputPriceUnits40: 801 }, context(model))).toBe(10n);
    }
    expect(usageCost(price(), { ...usage(), inputTokens: 0, nativeInputPriceUnits40: 1 }, context())).toBe(40n);
    expect(usageCost(price(), { ...usage(), inputTokens: Number.MAX_SAFE_INTEGER,
      nativeInputPriceUnits40: Number.MAX_SAFE_INTEGER }, context())).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 40n);
  });

  it('rejects unsupported policy, served identity, missing proof and latched uncertainty', () => {
    for (const change of [{ nativePricingPolicy: 'unknown' }, { nativeServedModelId: undefined },
      { nativeServedModelId: MODELS[1] }, { nativeInputUsageValidated: false }, { nativeInputUsageSource: undefined },
      ...['invalid_input', 'incomplete_input', 'served_model_mismatch', 'served_model_unverified',
        'input_breakdown_changed', 'missing_usage'].map(nativeUsageUncertainty => ({ nativeUsageUncertainty }))]) {
      expect(usageCost(price(), { ...usage(), ...change } as PricedUsage, context())).toBe(10390n);
    }
    expect(usageCost(price(), { ...usage(), nativeUsageUncertainty: 'invalid_output' }, context())).toBe(1490n);
  });

  it('keeps unknown-TTL premiums only at or above full-rate floors', () => {
    const uncertain = { ...usage(), nativeInputUsageValidated: false, nativeUsageUncertainty: 'cache_write_split_unknown' as const };
    expect(usageCost(price(), uncertain, context())).toBe(10390n);
    expect(usageCost(price(), { ...uncertain, nativeInputPriceUnits40: 80 * 10_350 }, context())).toBe(20740n);
  });

  it('rounds once with bigint, retains reasoning/components/minimum and canonical pricing', () => {
    const tiny = { ...usage(), inputTokens: 1, outputTokens: 0, nativeInputPriceUnits40: 4 };
    expect(usageCost({ ...price(), input: 10_000_001n }, tiny, context())).toBe(2n);
    expect(usageCost({ ...price(), input: 9_007_199_254_740_993n }, tiny, context())).toBe(900_719_926n);
    expect(usageCost({ ...price(), reasoning: 5_000_000n, image: 7n, toolCall: 11n },
      { ...usage(), imageUnits: 2, toolCalls: 3 }, context())).toBe(1597n);
    expect(usageCost({ ...price(), minCharge: 2000n }, usage(), context())).toBe(2000n);
    expect(usageCost(price(), { inputTokens: 10_350, outputTokens: 20 }, context())).toBe(10390n);
    expect(usageCost(price(), { inputTokens: 0, outputTokens: 0 }, context())).toBe(0n);
  });

  it('drops unsafe pricing detail, IDs, enum prose and arbitrary raw audit data', () => {
    const entry = { providerId: 'anthropic', modelId: MODELS[0], outcome: 'success', usage: { ...usage(),
      nativeInputPriceUnits40: NaN, nativeServedModelId: 'secret@example.com', nativePricingPolicy: 'provider prose',
      nativeUsageUncertainty: 'provider prose', nativeInputUsageSource: 'provider prose',
      nativeCacheWriteSplitReason: 'provider prose', raw: { secret: 'text' } } } as unknown as RouteAttemptSettlement;
    const result = redactSettlementAttempt(entry, 10390n, 'pinned');
    expect(result).not.toHaveProperty('nativeInputPriceUnits40');
    expect(JSON.stringify(result)).not.toMatch(/prose|secret|raw/);
  });
});
