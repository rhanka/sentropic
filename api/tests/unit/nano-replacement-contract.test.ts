import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({ defaultProviderId: 'openai', defaultModel: 'gpt-4.1-nano' }),
  },
}));
vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'openai', credential: 'offline-test-key', source: 'environment',
  }),
}));

import { callLLM, callLLMStream, resolveRuntimeSelection } from '../../src/services/llm-runtime';
import { providerRegistry } from '../../src/services/provider-registry';
import { getDefaultOpenAIModel } from '../../src/config/models';
import { normalizeLegacyModelSelection } from '../../src/services/model-selection-legacy';
import { validateOpenAIRequestBudget } from '../../src/services/llm-runtime/openai-budget';

const candidates = ['gpt-6-luna', 'gpt-5.6-luna'];
const messages = [{ role: 'user' as const, content: 'Return a short title.' }];
const runtime = providerRegistry.requireProvider('openai');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('nano replacement through the product mesh boundary', () => {
  it('should exclude retired nano from selectable provider models', () => {
    expect(providerRegistry.listModels().some((entry) => entry.modelId.startsWith('gpt-4.1-nano'))).toBe(false);
  });

  it.each(['', ' gpt-4.1-nano ', 'GPT-4.1-NANO-2025-04-14'])(
    'should repair stale configuration %s', (configured) => {
      expect(getDefaultOpenAIModel(configured)).toBe('gpt-6-luna');
    },
  );

  it('should select candidate B for helpers and legacy cutovers from the same configuration', () => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.6-luna');
    expect(getDefaultOpenAIModel()).toBe('gpt-5.6-luna');
    expect(normalizeLegacyModelSelection({ modelId: 'gpt-4.1-nano' }).modelId).toBe('gpt-5.6-luna');
    expect(normalizeLegacyModelSelection({ modelId: 'gpt-5.5' }).modelId).toBe('gpt-5.6-luna');
  });

  it('should resolve a saved retired default to candidate A', async () => {
    expect(await resolveRuntimeSelection({})).toEqual({ providerId: 'openai', model: 'gpt-6-luna' });
  });

  it.each(candidates)('should bound synchronous %s output with reasoning disabled', async (model) => {
    const generate = vi.spyOn(runtime, 'generate').mockResolvedValue({
      id: 'offline-title', model, choices: [{ message: { role: 'assistant', content: 'Project launch' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
    const result = await callLLM({ model, messages, reasoningEffort: 'none', maxOutputTokens: 32 });
    expect(result.choices[0]?.message.content).toBe('Project launch');
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      mode: 'chat-completions',
      requestOptions: { model, reasoning_effort: 'none', max_completion_tokens: 32 },
    });
    expect((generate.mock.calls[0]?.[0] as { requestOptions: object }).requestOptions).not.toHaveProperty('max_tokens');
  });

  it.each(candidates)('should bound streaming %s effort evaluation with reasoning disabled', async (model) => {
    const stream = vi.spyOn(runtime, 'streamGenerate').mockResolvedValue((async function* () {
      yield { type: 'response.output_text.delta', delta: 'low' };
      yield { type: 'response.completed', response: { id: 'offline-effort', model,
        usage: { input_tokens: 10, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 } } } };
    })());
    const events = [];
    for await (const event of callLLMStream({ model, messages, reasoningEffort: 'none', maxOutputTokens: 64 })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === 'content_delta')).toBe(true);
    expect(stream).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      mode: 'responses', requestOptions: { model, reasoning: { effort: 'none' }, max_output_tokens: 64 },
    });
  });

  it('should keep the Luna output ceiling scoped to Luna candidates', () => {
    expect(() => validateOpenAIRequestBudget('gpt-5.6', {}, 128_001)).not.toThrow();
    expect(() => validateOpenAIRequestBudget('gpt-5.6-luna', {}, 128_001)).toThrow(/output.*budget/i);
  });

  it.each([0, -1, NaN, Infinity, 128_001])('should refuse an invalid output ceiling %s before dispatch', async (maxOutputTokens) => {
    const generate = vi.spyOn(runtime, 'generate').mockRejectedValue(new Error('Unexpected provider dispatch'));
    await expect(callLLM({ model: 'gpt-6-luna', messages, maxOutputTokens })).rejects.toThrow(/output.*budget/i);
    expect(generate).not.toHaveBeenCalled();
  });

  it('should refuse excessive rendered input including tool schema before dispatch', async () => {
    const generate = vi.spyOn(runtime, 'generate').mockRejectedValue(new Error('Unexpected provider dispatch'));
    await expect(callLLM({ model: 'gpt-6-luna', messages, maxOutputTokens: 32,
      tools: [{ type: 'function', function: { name: 'oversized', description: 'x'.repeat(922_001 * 4), parameters: {} } }],
    })).rejects.toThrow(/input.*budget/i);
    expect(generate).not.toHaveBeenCalled();
  });
});
