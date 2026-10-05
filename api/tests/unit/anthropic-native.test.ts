import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicNativePort, resolveAnthropicNativeAuth } from '../../src/services/llm-runtime/anthropic-native';
import { nativeObservationUsage } from '../../src/services/llm-runtime/anthropic-native-observation';
import type { NativeUsageSnapshot } from '@sentropic/llm-mesh';

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
