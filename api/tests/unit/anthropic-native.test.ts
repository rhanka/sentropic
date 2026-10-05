import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicNativePort, resolveAnthropicNativeAuth } from '../../src/services/llm-runtime/anthropic-native';
import { nativeObservationUsage } from '../../src/services/llm-runtime/anthropic-native-observation';
import type { NativeUsageSnapshot } from '@sentropic/llm-mesh';
import { NativeUsageObserver, runRouteJsonFlow, runRouteStreamFlow } from '@sentropic/llm-gateway';
import { nativeFrame, nativeHarness, nativeStart } from '../../../packages/llm-gateway/tests/fixtures/native-flow';

const MODEL = 'claude-sonnet-5';
const subject = { principalRef: 'native-user', ownerScopeRef: 'native-owner' };
const target = { providerId: 'anthropic', modelId: MODEL };
const request = () => ({ body: { model: MODEL, messages: [] }, stream: false, requestId: 'gateway-request',
  signal: new AbortController().signal, headers: { anthropicVersion: '2023-06-01', forwarded: {} } });
const fixture = () => {
  const runtime = { nativeMessages: vi.fn().mockResolvedValue({ kind: 'json', status: 200, body: {}, headers: {} }),
    nativeCountTokens: vi.fn().mockResolvedValue({ kind: 'json', status: 200, body: { input_tokens: 1 }, headers: {} }) };
  const resolveProviderCredential = vi.fn().mockResolvedValue({ providerId: 'anthropic', credential: 'server-key', source: 'environment' });
  const port = createAnthropicNativePort({ modelIds: [MODEL], runtime, dependencies: { resolveProviderCredential } });
  return { port, runtime, resolveProviderCredential };
};
const accountFixture = () => {
  const recordOutcome = vi.fn().mockResolvedValue(undefined);
  const dependencies = {
    resolveProviderCredential: vi.fn().mockResolvedValue({ providerId: 'anthropic', credential: null, source: 'none' }),
    getAnthropicTransportMode: vi.fn().mockResolvedValue('claude-code'),
    getPrimaryClaudeCodeAccountTransport: vi.fn().mockResolvedValue({ status: 'active' }),
    resolveConnectedClaudeCodeTransport: vi.fn().mockResolvedValue({ accessToken: 'leased-bearer', recordOutcome }),
  };
  return { dependencies, recordOutcome };
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** Actual gateway flows bind the prepared API capability; only provider responses are faked. */
const hostHarness = async (options: { model?: string; chunks?: Uint8Array[]; body?: Record<string, unknown>;
  hook?: 'reject' | 'never'; requestBody?: Record<string, unknown>; allowanceInput?: number } = {}) => {
  const model = options.model ?? MODEL;
  const { dependencies, recordOutcome } = accountFixture();
  const record = vi.fn(async () => {
    if (options.hook === 'reject') throw new Error('private observation failure');
    if (options.hook === 'never') await new Promise<void>(() => {});
  });
  const chunks = options.chunks ?? [nativeStart(model), nativeFrame('message_delta', { usage: { output_tokens: 3 } }),
    nativeFrame('message_stop')];
  let index = 0;
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const runtime = { nativeMessages: vi.fn(async payload => {
    payload.onResponseStarted();
    return payload.stream ? { kind: 'stream' as const, status: 200 as const, headers: {},
      body: { [Symbol.asyncIterator]: () => ({ next: async () => index < chunks.length
        ? { done: false as const, value: chunks[index++]! } : { done: true as const, value: undefined }, return: close }) } }
      : { kind: 'json' as const, status: 200 as const, headers: {}, body: options.body ?? { model,
        usage: { input_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3 } } };
  }), nativeCountTokens: vi.fn() };
  const port = createAnthropicNativePort({ modelIds: [model], dependencies, runtime, record });
  const capability = await port.prepare(subject, 'workspace', { providerId: 'anthropic', modelId: model });
  const finalize = vi.fn(capability!.finalize!);
  const h = nativeHarness({ model, body: options.requestBody, allowanceInput: options.allowanceInput });
  h.attempt.nativeMessages = { ...capability!, finalize };
  return { ...h, record, recordOutcome, close, finalize, runtime, dependencies };
};
const consume = async (stream: AsyncIterable<unknown>) => { for await (const _chunk of stream) { /* Drain opaque bytes. */ } };

describe('Anthropic native host port', () => {
  it('observes only the gateway finalized snapshot once with a separate joined call identity', async () => {
    const { runtime, resolveProviderCredential } = fixture();
    const record = vi.fn().mockResolvedValue(undefined);
    runtime.nativeMessages.mockImplementation(async payload => {
      payload.onResponseStarted();
      return { kind: 'json', status: 200, body: {}, headers: {} };
    });
    const port = createAnthropicNativePort({ modelIds: [MODEL], runtime, record, dependencies: { resolveProviderCredential } });
    const native = await port.prepare(subject, 'workspace', target);
    await native!.execute(request());
    expect(record).not.toHaveBeenCalled();
    const snapshot: NativeUsageSnapshot = Object.freeze({ inputTokens: 10_300, outputTokens: 20, totalTokens: 10_320,
      rawUsage: Object.freeze({ input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200 }),
      estimated: false, finalOutputObserved: true, termination: 'completed', nativeSelectedModelId: MODEL,
      nativeServedModelId: MODEL, nativeInputUsageValidated: true, nativeInputUsageSource: 'json',
      fallbackPresent: false, iterationsPresent: false });
    await native!.finalize!(snapshot);
    await native!.finalize!(snapshot);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ responseId: 'gateway-request', providerId: 'anthropic', modelId: MODEL,
      userId: 'native-user', workspaceId: 'workspace', credentialSource: 'environment', operation: 'generate',
      usage: { inputTokens: 10_300, outputTokens: 20, providerRawUsage: { input_tokens: 100, input_usage_validated: true } } });
    expect(record.mock.calls[0]![0].callId).not.toBe('gateway-request');
  });

  it('prepares exact native and count capabilities without account acquisition or caller credentials', async () => {
    const { port, runtime, resolveProviderCredential } = fixture();
    const native = await port.prepare(subject, 'workspace', target);
    expect(native).toMatchObject({ contractVersion: 1, modelId: MODEL, requiredBetas: [], apiVersions: ['2023-06-01'] });
    await native!.execute(request());
    const count = await port.countTokens.prepare(subject, { modelId: MODEL, workspaceId: 'workspace', signal: request().signal });
    await count!.execute(request());
    expect(runtime.nativeMessages).toHaveBeenCalledTimes(1);
    expect(runtime.nativeCountTokens).toHaveBeenCalledTimes(1);
    expect(runtime.nativeMessages.mock.calls[0]![0].credential).toBe('server-key');
    expect(resolveProviderCredential.mock.calls[0]![0]).toEqual({ providerId: 'anthropic', userId: 'native-user', workspaceId: 'workspace' });
  });

  it('denies a different provider before credential resolution and rejects invalid allowlists', async () => {
    const { port, resolveProviderCredential } = fixture();
    expect(await port.prepare(subject, undefined, { ...target, providerId: 'openai' })).toBeUndefined();
    expect(resolveProviderCredential).not.toHaveBeenCalled();
    expect(() => createAnthropicNativePort({ modelIds: ['not-a-catalog-model'] })).toThrow();
  });

  it.each(['environment', 'user_byok', 'workspace_key'] as const)('uses trusted %s before account transport', async source => {
    const { dependencies } = accountFixture();
    dependencies.resolveProviderCredential.mockResolvedValue({ providerId: 'anthropic', credential: 'trusted-key', source });
    expect(await resolveAnthropicNativeAuth('u', 'w', dependencies)).toEqual({ kind: 'token', credential: 'trusted-key', source });
    expect(dependencies.resolveProviderCredential).toHaveBeenCalledWith({ providerId: 'anthropic', userId: 'u', workspaceId: 'w' });
    expect(dependencies.getAnthropicTransportMode).not.toHaveBeenCalled();
    expect(dependencies.resolveConnectedClaudeCodeTransport).not.toHaveBeenCalled();
  });

  it.each(['active', 'cooldown', 'disabled'] as const)('advertises only eligible account status %s without acquiring', async status => {
    const { dependencies } = accountFixture();
    dependencies.getPrimaryClaudeCodeAccountTransport.mockResolvedValue({ status });
    const port = createAnthropicNativePort({ modelIds: [MODEL], dependencies });
    expect(await port.available(subject, 'workspace', target)).toBe(status !== 'disabled');
    expect(dependencies.resolveConnectedClaudeCodeTransport).not.toHaveBeenCalled();
    dependencies.getAnthropicTransportMode.mockResolvedValue('antigravity');
    expect(await port.available(subject, 'workspace', target)).toBe(false);
  });

  it.each([false, true])('acquires only at execute and releases JSON/count exactly once (count=%s)', async count => {
    const { dependencies, recordOutcome } = accountFixture();
    const { runtime } = fixture();
    const record = vi.fn();
    const port = createAnthropicNativePort({ modelIds: [MODEL], dependencies, runtime, record });
    const capability = count ? await port.countTokens.prepare(subject, { modelId: MODEL, signal: request().signal })
      : await port.prepare(subject, 'workspace', target);
    expect(dependencies.resolveConnectedClaudeCodeTransport).not.toHaveBeenCalled();
    await capability!.execute({ ...request(), body: { model: MODEL, credential: 'caller-key', accessToken: 'caller-bearer' } });
    expect(dependencies.resolveConnectedClaudeCodeTransport).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledExactlyOnceWith({ status: 'success' });
    const called = count ? runtime.nativeCountTokens : runtime.nativeMessages;
    expect(called.mock.calls[0]![0]).toMatchObject({ claudeCodeTransport: { accessToken: 'leased-bearer' } });
    expect(called.mock.calls[0]![0].credential).toBeUndefined();
    if (!count) await (capability as Awaited<ReturnType<typeof port.prepare>>)!.finalize!({} as NativeUsageSnapshot);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([false, true])('null lease returns zero operational usage without dispatch/observation (count=%s)', async count => {
    const { dependencies } = accountFixture();
    dependencies.resolveConnectedClaudeCodeTransport.mockResolvedValue(null);
    const { runtime } = fixture(); const record = vi.fn();
    const port = createAnthropicNativePort({ modelIds: [MODEL], dependencies, runtime, record });
    const capability = count ? await port.countTokens.prepare(subject, { modelId: MODEL, signal: request().signal })
      : await port.prepare(subject, undefined, target);
    await expect(capability!.execute(request())).rejects.toMatchObject({ status: 503, code: 'account_unavailable',
      usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
    expect(runtime.nativeMessages).not.toHaveBeenCalled(); expect(runtime.nativeCountTokens).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('releases an unconsumed response on abort once even when reader/outcome cleanup rejects', async () => {
    const { dependencies, recordOutcome } = accountFixture();
    recordOutcome.mockRejectedValue(new Error('private failure'));
    const close = vi.fn().mockRejectedValue(new Error('reader failure'));
    const runtime = { nativeMessages: vi.fn().mockResolvedValue({ kind: 'stream', status: 200, headers: {},
      body: { [Symbol.asyncIterator]: () => ({ next: vi.fn(), return: close }) } }), nativeCountTokens: vi.fn() };
    const port = createAnthropicNativePort({ modelIds: [MODEL], dependencies, runtime });
    const controller = new AbortController(); const capability = await port.prepare(subject, undefined, target);
    const result = await capability!.execute({ ...request(), stream: true, signal: controller.signal });
    controller.abort();
    if (result.kind !== 'stream') throw new Error('expected stream');
    await result.body[Symbol.asyncIterator]().return!();
    expect(close).toHaveBeenCalledTimes(1); expect(recordOutcome).toHaveBeenCalledExactlyOnceWith({ status: 'failed' });
  });

  it('projects only safe physical/raw counts and fixed snapshot fields, never allowances or opaque objects', () => {
    const snapshot = { inputTokens: 10_300, outputTokens: 500, totalTokens: 10_800, estimated: true,
      finalOutputObserved: false, termination: 'cancelled', nativeSelectedModelId: MODEL,
      nativeServedModelId: 'private@example.com', nativeUsageUncertainty: 'invalid_input', nativeInputUsageValidated: false,
      fallbackPresent: false, iterationsPresent: true, secret: 'prompt', rawUsage: { input_tokens: 100,
        cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200, output_tokens: 500,
        iterations: ['private-token'], extra: 'provider prose', cache_creation: { ephemeral_1h_input_tokens: 200 } } } as NativeUsageSnapshot;
    const projected = nativeObservationUsage(snapshot);
    expect(projected).toMatchObject({ inputTokens: 10_300, outputTokens: 500, totalTokens: 10_800,
      providerRawUsage: { native_served_model_id: 'unknown', uncertainty_reason: 'invalid_input', input_usage_validated: false } });
    expect(JSON.stringify(projected)).not.toMatch(/prompt|private|prose|32000/);
    expect(nativeObservationUsage({ ...snapshot, inputTokens: NaN, outputTokens: undefined, totalTokens: Infinity }))
      .toMatchObject({ inputTokens: undefined, outputTokens: undefined, totalTokens: undefined });
  });
});

describe('gateway to API finalized observation parity', () => {
  it.each(['clean', 'cancel', 'commit', 'eof'] as const)('settles and releases before a never-settling hook: %s', async cause => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshotSpy = vi.spyOn(NativeUsageObserver.prototype, 'snapshot');
    const h = await hostHarness({ hook: 'never', ...(cause === 'eof' ? { chunks: [nativeStart(MODEL)] } : {}) });
    if (cause === 'commit') h.attempt.markCommitted.mockRejectedValue(new Error('private commitment failure'));
    if (cause === 'commit') await expect(runRouteStreamFlow(h.deps, { ...h.request, stream: true })).rejects.toThrow();
    else {
      const result = await runRouteStreamFlow(h.deps, { ...h.request, stream: true });
      if (cause === 'cancel') await result.stream.return(undefined);
      else await consume(result.stream);
      await result.stream.return(undefined);
    }
    const snapshot = h.finalize.mock.calls[0]![0];
    expect(snapshotSpy).toHaveBeenCalledTimes(1); expect(snapshotSpy.mock.results[0]!.value).toBe(snapshot);
    expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.record).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.rawUsage)).toBe(true);
    expect(snapshot).toMatchObject({ inputTokens: 2, outputTokens: cause === 'clean' ? 3 : 1,
      nativeInputUsageValidated: true, nativeInputUsageSource: 'message_start', // Output-only delta keeps input provenance.
      estimated: cause !== 'clean', finalOutputObserved: cause === 'clean',
      termination: { clean: 'completed', cancel: 'cancelled', commit: 'commit_failed', eof: 'missing_message_stop' }[cause] });
    expect(h.recorder.settlements).toHaveLength(1); expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.recordOutcome).toHaveBeenCalledTimes(1);
    const financial = h.recorder.settlements[0]!.attempts[0]!.usage;
    expect(financial).toMatchObject({ inputTokens: 2, outputTokens: cause === 'clean' ? 3 : 32_000,
      nativeInputPriceUnits40: snapshot.nativeInputPriceUnits40, nativeUsageUncertainty: snapshot.nativeUsageUncertainty,
      nativeInputUsageSource: snapshot.nativeInputUsageSource, estimated: snapshot.estimated });
    expect(h.record.mock.calls[0]![0]).toMatchObject({ responseId: 'req-native',
      usage: { inputTokens: 2, outputTokens: snapshot.outputTokens, totalTokens: snapshot.totalTokens,
        providerRawUsage: { estimated: snapshot.estimated, termination: snapshot.termination,
          final_output_observed: snapshot.finalOutputObserved, input_usage_source: snapshot.nativeInputUsageSource } } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledExactlyOnceWith('Native observation unavailable', {
      requestId: 'req-native', attemptRef: 'attempt', reason: 'hook_timeout' });
    expect(h.recorder.settlements).toHaveLength(1); expect(h.recordOutcome).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 'reject', 'never'] as const)('completes JSON independently of host persistence (%s)', async hook => {
    vi.useFakeTimers(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshotSpy = vi.spyOn(NativeUsageObserver.prototype, 'snapshot');
    const h = await hostHarness({ hook });
    expect(await runRouteJsonFlow(h.deps, h.request)).toMatchObject({ status: 200, relay: 'native' });
    const snapshot = h.finalize.mock.calls[0]![0];
    expect(snapshotSpy).toHaveBeenCalledTimes(1); expect(snapshotSpy.mock.results[0]!.value).toBe(snapshot);
    expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.recordOutcome).toHaveBeenCalledExactlyOnceWith({ status: 'success' });
    expect(h.recorder.settlements).toHaveLength(1);
    expect(h.record.mock.calls[0]![0]).toMatchObject({ usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5,
      providerRawUsage: { input_usage_source: 'json', termination: 'completed', final_output_observed: true } } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.finalize).toHaveBeenCalledTimes(1); expect(h.recorder.settlements).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(warn).toHaveBeenCalledTimes(hook ? 1 : 0);
  });
});
