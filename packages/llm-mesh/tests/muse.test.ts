import { describe, expect, it } from 'vitest';

import { providerIds, knownModelIdsByProvider } from '../src/providers.js';
import {
  MuseAdapter,
  createDefaultProviderAdapters,
  type ProviderAdapter,
} from '../src/adapters.js';
import { createProviderRegistry } from '../src/registry.js';
import { getProviderProfile, getModelProfile } from '../src/catalog.js';

const MUSE_CATALOG_KEYS = [
  'muse-spark-1.3',
  'muse-spark-1.3-contributor',
] as const;

describe('muse provider package surface', () => {
  it('adds muse to the provider set (7 -> 8) without disturbing the existing seven', () => {
    expect(providerIds).toContain('muse');
    expect(providerIds).toHaveLength(8);
    expect([...providerIds]).toEqual([
      'openai',
      'gemini',
      'anthropic',
      'mistral',
      'cohere',
      'gcp',
      'local',
      'muse',
    ]);
  });

  it('lists the Muse Spark model ids (base + contributor tier option) for muse', () => {
    expect(knownModelIdsByProvider.muse).toEqual(MUSE_CATALOG_KEYS);
  });

  it('registers a MuseAdapter via createDefaultProviderAdapters', () => {
    const adapters = createDefaultProviderAdapters();
    const muse = adapters.find(
      (adapter: ProviderAdapter) => adapter.provider.providerId === 'muse',
    );

    expect(muse).toBeInstanceOf(MuseAdapter);
    expect(adapters).toHaveLength(8);
  });

  it('exposes the two Muse models through the registry built from default adapters', () => {
    const registry = createProviderRegistry(createDefaultProviderAdapters());
    const muse = registry.requireProvider('muse');

    expect(muse.listModels().map((model) => model.modelId)).toEqual(MUSE_CATALOG_KEYS);
  });

  it('declares the Meta provider family with advanced reasoning capabilities', () => {
    const profile = getProviderProfile('muse');

    expect(profile.family).toBe('meta');
    expect(profile.capabilities.reasoning.support).not.toBe('unsupported');
  });

  it('profiles both tiers with the contributor variant as the discounted option', () => {
    const base = getModelProfile('muse', 'muse-spark-1.3');
    const contributor = getModelProfile('muse', 'muse-spark-1.3-contributor');

    expect(base?.modelId).toBe('muse-spark-1.3');
    expect(base?.reasoningTier).toBe('advanced');
    expect(contributor?.modelId).toBe('muse-spark-1.3-contributor');
    expect(contributor?.reasoningTier).toBe('advanced');
  });
});
