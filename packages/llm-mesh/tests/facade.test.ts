import { describe, expect, it, vi } from 'vitest';

import { createLlmMesh } from '../src/mesh.js';
import { createProviderRegistry, type ProviderAdapter } from '../src/registry.js';
import { getModelProfile, getProviderProfile } from '../src/catalog.js';
import type { GenerateResponse, StreamResult } from '../src/generation.js';
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
} from '../src/image-generation.js';
import type { ModelProfile } from '../src/catalog.js';
import type { StreamEvent } from '../src/streaming.js';

const userMessage = [{ role: 'user', content: 'hello' }] as const;

const buildAdapter = (
  model: ModelProfile,
  overrides: Partial<ProviderAdapter> = {},
): ProviderAdapter => ({
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
  generateImage: vi.fn(async (request: ImageGenerationRequest) => ({
    id: 'img_resp_1',
    providerId: model.providerId,
    modelId: model.modelId,
    images: [{ mimeType: 'image/png' }],
  } satisfies ImageGenerationResponse)),
  validateAuth: () => ({ ok: true }),
  normalizeError: (error) => ({ providerId: model.providerId, message: String(error), retryable: false }),
  ...overrides,
});

describe('createLlmMesh', () => {
  it('resolves qualified model ids and emits redacted hooks', async () => {
    const model = getModelProfile('openai', 'gpt-5.5');
    if (!model) {
      throw new Error('Missing model profile for openai:gpt-5.5');
    }
    const adapter = buildAdapter({
      ...model,
      capabilities: {
        ...model.capabilities,
        streaming: { ...model.capabilities.streaming, support: 'supported' as const },
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
    expect(onRequest.mock.calls[0][0].auth?.token).toBeUndefined();
  });

  it('supports explicit provider/model selection pairs', async () => {
    const model = {
      providerId: 'gemini' as const,
      modelId: 'gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      reasoningTier: 'advanced' as const,
      defaultTaskHints: ['chat'] as const,
      capabilities: {
        ...getProviderProfile('gemini').capabilities,
        streaming: { ...getProviderProfile('gemini').capabilities.streaming, support: 'supported' as const },
      },
    };
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await mesh.generate({
      providerId: 'gemini',
      modelId: 'gemini-3.5-flash',
      messages: userMessage,
      auth: { type: 'environment-token', envVar: 'GEMINI_API_KEY' },
    });

    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'gemini', modelId: 'gemini-3.5-flash' }), expect.anything());
  });

  it('supports generateImage for known OpenAI image model and emits redacted image hooks', async () => {
    const model = getModelProfile('openai', 'gpt-image-2');
    if (!model) {
      throw new Error('Missing model profile for openai:gpt-image-2');
    }
    const adapter = buildAdapter(model);
    const onRequest = vi.fn();
    const mesh = createLlmMesh({
      registry: createProviderRegistry([adapter]),
      authResolver: async () => ({
        material: { type: 'direct-token', token: 'secret-token', label: 'OpenAI prod' },
        descriptor: { sourceType: 'direct-token', label: 'OpenAI prod' },
      }),
      hooks: { onRequest },
    });

    await mesh.generateImage({ model: 'openai:gpt-image-2', prompt: 'A calm dashboard' });

    expect(adapter.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-image-2' }),
      expect.anything(),
    );
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'generateImage',
      providerId: 'openai',
      modelId: 'gpt-image-2',
      auth: { sourceType: 'direct-token', label: 'OpenAI prod' },
    }));
    expect(onRequest.mock.calls[0][0].auth?.token).toBeUndefined();
  });

  it('supports generateImage for supported Gemini image model', async () => {
    const model = getModelProfile('gemini', 'gemini-3.1-flash-image-preview');
    if (!model) {
      throw new Error('Missing model profile for gemini:gemini-3.1-flash-image-preview');
    }
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({
      registry: createProviderRegistry([adapter]),
      authResolver: async () => ({
        material: { type: 'environment-token', envVar: 'GEMINI_API_KEY' },
        descriptor: { sourceType: 'environment-token', label: 'Gemini prod' },
      }),
    });

    await mesh.generateImage({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-image-preview',
      prompt: 'A calm dashboard',
    });

    expect(adapter.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'gemini', modelId: 'gemini-3.1-flash-image-preview' }),
      expect.anything(),
    );
  });

  it.each([
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    { provider: 'cohere', modelId: 'command-a-03-2025' },
  ])('fails before dispatch when image generation is unsupported for $provider', async ({ provider, modelId }) => {
    const model = getModelProfile(provider, modelId);
    if (!model) {
      throw new Error(`Missing model profile for ${provider}:${modelId}`);
    }
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await expect(
      mesh.generateImage({
        model: `${provider}:${modelId}`,
        prompt: 'x',
      }),
    ).rejects.toThrow('Image generation is unsupported');
    expect(adapter.generateImage).not.toHaveBeenCalled();
  });

  it('fails before dispatch when image generation is planned', async () => {
    const model = getModelProfile('mistral', 'mistral-large-latest');
    if (!model) {
      throw new Error('Missing model profile for mistral:mistral-large-latest');
    }
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await expect(
      mesh.generateImage({
        providerId: 'mistral',
        modelId: 'mistral-large-latest',
        prompt: 'x',
      }),
    ).rejects.toThrow('requires the Mistral Agents/Conversations adapter');
    expect(adapter.generateImage).not.toHaveBeenCalled();
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
    const geminiFlash = getModelProfile('gemini', 'gemini-3.5-flash');
    const geminiThinking = getModelProfile('gemini', 'gemini-3.5-thinking');
    const legacyGeminiFlashLite = getModelProfile('gemini', 'gemini-3.1-flash-lite-preview');
    const claudeOpus = getModelProfile('anthropic', 'claude-opus-4-7');

    expect(cohereReasoning?.reasoningTier).toBe('advanced');
    expect(cohereReasoning?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(geminiFlash?.reasoningTier).toBe('advanced');
    expect(geminiFlash?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(geminiThinking?.label).toBe('Gemini 3.5 Thinking');
    expect(geminiThinking?.reasoningTier).toBe('advanced');
    expect(geminiThinking?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(legacyGeminiFlashLite).toBeNull();
    expect(claudeOpus?.label).toBe('Opus 4.7');
    expect(claudeOpus?.reasoningTier).toBe('advanced');
  });
});
