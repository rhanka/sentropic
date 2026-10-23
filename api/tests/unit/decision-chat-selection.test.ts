import * as mesh from '@sentropic/llm-mesh';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDecisionOnlyProvider, isProviderId } from '../../src/services/provider-runtime';
import { getModelCatalogPayload, resolveDefaultSelection } from '../../src/services/model-catalog';
import { settingsService } from '../../src/services/settings';

afterEach(() => vi.restoreAllMocks());

describe('decision-only chat selection', () => {
  it('recognizes real TypeSafe identity without offering chat models or fallback', () => {
    expect(isProviderId('typesafe')).toBe(true);
    expect(isDecisionOnlyProvider('typesafe')).toBe(true);
    expect(mesh.knownModelIdsByProvider.typesafe).toEqual([]);
    expect(mesh.listModelProfilesByProvider('typesafe')).toEqual([]);
    expect(mesh.getProviderProfile('typesafe')).toMatchObject({ family: 'typesafe', status: 'planned',
      capabilities: { decision: { support: 'supported' }, tools: { support: 'unsupported' },
        streaming: { support: 'unsupported' }, structuredOutput: { support: 'unsupported' },
        reasoning: { support: 'unsupported' }, modalities: { input: [], output: [] },
        auth: { tokenSources: ['environment-token'], accountTransports: [] } } });
    expect(mesh.listProviderProfiles().filter((profile) => profile.decisionOnly).map((profile) => profile.providerId))
      .toEqual(['typesafe']);
    expect(() => resolveDefaultSelection({ providerId: 'typesafe', modelId: 'gpt-5.2' }, []))
      .toThrow('Decision-only providers');
  });
  it('uses the explicit profile marker before real decision-provider activation', () => {
    expect(isDecisionOnlyProvider('muse')).toBe(false);
    expect(mesh.getProviderProfile('muse').decisionOnly).toBeUndefined();
    const original = mesh.getProviderProfile;
    const profile = vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
      id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
    ));

    expect(isProviderId('muse')).toBe(true);
    expect(isDecisionOnlyProvider('muse')).toBe(true);
    expect(isDecisionOnlyProvider('openai')).toBe(false);
    profile.mockClear();
    expect(isDecisionOnlyProvider('unknown-provider')).toBe(false);
    expect(profile).not.toHaveBeenCalled();
  });

  it('keeps an unmarked local provider with an empty model inventory eligible', () => {
    expect(mesh.listModelProfilesByProvider('local')).toEqual([]);
    expect(mesh.getProviderProfile('local').decisionOnly).toBeUndefined();
    expect(isDecisionOnlyProvider('local')).toBe(false);
  });

  it.each(['', 'gpt-4.1-nano', 'gpt-5.2'])(
    'refuses an explicit marked choice before empty-inventory or legacy fallback (%s)', (modelId) => {
      const original = mesh.getProviderProfile;
      vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
        id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
      ));
      expect(() => resolveDefaultSelection({ providerId: 'muse', modelId }, []))
        .toThrow('Decision-only providers cannot be selected for chat');
      expect(() => resolveDefaultSelection({ providerId: ' muse ', modelId }, []))
        .toThrow('Decision-only providers cannot be selected for chat');
    });

  it.each([[null, 'muse'], ['synthetic-user', 'muse'], [null, 'typesafe'], ['synthetic-user', 'typesafe']] as const)(
    'refuses a stored marked default before legacy migration (%s, %s)', async (userId, providerId) => {
    const original = mesh.getProviderProfile;
    vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
      id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
    ));
    vi.spyOn(settingsService, 'getNumber').mockResolvedValue(10);
    const get = vi.spyOn(settingsService, 'get').mockImplementation(async (key) => (
      key === 'default_provider_id' ? providerId : key === 'default_model' ? 'gpt-5.2' : null
    ));
    expect(await settingsService.getAISettings({ userId })).toMatchObject({
      defaultProviderId: providerId, defaultModel: 'gpt-5.2',
    });
    await expect(getModelCatalogPayload({ userId })).rejects.toThrow('Decision-only providers');
    expect(get).toHaveBeenCalledWith('default_provider_id', { userId, fallbackToGlobal: true });
  });

  it.each(['local', 'unknown-provider', 'openai'])(
    'preserves ordinary empty-inventory fallback (%s)', (providerId) => {
      expect(resolveDefaultSelection({ providerId, modelId: 'missing-model' }, []))
        .toEqual({ provider_id: 'openai', model_id: 'gpt-5.4-nano' });
    });

  it('retains a valid chat pair and rejects an inferred marked provider', () => {
    const models = [{ provider_id: 'openai' as const, model_id: 'gpt-4.1-nano', label: 'Synthetic',
      reasoning_tier: 'none' as const, supports_tools: true, supports_streaming: true,
      default_contexts: ['chat' as const] }];
    expect(resolveDefaultSelection({ providerId: 'openai', modelId: models[0].model_id }, models))
      .toEqual({ provider_id: 'openai', model_id: 'gpt-4.1-nano' });
    const original = mesh.getProviderProfile;
    vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
      id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
    ));
    expect(() => resolveDefaultSelection({ modelId: 'synthetic-decision' }, [
      { ...models[0], provider_id: 'muse', model_id: 'synthetic-decision' },
    ])).toThrow('Decision-only providers');
  });
});
