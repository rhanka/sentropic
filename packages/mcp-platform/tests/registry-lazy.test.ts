/**
 * RC-M2(a) — lazy definitions: never load on register/catalog/unselected,
 * load selected entries only after preflight, atomic refusal on load failure.
 */
import { describe, expect, it } from 'vitest';
import { computeManifestDigest } from '../src/tool-configuration.js';
import {
  createProviderRegistry,
  type LazyDefinition,
  type LocalProviderDefinition,
} from '../src/registry.js';
import type { AppMcpProviderManifest } from '../src/manifest.js';

function makeManifest(providerId: string): AppMcpProviderManifest {
  return {
    appId: 'probe-app',
    providerId,
    version: '0.0.0',
    displayName: `Probe ${providerId}`,
    resources: [],
    tools: [
      {
        kind: 'tool',
        name: 'lazy_search',
        description: 'Synthetic lazy tool.',
        requiredScopes: ['probe:use'],
        requiredClaims: [],
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        redactionClass: 'low',
        mutability: 'read-only',
        mutatesExternalSystem: false,
        idempotency: { required: false },
        gates: {
          requiresElicitation: false,
          requiresHumanConfirmation: false,
          requiresPrincipalGate: false,
        },
      },
    ],
    prompts: [],
    authz: { requiredClaims: [], scopes: ['probe:use'], tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
}

const LIMIT_SCHEMA = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

function makeLazy(providerId: string, load: LazyDefinition['load']): {
  lazy: LazyDefinition;
  manifest: AppMcpProviderManifest;
  calls: number[];
} {
  const manifest = makeManifest(providerId);
  const calls: number[] = [];
  const lazy: LazyDefinition = {
    kind: 'lazy',
    manifest,
    parameterSchema: { properties: {}, required: [] },
    requiredPorts: ['storage'],
    provenance: {
      approvalRef: 'approval-lazy-1',
      revision: 'rev-1',
      manifestDigest: computeManifestDigest(manifest),
      reviewedBy: ['probe-owner'],
    },
    load: () => {
      calls.push(1);
      return load();
    },
  };
  return { lazy, manifest, calls };
}

function payload(): ReturnType<LazyDefinition['load']> {
  return {
    adapter: { appId: 'probe-app', connectorId: 'probe' },
    handlers: {
      'lazy_search-handler': {
        handlerId: 'lazy_search-handler',
        capabilityRef: 'lazy_search',
        configSchema: LIMIT_SCHEMA,
      },
    },
    toolValues: { lazy_search: { handlerId: 'lazy_search-handler', values: { limit: 20 } } },
  } as unknown as ReturnType<LazyDefinition['load']>;
}

const BINDINGS = { storage: { kind: 'memory' } };

describe('lazy definitions (RC-M2a)', () => {
  it('never loads on register, catalog or unselected compile', () => {
    const registry = createProviderRegistry();
    const { lazy, calls } = makeLazy('lazy', payload);
    registry.register(lazy);
    expect(calls).toHaveLength(0);
    expect(registry.catalog().map((c) => c.providerId)).toEqual(['lazy']);
    expect(calls).toHaveLength(0);
    registry.select([]);
    const compiled = registry.compile({ bindings: BINDINGS, compatibility: {} });
    expect(compiled.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('runs preflight before loading selected entries', () => {
    const registry = createProviderRegistry();
    const { lazy, manifest, calls } = makeLazy('lazy', payload);
    registry.register(lazy);
    registry.select(['lazy']);
    const bad = registry.compile({
      bindings: BINDINGS,
      compatibility: { lazy: { manifestDigest: 'wrong' } },
    });
    expect(bad.ok).toBe(false);
    expect(calls).toHaveLength(0);
    const good = registry.compile({
      bindings: BINDINGS,
      compatibility: { lazy: { manifestDigest: computeManifestDigest(manifest) } },
    });
    expect(good.ok).toBe(true);
    expect(calls).toHaveLength(1);
    if (good.ok) {
      expect(good.registry.tools.has('lazy_search')).toBe(true);
    }
  });

  it('refuses atomically when the loader throws', () => {
    const registry = createProviderRegistry();
    const { lazy, manifest, calls } = makeLazy('lazy', () => {
      throw new Error('disk gone');
    });
    registry.register(lazy);
    registry.select(['lazy']);
    const compiled = registry.compile({
      bindings: BINDINGS,
      compatibility: { lazy: { manifestDigest: computeManifestDigest(manifest) } },
    });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.diagnostics.length).toBeGreaterThan(0);
    }
    expect(calls).toHaveLength(1);
    expect(registry.active()).toBeUndefined();
    expect(registry.catalog().map((c) => c.providerId)).toEqual(['lazy']);
  });

  it('isolates registered metadata from later caller mutation', () => {
    const registry = createProviderRegistry();
    const { lazy, manifest } = makeLazy('lazy', payload);
    registry.register(lazy);
    (manifest as { version: string }).version = '9.9.9';
    expect(registry.catalog()[0]?.version).toBe('0.0.0');
  });

  it('still accepts loaded definitions unchanged', () => {
    const registry = createProviderRegistry();
    const manifest = makeManifest('loaded');
    const loaded: LocalProviderDefinition = {
      manifest,
      adapter: { appId: 'probe-app', connectorId: 'probe' },
      parameterSchema: { properties: {}, required: [] },
      handlers: {},
      requiredPorts: [],
      provenance: {
        approvalRef: 'a',
        revision: 'r',
        manifestDigest: computeManifestDigest(manifest),
        reviewedBy: [],
      },
      toolValues: {},
    } as unknown as LocalProviderDefinition;
    registry.register(loaded);
    expect(registry.catalog().map((c) => c.providerId)).toEqual(['loaded']);
  });
});
