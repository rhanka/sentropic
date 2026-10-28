import * as mesh from '@sentropic/llm-mesh';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsService } from '../../src/services/settings';
import { resolveProviderCredential } from '../../src/services/provider-credentials';
import * as connections from '../../src/services/provider-connections';
import { createMistralVibeAccountAuthInput, dispatchMeshGenerateRaw, dispatchMeshStreamRaw } from '../../src/services/llm-runtime/mesh-dispatch';
import { callLLM, callLLMStream, resolveRuntimeSelection } from '../../src/services/llm-runtime';

const defaults = { defaultProviderId: 'openai', defaultModel: 'gpt-4.1-nano',
  concurrency: 1, publishingConcurrency: 1, processingInterval: 1000 };

vi.mock('../../src/services/settings', () => ({ settingsService: { getAISettings: vi.fn() } }));
vi.mock('../../src/services/provider-credentials', () => ({ resolveProviderCredential: vi.fn() }));
vi.mock('../../src/services/provider-connections', () => ({
  getAnthropicTransportMode: vi.fn(), getOpenAITransportMode: vi.fn(),
  resolveAntigravityFallbackTransport: vi.fn(), resolveConnectedClaudeCodeTransport: vi.fn(),
  resolveConnectedCodexTransport: vi.fn(), resolveConnectedMistralVibeTransport: vi.fn(),
}));
vi.mock('../../src/services/llm-runtime/mesh-dispatch', () => ({
  dispatchMeshGenerateRaw: vi.fn(), dispatchMeshStreamRaw: vi.fn(),
  createClaudeCodeAccountAuthInput: vi.fn(), createCodexAccountAuthInput: vi.fn(),
  createMistralVibeAccountAuthInput: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(settingsService.getAISettings).mockResolvedValue(defaults);
  const original = mesh.getProviderProfile;
  vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
    id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
  ));
});
afterEach(() => vi.restoreAllMocks());

const expectNoDispatch = () => {
  expect(resolveProviderCredential).not.toHaveBeenCalled();
  for (const connection of Object.values(connections)) expect(connection).not.toHaveBeenCalled();
  expect(dispatchMeshGenerateRaw).not.toHaveBeenCalled();
  expect(dispatchMeshStreamRaw).not.toHaveBeenCalled();
  expect(createMistralVibeAccountAuthInput).not.toHaveBeenCalled();
};

describe('decision-only runtime selection', () => {
  it.each(['explicit', 'stored'])('refuses real TypeSafe without credentials or dispatch (%s)', async (selection) => {
    vi.mocked(settingsService.getAISettings).mockResolvedValue({ ...defaults, defaultProviderId: 'typesafe' });
    const options = { messages: [], model: 'gpt-4.1-nano',
      ...(selection === 'explicit' ? { providerId: 'typesafe' as const } : {}) };
    await expect(resolveRuntimeSelection(options)).rejects.toThrow('Decision-only providers');
    await expect(callLLM(options)).rejects.toThrow('Decision-only providers');
    await expect(callLLMStream(options).next()).rejects.toThrow('Decision-only providers');
    expectNoDispatch();
  });
  it.each(['', 'gpt-4.1-nano', 'gpt-5.2'])(
    'refuses an explicit marked provider before defaults or dispatch (%s)', async (model) => {
      const options = { providerId: 'muse' as const, model, messages: [], userId: 'synthetic-user' };
      await expect(resolveRuntimeSelection(options)).rejects.toThrow('Decision-only providers');
      await expect(callLLM(options)).rejects.toThrow('Decision-only providers');
      await expect(callLLMStream(options).next()).rejects.toThrow('Decision-only providers');
      expect(settingsService.getAISettings).not.toHaveBeenCalled();
      expectNoDispatch();
    });

  it.each([undefined, 'unknown-provider'])(
    'refuses a stored marked default before model inference (%s)', async (providerId) => {
      vi.mocked(settingsService.getAISettings).mockResolvedValue({ ...defaults, defaultProviderId: 'muse' });
      await expect(resolveRuntimeSelection({ providerId, model: 'gpt-4.1-nano' }))
        .rejects.toThrow('Decision-only providers');
      await expect(callLLM({ messages: [], userId: 'synthetic-user' })).rejects.toThrow('Decision-only providers');
      await expect(callLLMStream({ messages: [], userId: 'synthetic-user' }).next())
        .rejects.toThrow('Decision-only providers');
      expectNoDispatch();
    });

  it.each(['openai', 'local', 'unknown-provider'])(
    'preserves ordinary provider selection and empty-local fallback (%s)', async (providerId) => {
      expect(await resolveRuntimeSelection({ providerId, model: 'gpt-4.1-nano' }))
        .toEqual({ providerId: 'openai', model: 'gpt-5.4-nano' });
      expectNoDispatch();
    });

  it('uses an explicit valid chat provider despite an unused marked stored default', async () => {
    vi.mocked(settingsService.getAISettings).mockResolvedValue({ ...defaults, defaultProviderId: 'muse' });
    expect(await resolveRuntimeSelection({ providerId: 'openai', model: 'gpt-4.1-nano' }))
      .toEqual({ providerId: 'openai', model: 'gpt-5.4-nano' });
    expectNoDispatch();
  });
});
