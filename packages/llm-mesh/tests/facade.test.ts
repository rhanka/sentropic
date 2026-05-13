import { describe, expect, it, vi } from 'vitest';

import { createLlmMesh } from '../src/mesh.js';
import { createProviderRegistry, type ProviderAdapter } from '../src/registry.js';
import { getModelProfile, getProviderProfile } from '../src/catalog.js';
import type { GenerateResponse, StreamResult } from '../src/generation.js';
import type { ModelProfile } from '../src/catalog.js';
import type { StreamEvent } from '../src/streaming.js';

const userMessage = [{ role: 'user', content: 'hello' }] as const;

const buildAdapter = (model: ModelProfile, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter => ({
  provider: getProviderProfile(model.providerId),
  listModels: () => [model],
  generate: vi.fn(async () => ({
    id: 'resp_1',
    providerId: model.providerId,
    modelId: model.modelId,
    message: { role: 'assistant', content: 'ok' },
    text: 'ok',
    toolCalls: [],
    finishReason: 'stop',
  } satisfies GenerateResponse)),
  stream: vi.fn(async () => (async function* (): AsyncGenerator<StreamEvent> {
    yield { type: 'done', data: { finishReason: 'stop', responseId: 'resp_1' } };
  })() satisfies StreamResult),
  validateAuth: () => ({ ok: true }),
  normalizeError: (error) => ({ providerId: model.providerId, message: String(error), retryable: false }),
  ...overrides,
});

describe('createLlmMesh', () => {
  it('resolves qualified model ids and emits redacted hooks', async () => {
    const model = { ...getProviderProfile('openai'), providerId: 'openai' as const };
    const adapter = buildAdapter({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      label: 'GPT-5.5',
      reasoningTier: 'advanced',
      defaultTaskHints: ['chat'],
      capabilities: {
        ...model.capabilities,
        streaming: { ...model.capabilities.streaming, support: 'supported' },
      },
    });
    const onRequest = vi.fn();
    const mesh = createLlmMesh({
      registry: createProviderRegistry([adapter]),
      authResolver: async () => ({
        material: { type: 'direct-token', token: 'secret-token', label: 'OpenAI prod' },
        descriptor: { sourceType: 'direct-token', label: 'OpenAI prod' },
      }),
      hooks: { onRequest },
    });

    await mesh.generate({ model: 'openai:gpt-5.5', messages: userMessage });

    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.5' }),
      expect.objectContaining({ auth: expect.objectContaining({ descriptor: { sourceType: 'direct-token', label: 'OpenAI prod' } }) }),
    );
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      auth: { sourceType: 'direct-token', label: 'OpenAI prod' },
    }));
    expect(onRequest.mock.calls[0][0].auth.token).toBeUndefined();
  });

  it('supports explicit provider/model selection pairs', async () => {
    const model = {
      providerId: 'gemini' as const,
      modelId: 'gemini-3.1-pro-preview-customtools',
      label: 'Gemini 3.1 Pro',
      reasoningTier: 'advanced' as const,
      defaultTaskHints: ['chat'] as const,
      capabilities: {
        ...getProviderProfile('gemini').capabilities,
        streaming: { ...getProviderProfile('gemini').capabilities.streaming, support: 'supported' as const },
      },
    };
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await mesh.generate({ providerId: 'gemini', modelId: 'gemini-3.1-pro-preview-customtools', messages: userMessage, auth: { type: 'environment-token', envVar: 'GEMINI_API_KEY' } });

    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'gemini', modelId: 'gemini-3.1-pro-preview-customtools' }), expect.anything());
  });

  it('fails early when the selected model does not support requested tools', async () => {
    const model = {
      providerId: 'cohere' as const,
      modelId: 'command-a-03-2025',
      label: 'Command A',
      reasoningTier: 'none' as const,
      defaultTaskHints: ['chat'] as const,
      capabilities: {
        ...getProviderProfile('cohere').capabilities,
        tools: { ...getProviderProfile('cohere').capabilities.tools, support: 'unsupported' as const },
        streaming: { ...getProviderProfile('cohere').capabilities.streaming, support: 'supported' as const },
      },
    };
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await expect(
      mesh.generate({
        providerId: 'cohere',
        modelId: 'command-a-03-2025',
        messages: userMessage,
        auth: { type: 'environment-token', envVar: 'COHERE_API_KEY' },
        tools: [{ type: 'function', name: 'search', inputSchema: {} }],
      }),
    ).rejects.toThrow('Tool use is unsupported');
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('does not mark reasoning catalog models as unsupported', () => {
    const cohereReasoning = getModelProfile('cohere', 'command-a-reasoning-08-2025');
    const geminiPro = getModelProfile('gemini', 'gemini-3.1-pro-preview-customtools');

    expect(cohereReasoning?.reasoningTier).toBe('advanced');
    expect(cohereReasoning?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(geminiPro?.reasoningTier).toBe('advanced');
    expect(geminiPro?.capabilities.reasoning.support).not.toBe('unsupported');
  });
});
