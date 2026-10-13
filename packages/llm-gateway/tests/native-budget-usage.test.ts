import { describe, expect, it } from 'vitest';
import { chargeAdmittedAttempts, type AdmittedRoute } from '../src/admission.js';
import { nativeSnapshotUsage, NativeUsageObserver } from '../src/native-usage.js';
import { aggregateUsage, attemptUsage } from '../src/route-flow-core.js';
import type { SettleUsage } from '../src/flow.js';
import { fixtureQuote } from './fixtures/budget.js';
import { CACHE_START, NATIVE_MODELS, nativeUsageTurn, observeNativeEvent } from './fixtures/native-usage.js';

const admission = (model: string, inputTokens = 10300): AdmittedRoute => ({
  requestId: 'req-native', holdRef: 'hold-native', dispatched: new Set(['candidate-native']),
  quote: fixtureQuote({ requestedModel: model, maxAttempts: 1, candidates: [{
    providerId: 'anthropic', modelId: model, reason: 'exact', outputCeilingEnforced: true,
    allowance: { inputTokens, outputTokens: 32000 },
  }] }),
});
const attempt = (model: string, usage: SettleUsage) => ({ candidateRef: 'candidate-native',
  providerId: 'anthropic', modelId: model, transportProviderId: 'native', outcome: 'success' as const, usage });
const charge = (model: string, usage: SettleUsage, inputAllowance = 10300) =>
  chargeAdmittedAttempts(admission(model, inputAllowance), [attempt(model, usage)]).attempts[0]!.usage;
// Pinned synthetic rates: input 1,000,000 and output 2,000,000 micro-USD/MTok.
const pinnedCost = (usage: SettleUsage): bigint => {
  const units = usage.nativeInputPriceUnits40 === undefined ? 40n * BigInt(usage.inputTokens)
    : BigInt(usage.nativeInputPriceUnits40);
  return (units * 1000000n + 39999999n) / 40000000n + 2n * BigInt(usage.outputTokens);
};

describe('native admitted settlement', () => {
  it.each(NATIVE_MODELS)('should pin measured and interrupted one-hour amounts for %s', model => {
    const fable = model === NATIVE_MODELS[2];
    const equal = { input_tokens: 100, cache_read_input_tokens: 10000, cache_creation_input_tokens: 200, output_tokens: 500 };
    const cases = [
      { delta: equal, termination: 'completed' as const, expected: fable ? 1750n : 2500n, output: 500 },
      { delta: equal, termination: 'cancelled' as const, expected: fable ? 64750n : 65500n, output: 32000 },
      { delta: { cache_creation_input_tokens: 300, output_tokens: 500 }, termination: 'completed' as const,
        expected: fable ? 1950n : 2700n, output: 500 },
      { delta: { cache_creation_input_tokens: 300, output_tokens: 500 }, termination: 'cancelled' as const,
        expected: fable ? 64950n : 65700n, output: 32000 },
      { delta: { input_tokens: 10000.5, output_tokens: 500 }, termination: 'completed' as const, expected: 74300n, output: 32000 },
      { delta: { input_tokens: 10000.5, output_tokens: 500 }, termination: 'cancelled' as const, expected: 74300n, output: 32000 },
    ];
    for (const fixture of cases) {
      const snapshot = nativeUsageTurn(model, CACHE_START, fixture.delta).snapshot(fixture.termination);
      const observed = nativeSnapshotUsage(snapshot), charged = charge(model, observed);
      expect(pinnedCost(charged)).toBe(fixture.expected);
      expect(charged.outputTokens).toBe(fixture.output);
      expect(snapshot.outputTokens).toBe(500);
      expect(snapshot.rawUsage?.output_tokens).toBe(500);
      if (snapshot.nativeInputUsageValidated && fixture.termination === 'completed') {
        expect(charged).toBe(observed);
        expect(charged.estimated).toBe(false);
        expect(snapshot.estimated).toBe(false);
        expect(snapshot.finalOutputObserved).toBe(true);
        expect(snapshot.nativeUsageUncertainty).toBeUndefined();
        expect(charged.outputTokens).toBe(snapshot.outputTokens); // N4: no successful allowance floor.
      } else expect(charged.estimated).toBe(true);
    }
  });

  it.each(NATIVE_MODELS)('should pin official V-1 clean/interrupted amounts for %s', model => {
    const start = { input_tokens: 2679, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 };
    const delta = { input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      output_tokens: 510, server_tool_use: { web_search_requests: 1 } };
    for (const termination of ['completed', 'cancelled'] as const) {
      const snapshot = nativeUsageTurn(model, start, delta).snapshot(termination);
      const charged = charge(model, nativeSnapshotUsage(snapshot), 20000);
      expect(pinnedCost(charged)).toBe(termination === 'completed' ? 11702n : 74682n);
      expect(snapshot).toMatchObject({ inputTokens: 10682, outputTokens: 510, totalTokens: 11192 });
      expect(charged.inputTokens).toBe(10682);
      expect(charged.outputTokens).toBe(termination === 'completed' ? 510 : 32000);
      expect(charged.estimated).toBe(termination !== 'completed');
    }
  });

  it('should preserve physical-only aggregate usage and start-only input proof', () => {
    const observer = nativeUsageTurn(NATIVE_MODELS[0], { input_tokens: 2, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0, output_tokens: 1 }, {}, false);
    const usage = nativeSnapshotUsage(observer.snapshot('cancelled'));
    const charged = charge(NATIVE_MODELS[0], usage, 100);
    expect(charged).toMatchObject({ inputTokens: 2, outputTokens: 32000, estimated: true });
    expect(attemptUsage(charged)).toBe(charged);
    expect(aggregateUsage([attempt(NATIVE_MODELS[0], charged)])).toEqual({ inputTokens: 2, outputTokens: 32000, estimated: true });
    const hold = admission(NATIVE_MODELS[0]); hold.dispatched.clear();
    expect(chargeAdmittedAttempts(hold, [attempt(NATIVE_MODELS[0], usage)]).attempts[0]!.usage).toBe(usage);
  });

  it('should floor both counts and drop discounts for missing, invalid, mismatched or latched proof', () => {
    const observed = nativeSnapshotUsage(nativeUsageTurn().snapshot('cancelled'));
    const invalid: Partial<SettleUsage>[] = [ { nativeInputUsageValidated: false }, { nativeInputUsageSource: undefined },
      { nativeInputUsageSource: 'json' }, { nativeServedModelId: NATIVE_MODELS[2] }, { nativePricingPolicy: undefined },
      { nativeInputPriceUnits40: 0 }, { nativeInputPriceUnits40: 10300 * 80 + 1 }, { nativeInputPriceUnits40: 1.5 },
      { nativeUsageUncertainty: 'invalid_input' }, { nativeUsageUncertainty: 'input_breakdown_changed' } ];
    for (const fields of invalid) {
      const charged = charge(NATIVE_MODELS[0], { ...observed, ...fields }, 20000);
      expect(charged).toMatchObject({ inputTokens: 20000, outputTokens: 32000, estimated: true });
      expect(charged.nativeInputPriceUnits40).toBeUndefined();
    }
    const latched = nativeUsageTurn();
    observeNativeEvent(latched, 'message_delta', { usage: { output_tokens: 500, iterations: [{}] } });
    expect(pinnedCost(charge(NATIVE_MODELS[0], nativeSnapshotUsage(latched.snapshot('completed'))))).toBe(74300n);
  });

  it('should retain conservative same-model unknown-TTL premiums above the full-rate input floor', () => {
    const observer = new NativeUsageObserver(NATIVE_MODELS[0]);
    observer.observeJson({ model: NATIVE_MODELS[0], usage: { input_tokens: 100, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 10000, output_tokens: 500 } });
    const charged = charge(NATIVE_MODELS[0], nativeSnapshotUsage(observer.snapshot('completed')));
    expect(charged).toMatchObject({ inputTokens: 10300, outputTokens: 32000, estimated: true,
      nativeInputUsageValidated: false, nativeInputPriceUnits40: 804000 });
    expect(pinnedCost(charged)).toBe(84100n);
  });
});
