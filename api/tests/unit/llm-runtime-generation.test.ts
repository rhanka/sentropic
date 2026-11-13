import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({ defaultProviderId: 'openai', defaultModel: 'gpt-5.4-nano' }),
  },
}));
vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({ providerId: 'openai', credential: 'synthetic', source: 'environment' }),
}));
vi.mock('../../src/services/provider-connections', () => ({
  getAnthropicTransportMode: vi.fn().mockResolvedValue('token'),
  getOpenAITransportMode: vi.fn().mockResolvedValue('token'),
  resolveConnectedClaudeCodeTransport: vi.fn().mockResolvedValue(null),
  resolveConnectedCodexTransport: vi.fn().mockResolvedValue(null),
  resolveConnectedMistralVibeTransport: vi.fn().mockResolvedValue(null),
  resolveAntigravityFallbackTransport: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/config/env', () => ({ env: {} }));
// Keep the requested model stable: legacy retirement routing is a separate contract.
vi.mock('../../src/services/model-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/model-catalog')>(),
  resolveDefaultSelection: ({ providerId, modelId }: { providerId: string; modelId: string }) =>
    ({ provider_id: providerId, model_id: modelId }),
}));
vi.mock('../../src/services/llm-runtime/mesh-dispatch', () => ({
  dispatchMeshGenerateRaw: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Session title' } }] }),
}));

import { callLLM } from '../../src/services/llm-runtime';
import { dispatchMeshGenerateRaw } from '../../src/services/llm-runtime/mesh-dispatch';
import { providerRegistry } from '../../src/services/provider-registry';

describe('OpenAI Chat Completions output limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['gpt-5.4-nano', 'max_completion_tokens'],
    ['gpt-6.1-sol', 'max_completion_tokens'],
    ['gpt-5-chat-latest', 'max_completion_tokens'],
    ['o3-mini', 'max_completion_tokens'],
    ['o1', 'max_completion_tokens'],
    ['gpt-4.1-nano', 'max_tokens'],
  ])('should send the supported token limit for %s', async (model, field) => {
    const signal = new AbortController().signal;
    await callLLM({ providerId: 'openai', model,
      messages: [{ role: 'system', content: 'Generate a session title.' }], maxOutputTokens: 32, signal });
    expect(dispatchMeshGenerateRaw).toHaveBeenCalledOnce();
    const dispatched = vi.mocked(dispatchMeshGenerateRaw).mock.calls[0][0];
    expect(dispatched.signal).toBe(signal);
    expect(dispatched.runtimeRequest).toEqual({ mode: 'chat-completions', requestOptions: {
      model, messages: [{ role: 'system', content: 'Generate a session title.' }], [field]: 32,
    } });
  });

  it('should use catalog reasoning capabilities outside recognized model families', async () => {
    const models = providerRegistry.listModels();
    const entry = models.find(model => model.modelId === 'gpt-4.1-nano')!;
    const catalog = vi.spyOn(providerRegistry, 'listModels').mockReturnValue([
      ...models.filter(model => model !== entry), { ...entry, supportsReasoning: true },
    ]);
    try {
      await callLLM({ providerId: 'openai', model: entry.modelId,
        messages: [{ role: 'system', content: 'Title' }], maxOutputTokens: 32 });
      expect(vi.mocked(dispatchMeshGenerateRaw).mock.calls[0][0].runtimeRequest.requestOptions)
        .toMatchObject({ max_completion_tokens: 32 });
      expect(vi.mocked(dispatchMeshGenerateRaw).mock.calls[0][0].runtimeRequest.requestOptions)
        .not.toHaveProperty('max_tokens');
    } finally { catalog.mockRestore(); }
  });
});
