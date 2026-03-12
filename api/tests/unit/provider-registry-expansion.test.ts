import { describe, expect, it } from 'vitest';

import { providerRegistry } from '../../src/services/provider-registry';
import { providerIds } from '../../src/services/provider-runtime';

describe('ProviderRegistry expansion', () => {
  it('should list all 5 providers', () => {
    const providers = providerRegistry.listProviders();
    const ids = providers.map((p) => p.providerId);

    expect(ids).toContain('openai');
    expect(ids).toContain('gemini');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('mistral');
    expect(ids).toContain('cohere');
    expect(ids).toHaveLength(5);
  });

  it('should have all provider IDs in the providerIds constant', () => {
    expect(providerIds).toEqual(
      expect.arrayContaining(['openai', 'gemini', 'anthropic', 'mistral', 'cohere']),
    );
    expect(providerIds).toHaveLength(5);
  });

  it('should resolve each provider via getProvider', () => {
    for (const id of providerIds) {
      const provider = providerRegistry.getProvider(id);
      expect(provider).not.toBeNull();
      expect(provider!.provider.providerId).toBe(id);
    }
  });

  it('should resolve each provider via requireProvider', () => {
    for (const id of providerIds) {
      expect(() => providerRegistry.requireProvider(id)).not.toThrow();
    }
  });

  it('should throw for unknown provider in requireProvider', () => {
    expect(() =>
      providerRegistry.requireProvider('unknown' as never),
    ).toThrow('Provider not found');
  });

  it('should list models from all 5 providers', () => {
    const models = providerRegistry.listModels();
    const providerIdsInModels = [...new Set(models.map((m) => m.providerId))];

    expect(providerIdsInModels).toContain('openai');
    expect(providerIdsInModels).toContain('gemini');
    expect(providerIdsInModels).toContain('anthropic');
    expect(providerIdsInModels).toContain('mistral');
    expect(providerIdsInModels).toContain('cohere');
  });

  it('should have correct capabilities per provider', () => {
    const providers = providerRegistry.listProviders();

    const anthropic = providers.find((p) => p.providerId === 'anthropic');
    expect(anthropic!.capabilities.supportsReasoning).toBe(true);
    expect(anthropic!.capabilities.supportsTools).toBe(true);

    const mistral = providers.find((p) => p.providerId === 'mistral');
    expect(mistral!.capabilities.supportsReasoning).toBe(false);
    expect(mistral!.capabilities.supportsTools).toBe(true);

    const cohere = providers.find((p) => p.providerId === 'cohere');
    expect(cohere!.capabilities.supportsReasoning).toBe(false);
    expect(cohere!.capabilities.supportsTools).toBe(true);
  });
});
