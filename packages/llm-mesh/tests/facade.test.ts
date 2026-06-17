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

    await mesh.generate({ providerId: 'gemini', modelId: 'gemini-3.5-flash', messages: userMessage, auth: { type: 'environment-token', envVar: 'GEMINI_API_KEY' } });

    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'gemini', modelId: 'gemini-3.5-flash' }), expect.anything());
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

  it('fails early when the selected model does not support image input', async () => {
    const model = {
      providerId: 'cohere' as const,
      modelId: 'command-a-03-2025',
      label: 'Command A',
      reasoningTier: 'standard' as const,
      defaultTaskHints: ['chat'] as const,
      capabilities: {
        ...getProviderProfile('cohere').capabilities,
        modalities: { input: ['text'] as const, output: ['text'] as const },
      },
    };
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });

    await expect(
      mesh.generate({
        providerId: 'cohere',
        modelId: 'command-a-03-2025',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
          ],
        }],
        auth: { type: 'environment-token', envVar: 'COHERE_API_KEY' },
      }),
    ).rejects.toThrow('Image input is unsupported for cohere:command-a-03-2025');
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('passes image and file content parts through unchanged for models that support them', async () => {
    const model = {
      providerId: 'openai' as const,
      modelId: 'gpt-5.5',
      label: 'GPT-5.5',
      reasoningTier: 'advanced' as const,
      defaultTaskHints: ['chat'] as const,
      capabilities: {
        ...getProviderProfile('openai').capabilities,
        modalities: { input: ['text', 'image', 'file'] as const, output: ['text'] as const },
      },
    };
    const adapter = buildAdapter(model);
    const mesh = createLlmMesh({ registry: createProviderRegistry([adapter]) });
    const content = [
      { type: 'text' as const, text: 'Summarize these inputs' },
      { type: 'image' as const, mediaType: 'image/png', data: 'iVBORw0KGgo=' },
      { type: 'file' as const, mediaType: 'application/pdf', url: 'https://example.test/file.pdf', filename: 'file.pdf' },
    ];

    await mesh.generate({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      messages: [{ role: 'user', content }],
      auth: { type: 'environment-token', envVar: 'OPENAI_API_KEY' },
    });

    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ role: 'user', content })],
      }),
      expect.anything(),
    );
  });

  it('does not mark reasoning catalog models as unsupported', () => {
    const cohereReasoning = getModelProfile('cohere', 'command-a-reasoning-08-2025');
    const geminiFlash = getModelProfile('gemini', 'gemini-3.5-flash');
    const claudeOpus = getModelProfile('anthropic', 'claude-opus-4-7');
    const gcpFlash = getModelProfile('gcp', 'google/gemini-3.5-flash@gcp');

    expect(cohereReasoning?.reasoningTier).toBe('advanced');
    expect(cohereReasoning?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(geminiFlash?.reasoningTier).toBe('advanced');
    expect(geminiFlash?.capabilities.reasoning.support).not.toBe('unsupported');
    expect(claudeOpus?.label).toBe('Opus 4.7');
    expect(claudeOpus?.reasoningTier).toBe('advanced');
    expect(gcpFlash?.reasoningTier).toBe('advanced');
    expect(gcpFlash?.capabilities.reasoning.support).not.toBe('unsupported');
  });

  it('advertises image input only for verified vision-capable provider families', () => {
    expect(getModelProfile('openai', 'gpt-5.5')?.capabilities.modalities.input).toContain('image');
    expect(getModelProfile('gemini', 'gemini-3.5-flash')?.capabilities.modalities.input).toContain('image');
    expect(getModelProfile('anthropic', 'claude-opus-4-7')?.capabilities.modalities.input).toContain('image');
    expect(getModelProfile('gcp', 'google/gemini-3.5-flash@gcp')?.capabilities.modalities.input).toContain('image');
    expect(getModelProfile('mistral', 'mistral-small-2603')?.capabilities.modalities.input).not.toContain('image');
    expect(getModelProfile('cohere', 'command-a-03-2025')?.capabilities.modalities.input).not.toContain('image');
  });

  it('exposes Gemini-on-GCP as a distinct provider with globally-unique catalog keys', () => {
    const gcpFlash = getModelProfile('gcp', 'google/gemini-3.5-flash@gcp');
    const gcpLite = getModelProfile('gcp', 'google/gemini-3.1-flash-lite@gcp');

    expect(gcpFlash?.providerId).toBe('gcp');
    expect(gcpLite?.providerId).toBe('gcp');
    // §C global-uniqueness: the GCP selection keys MUST NOT collide with the
    // bare AI-Studio `gemini` ids, otherwise inferProviderFromModelId (api) would
    // silently mis-route them.
    expect(getModelProfile('gemini', 'google/gemini-3.5-flash@gcp')).toBeNull();
    expect(getModelProfile('gcp', 'gemini-3.5-flash')).toBeNull();
    // GCP = Gemini-on-GCP: it mirrors the `gemini` provider family + the
    // json-schema-subset structured-output capability template.
    expect(getProviderProfile('gcp').family).toBe('google');
    expect(getProviderProfile('gcp').capabilities.structuredOutput.jsonSchema.level).toBe(
      getProviderProfile('gemini').capabilities.structuredOutput.jsonSchema.level,
    );
  });

  it('keeps GCP models opt-in (no default task hints) so default routing is unchanged', () => {
    expect(getModelProfile('gcp', 'google/gemini-3.5-flash@gcp')?.defaultTaskHints).toEqual([]);
    expect(getModelProfile('gcp', 'google/gemini-3.1-flash-lite@gcp')?.defaultTaskHints).toEqual([]);
  });

  it('advertises executable account transports for OpenAI and Anthropic families', () => {
    expect(getProviderProfile('openai').capabilities.auth.accountTransports).toContain('codex');
    expect(getProviderProfile('anthropic').capabilities.auth.accountTransports).toContain('claude-code');
  });
});
