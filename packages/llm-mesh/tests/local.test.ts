import { describe, expect, it } from 'vitest';

import { providerIds, knownModelIdsByProvider } from '../src/providers.js';
import {
  LocalAdapter,
  createDefaultProviderAdapters,
  type ProviderAdapter,
} from '../src/adapters.js';
import { createProviderRegistry } from '../src/registry.js';
import { getProviderProfile } from '../src/catalog.js';

const LOCAL_MODELS = ['laneformer-2b-it'] as const;

describe('local provider package surface', () => {
  it('adds local to the provider set (6 -> 7) without disturbing the existing six', () => {
    expect(providerIds).toContain('local');
    expect([...providerIds].slice(0, 6)).toEqual([
      'openai',
      'gemini',
      'anthropic',
      'mistral',
      'cohere',
      'gcp',
    ]);
  });

  it('lists the local (Laneformer) model id for local', () => {
    expect(knownModelIdsByProvider.local).toEqual(LOCAL_MODELS);
  });

  it('registers a LocalAdapter via createDefaultProviderAdapters', () => {
    const adapters = createDefaultProviderAdapters();
    const local = adapters.find(
      (adapter: ProviderAdapter) => adapter.provider.providerId === 'local',
    );

    expect(local).toBeInstanceOf(LocalAdapter);
  });

  it('resolves the local provider through the registry built from default adapters', () => {
    const registry = createProviderRegistry(createDefaultProviderAdapters());
    const local = registry.requireProvider('local');

    expect(local.provider.providerId).toBe('local');
    // No static model profile is advertised yet for `local` (the host sidecar
    // serves `laneformer-2b-it` directly when selected); advertising it in the
    // static catalog is a follow-up. So the registry lists zero local models.
    expect(local.listModels()).toEqual([]);
  });

  it('uses the OpenAI wire family with no reasoning and no structured-output enforcement', () => {
    // The local sidecar (e.g. Laneformer 2B on 127.0.0.1:8089) speaks the OpenAI
    // wire format; it is a latency-first chat model with no reasoning and no
    // structured-output contract. The baseURL/transport is wired in api/gateway.
    const profile = getProviderProfile('local');

    expect(profile.family).toBe('openai');
    expect(profile.capabilities.reasoning.support).toBe('unsupported');
    expect(profile.capabilities.structuredOutput.support).toBe('unsupported');
  });

  it('accepts a direct-token bearer and rejects an empty source (default auth)', () => {
    const local = new LocalAdapter();

    expect(local.validateAuth({ type: 'direct-token', token: 'local-sidecar' })).toEqual({
      ok: true,
    });
    expect(local.validateAuth({ type: 'none' }).ok).toBe(false);
  });
});
