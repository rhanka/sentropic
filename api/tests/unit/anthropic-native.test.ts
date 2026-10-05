import { describe, expect, it, vi } from 'vitest';
import { createAnthropicNativePort } from '../../src/services/llm-runtime/anthropic-native';
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
});
