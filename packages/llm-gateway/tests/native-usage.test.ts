import { describe, expect, it } from 'vitest';
import { NativeCumulativeUsageAccumulator, NativeUsageObserver, nativeDefaultTtlEligible } from '../src/native-usage.js';
import { CACHE_START, NATIVE_MODELS, nativeUsageTurn, observeNativeEvent } from './fixtures/native-usage.js';

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

  it('should omit null evidence and retain independent safe start fields (M6-R)', () => {
    const acc = new NativeCumulativeUsageAccumulator();
    acc.applyDelta({ input_tokens: null, cache_read_input_tokens: null,
      cache_creation_input_tokens: null, output_tokens: null });
    expect(acc.getRawUsage()).toEqual({});
    const mixed = new NativeCumulativeUsageAccumulator({ input_tokens: 1.5,
      cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 2 });
    expect(mixed.getRawUsage()).toEqual({ cache_read_input_tokens: 10,
      cache_creation_input_tokens: 0, output_tokens: 2 });
    expect(mixed.getState().physicalLowerBound).toBe(0);
  });

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('should retain safe raw fields across invalid counts %s (M6-R)', bad => {
    const acc = new NativeCumulativeUsageAccumulator({ input_tokens: bad,
      cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 2 });
    acc.applyDelta({ input_tokens: bad, cache_read_input_tokens: 20, output_tokens: 3 });
    expect(acc.getRawUsage()).toEqual({ cache_read_input_tokens: 20,
      cache_creation_input_tokens: 0, output_tokens: 3 });
    const valid = new NativeCumulativeUsageAccumulator(validStart);
    valid.applyDelta({ input_tokens: bad, cache_read_input_tokens: null, output_tokens: null });
    expect(valid.getRawUsage()).toEqual(validStart);
  });

  it('should preserve explicit raw zero and omit incomplete start categories (M6-R)', () => {
    const acc = new NativeCumulativeUsageAccumulator({ input_tokens: 0, output_tokens: 0 });
    expect(acc.getRawUsage()).toEqual({ input_tokens: 0, output_tokens: 0 });
    acc.applyDelta({ input_tokens: null, output_tokens: -1 });
    expect(acc.getRawUsage()).toEqual({ input_tokens: 0, output_tokens: 0 });
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

describe('native cache pricing and TTL evidence', () => {
  it.each(NATIVE_MODELS)('should price physical read/write categories at sourced weights for served %s', model => {
    const cases = [
      { usage: { input_tokens: 100, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, units: [44000, 14000] },
      { usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 200,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } }, units: [14000, 14000] },
      { usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 200,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } }, units: [20000, 20000] },
      { usage: { input_tokens: 100, cache_read_input_tokens: 10000, cache_creation_input_tokens: 250,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 } }, units: [58000, 28000] },
    ];
    for (const fixture of cases) {
      const observer = new NativeUsageObserver(model);
      observer.observeJson({ model, usage: { ...fixture.usage, output_tokens: 20 } });
      const snapshot = observer.snapshot('completed');
      expect(snapshot).toMatchObject({ estimated: false, nativeInputUsageValidated: true,
        nativeInputUsageSource: 'json', nativeServedModelId: model,
        nativeInputPriceUnits40: fixture.units[model === NATIVE_MODELS[2] ? 1 : 0] });
      expect(snapshot.inputTokens).toBe(fixture.usage.input_tokens
        + fixture.usage.cache_read_input_tokens + fixture.usage.cache_creation_input_tokens);
      expect(snapshot.rawUsage?.input_tokens).toBe(100);
      expect(Object.isFrozen(snapshot.rawUsage)).toBe(true);
    }
  });

  it.each([undefined, '5m', '1h', 'future', null])('should inspect actual outbound TTL %s', ttl => {
    const body = { messages: [{ content: [{ cache_control: { type: 'ephemeral', ttl } }] }] };
    expect(nativeDefaultTtlEligible(body)).toBe(ttl === undefined || ttl === '5m');
    expect(nativeDefaultTtlEligible({ messages: [] })).toBe(true);
    expect(nativeDefaultTtlEligible({ tools: [{ cache_control: { type: 'future' } }] })).toBe(false);
  });

  it('should infer default write growth without manufacturing reported TTL evidence', () => {
    const { cache_creation: _split, ...start } = CACHE_START;
    const observer = nativeUsageTurn(NATIVE_MODELS[0], start,
      { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 300, output_tokens: 500 }, true, true);
    expect(observer.snapshot('completed')).toMatchObject({ inputTokens: 10400, estimated: false,
      nativeInputPriceUnits40: 59000, nativeInputUsageValidated: true });
    expect(observer.snapshot('completed').rawUsage?.cache_creation).toBeUndefined();
    const acc = new NativeCumulativeUsageAccumulator(start, { defaultTtlEligible: true });
    acc.applyDelta({ cache_creation_input_tokens: 300 });
    expect(acc.getState().inferredCacheCreation1h).toBeUndefined();
  });

  it('should price only unknown-TTL growth at 2x and preserve the reported split', () => {
    const observer = nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, { cache_creation_input_tokens: 300, output_tokens: 500 });
    expect(observer.snapshot('completed')).toMatchObject({ inputTokens: 10400, nativeInputPriceUnits40: 68000,
      estimated: false, nativeCacheWriteSplitReason: 'cache_write_split_inferred' });
    expect(observer.snapshot('completed').rawUsage?.cache_creation?.ephemeral_1h_input_tokens).toBe(200);
    observer.accumulator.applyDelta({ cache_creation_input_tokens: 300 });
    expect(observer.snapshot('completed').inputTokens).toBe(10400);
  });

  it('should retain physical evidence but disable unknown initial split pricing', () => {
    const { cache_creation: _split, ...start } = CACHE_START;
    const snapshot = nativeUsageTurn(NATIVE_MODELS[0], start).snapshot('completed');
    expect(snapshot).toMatchObject({ inputTokens: 10300, estimated: true,
      nativeInputUsageValidated: false, nativeUsageUncertainty: 'cache_write_split_unknown' });
    expect(snapshot.nativeInputPriceUnits40).toBeUndefined();
  });
});

describe('native proof and output provenance', () => {
  it.each([undefined, null, []])('should treat empty iterations %j as absent in JSON and SSE', iterations => {
    const json = new NativeUsageObserver(NATIVE_MODELS[0]);
    json.observeJson({ model: NATIVE_MODELS[0], usage: { ...CACHE_START, output_tokens: 500, iterations } });
    const stream = nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, { output_tokens: 500, iterations });
    for (const observer of [json, stream]) expect(observer.snapshot('completed')).toMatchObject({
      iterationsPresent: false, nativeInputUsageValidated: true, estimated: false, finalOutputObserved: true });
  });

  it.each([[{ input_tokens: 999999 }], {}, 'opaque', 1, false])('should latch substantive iterations %j without folding arrays', iterations => {
    const observer = nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, { output_tokens: 500, iterations });
    observeNativeEvent(observer, 'message_delta', { usage: { output_tokens: 500, iterations: [] } });
    const snapshot = observer.snapshot('completed');
    expect(snapshot).toMatchObject({ inputTokens: 10300, outputTokens: 500, iterationsPresent: true,
      nativeInputUsageValidated: false, estimated: true, nativeUsageUncertainty: 'served_model_mismatch' });
    expect(snapshot.nativeInputPriceUnits40).toBeUndefined();
    expect(snapshot.rawUsage).not.toHaveProperty('iterations');
    const json = new NativeUsageObserver(NATIVE_MODELS[0]);
    json.observeJson({ model: NATIVE_MODELS[0], usage: { ...CACHE_START, iterations } });
    expect(json.snapshot('completed').iterationsPresent).toBe(true);
  });

  it.each([[NATIVE_MODELS[0], NATIVE_MODELS[2]], [NATIVE_MODELS[2], NATIVE_MODELS[1]]])('should disable selected %s discounts for served %s', (selected, served) => {
    const json = new NativeUsageObserver(selected);
    json.observeJson({ model: served, usage: { ...CACHE_START, output_tokens: 500 } });
    expect(json.snapshot('completed')).toMatchObject({ nativeServedModelId: served,
      nativeInputUsageValidated: false, estimated: true, nativeUsageUncertainty: 'served_model_mismatch' });
    expect(json.snapshot('completed').nativeInputPriceUnits40).toBeUndefined();
    const stream = nativeUsageTurn(selected);
    observeNativeEvent(stream, 'message_start', { message: { model: served, usage: CACHE_START } });
    observeNativeEvent(stream, 'message_delta', { usage: { input_tokens: 500, output_tokens: 600 } });
    expect(stream.snapshot('completed')).toMatchObject({ inputTokens: 10300, outputTokens: 600,
      nativeInputUsageValidated: false, nativeUsageUncertainty: 'served_model_mismatch' });
  });

  it('should latch fallback blocks and missing or malformed served identity', () => {
    const stream = nativeUsageTurn();
    observeNativeEvent(stream, 'content_block_start', { content_block: { type: 'fallback', fallback_credit_token: 'private' } });
    expect(stream.snapshot('completed')).toMatchObject({ fallbackPresent: true, estimated: true,
      nativeInputUsageValidated: false, nativeUsageUncertainty: 'served_model_mismatch' });
    expect(JSON.stringify(stream.snapshot('completed'))).not.toContain('private');
    for (const model of [undefined, '', 'invalid model', 'x'.repeat(129)]) {
      const json = new NativeUsageObserver(NATIVE_MODELS[0]);
      json.observeJson({ model, usage: CACHE_START, content: [] });
      expect(json.snapshot('completed')).toMatchObject({ nativeInputUsageValidated: false,
        nativeUsageUncertainty: 'served_model_unverified' });
    }
  });

  it.each(['cancelled', 'upstream_error', 'commit_failed', 'missing_message_stop', 'frame_overflow', 'timeout', 'reader_error'] as const)(
    'should preserve valid input while output remains nonfinal after %s', termination => {
      const observer = nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, { input_tokens: 100, output_tokens: 500 });
      expect(observer.snapshot(termination)).toMatchObject({ inputTokens: 10300, outputTokens: 500,
        nativeInputUsageValidated: true, nativeInputUsageSource: 'message_delta',
        nativeInputPriceUnits40: 60000, estimated: true, finalOutputObserved: false });
      expect(nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, {}, true).snapshot('completed')).toMatchObject({
        nativeInputUsageValidated: true, outputTokens: 1, estimated: true, finalOutputObserved: false });
    });

  it('should latch finite decreases separately from malformed input and advance only safe lower bounds', () => {
    const observer = nativeUsageTurn(NATIVE_MODELS[0], CACHE_START, { input_tokens: 10000.5, output_tokens: 500 });
    expect(observer.accumulator.getState().messageDeltaInputDecreased).toBe(false);
    observeNativeEvent(observer, 'message_delta', { usage: { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 300 } });
    observeNativeEvent(observer, 'message_delta', { usage: { cache_creation_input_tokens: 300 } });
    expect(observer.snapshot('completed')).toMatchObject({ inputTokens: 10400, nativeInputUsageValidated: false,
      nativeUsageUncertainty: 'invalid_input', estimated: true });
    expect(observer.snapshot('completed').nativeInputPriceUnits40).toBeUndefined();
    observeNativeEvent(observer, 'message_delta', { usage: { cache_creation_input_tokens: 299 } });
    expect(observer.accumulator.getState()).toMatchObject({ physicalLowerBound: 10400, messageDeltaInputDecreased: true });
    const valid = nativeUsageTurn();
    observeNativeEvent(valid, 'message_delta', { usage: { input_tokens: null, cache_creation_input_tokens: null } });
    expect(valid.accumulator.getState().messageDeltaInputDecreased).toBe(false);
    observeNativeEvent(valid, 'message_delta', { usage: { input_tokens: 0 } });
    expect(valid.accumulator.getState().messageDeltaInputDecreased).toBe(true);
  });
});
