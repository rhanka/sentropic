import { describe, expect, it } from 'vitest';

import { providerIds, knownModelIdsByProvider } from '../src/providers.js';
import {
  VertexAdapter,
  createDefaultProviderAdapters,
  type ProviderAdapter,
} from '../src/adapters.js';
import { createProviderRegistry } from '../src/registry.js';
import { getProviderProfile } from '../src/catalog.js';

const VERTEX_CATALOG_KEYS = [
  'google/gemini-3.5-flash@vertex',
  'google/gemini-3.1-flash-lite@vertex',
] as const;

describe('vertex provider package surface', () => {
  it('adds vertex to the provider set (5 -> 6) without disturbing the existing five', () => {
    expect(providerIds).toContain('vertex');
    expect(providerIds).toHaveLength(6);
    expect([...providerIds]).toEqual([
      'openai',
      'gemini',
      'anthropic',
      'mistral',
      'cohere',
      'vertex',
    ]);
  });

  it('lists the two globally-unique Gemini-on-Vertex catalog keys for vertex', () => {
    expect(knownModelIdsByProvider.vertex).toEqual(VERTEX_CATALOG_KEYS);
  });

  it('registers a VertexAdapter via createDefaultProviderAdapters', () => {
    const adapters = createDefaultProviderAdapters();
    const vertex = adapters.find(
      (adapter: ProviderAdapter) => adapter.provider.providerId === 'vertex',
    );

    expect(vertex).toBeInstanceOf(VertexAdapter);
    expect(adapters).toHaveLength(6);
  });

  it('exposes the two Vertex models through the registry built from default adapters', () => {
    const registry = createProviderRegistry(createDefaultProviderAdapters());
    const vertex = registry.requireProvider('vertex');

    expect(vertex.listModels().map((model) => model.modelId)).toEqual(VERTEX_CATALOG_KEYS);
  });

  it('mirrors the Gemini provider family + capability template (Vertex = Gemini-on-Vertex)', () => {
    // The Gemini request-body builder lives in api (transport layer); the
    // package-observable proof that Vertex reuses the Gemini shape is that its
    // provider profile mirrors the `gemini` family + json-schema-subset template.
    const vertexProfile = getProviderProfile('vertex');
    const geminiProfile = getProviderProfile('gemini');

    expect(vertexProfile.family).toBe('google');
    expect(vertexProfile.capabilities.structuredOutput.jsonSchema).toEqual(
      geminiProfile.capabilities.structuredOutput.jsonSchema,
    );
  });

  it('accepts a pre-dispatch-minted direct-token bearer and rejects an empty source (M2)', () => {
    // M2 conformance: api Lot 3 mints the short-lived ADC bearer PRE-DISPATCH and
    // carries it as a `direct-token`. The VertexAdapter uses the default
    // validateAdapterAuthSource (no override), so a `direct-token` with text passes
    // and `none` is rejected — exactly the gate api Lot 3 relies on.
    const vertex = new VertexAdapter();

    expect(vertex.validateAuth({ type: 'direct-token', token: 'ya29.adc-bearer' })).toEqual({
      ok: true,
    });
    expect(vertex.validateAuth({ type: 'none' }).ok).toBe(false);
  });
});
