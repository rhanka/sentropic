import { describe, expect, it, vi } from 'vitest';
import { createAnthropicNativePort } from '../../src/services/llm-runtime/anthropic-native';

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
