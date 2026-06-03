import { describe, expect, it } from 'vitest';

import { providerIds, knownModelIdsByProvider } from '../src/providers.js';
import {
  GcpAdapter,
  createDefaultProviderAdapters,
  type ProviderAdapter,
} from '../src/adapters.js';
import { createProviderRegistry } from '../src/registry.js';
import { getProviderProfile } from '../src/catalog.js';

const GCP_CATALOG_KEYS = [
  'google/gemini-3.5-flash@gcp',
  'google/gemini-3.1-flash-lite@gcp',
] as const;

describe('gcp provider package surface', () => {
  it('adds gcp to the provider set (5 -> 6) without disturbing the existing five', () => {
    expect(providerIds).toContain('gcp');
    expect(providerIds).toHaveLength(6);
    expect([...providerIds]).toEqual([
      'openai',
      'gemini',
      'anthropic',
      'mistral',
      'cohere',
      'gcp',
    ]);
  });

  it('lists the two globally-unique Gemini-on-GCP catalog keys for gcp', () => {
    expect(knownModelIdsByProvider.gcp).toEqual(GCP_CATALOG_KEYS);
  });

  it('registers a GcpAdapter via createDefaultProviderAdapters', () => {
    const adapters = createDefaultProviderAdapters();
    const gcp = adapters.find(
      (adapter: ProviderAdapter) => adapter.provider.providerId === 'gcp',
    );

    expect(gcp).toBeInstanceOf(GcpAdapter);
    expect(adapters).toHaveLength(6);
  });

  it('exposes the two GCP models through the registry built from default adapters', () => {
    const registry = createProviderRegistry(createDefaultProviderAdapters());
    const gcp = registry.requireProvider('gcp');

    expect(gcp.listModels().map((model) => model.modelId)).toEqual(GCP_CATALOG_KEYS);
  });

  it('mirrors the Gemini provider family + capability template (GCP = Gemini-on-GCP)', () => {
    // The Gemini request-body builder lives in api (transport layer); the
    // package-observable proof that GCP reuses the Gemini shape is that its
    // provider profile mirrors the `gemini` family + json-schema-subset template.
    const gcpProfile = getProviderProfile('gcp');
    const geminiProfile = getProviderProfile('gemini');

    expect(gcpProfile.family).toBe('google');
    expect(gcpProfile.capabilities.structuredOutput.jsonSchema).toEqual(
      geminiProfile.capabilities.structuredOutput.jsonSchema,
    );
  });

  it('accepts a pre-dispatch-minted direct-token bearer and rejects an empty source (M2)', () => {
    // M2 conformance: api Lot 3 mints the short-lived ADC bearer PRE-DISPATCH and
    // carries it as a `direct-token`. The GcpAdapter uses the default
    // validateAdapterAuthSource (no override), so a `direct-token` with text passes
    // and `none` is rejected — exactly the gate api Lot 3 relies on.
    const gcp = new GcpAdapter();

    expect(gcp.validateAuth({ type: 'direct-token', token: 'ya29.adc-bearer' })).toEqual({
      ok: true,
    });
    expect(gcp.validateAuth({ type: 'none' }).ok).toBe(false);
  });
});
