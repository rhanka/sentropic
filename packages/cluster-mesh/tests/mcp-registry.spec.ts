/**
 * Lot 7 — mesh facade over the one platform kernel: registration, selection,
 * parameterization and compilation through `@sentropic/cluster-mesh/mcp/registry`.
 * Unavailable providers (e.g. `sentropic.artifacts` without its builtin) fail
 * startup explicitly — never a silent stub. Builtin loaders run only for
 * selected entries and refuse atomically.
 */
import { describe, expect, it } from 'vitest';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { ClusterMeshModules } from '../src/modules/contracts.js';
import { createMcpRegistry } from '../src/mcp/registry.js';

const kernel = () => import('@sentropic/mcp-platform/registry');

const modules = (): ClusterMeshModules =>
  ({
    load: async (id: string) => {
      if (id === 'mcp-platform/registry') return kernel();
      throw new Error(`unexpected module load in facade spec: ${id}`);
    },
  }) as unknown as ClusterMeshModules;

const MANIFEST = {
  appId: 'probe-app',
  providerId: 'immo',
  version: '0.0.0',
  displayName: 'Probe immo',
  resources: [],
  tools: [
    {
      kind: 'tool',
      name: 'immo_search',
      description: 'Synthetic.',
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

const LIMIT_SCHEMA = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

const definition = (providerId = 'immo') => ({
  manifest: { ...MANIFEST, providerId },
  adapter: { appId: 'probe-app', connectorId: 'probe' },
  parameterSchema: { properties: {}, required: [] },
  handlers: {
    'immo_search-handler': {
      handlerId: 'immo_search-handler',
      capabilityRef: 'immo_search',
      configSchema: LIMIT_SCHEMA,
    },
  },
  requiredPorts: [],
  provenance: { approvalRef: 'a', revision: 'r', manifestDigest: 'm', reviewedBy: ['probe-owner'] },
  toolValues: { immo_search: { handlerId: 'immo_search-handler', values: { limit: 20 } } },
});

const RECEIPTS = { immo: { manifestDigest: computeManifestDigest(MANIFEST) } };

describe('mesh registry facade', () => {
  it('registers, selects, configures and compiles a local provider', async () => {
    const registry = createMcpRegistry({ modules: modules() });
    registry.register(definition() as never);
    registry.select(['immo']);
    const compiled = await registry.compile({ bindings: {}, compatibility: RECEIPTS });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.registry.resolveTool('immo_search')?.providerId).toBe('immo');
  });

  it('refuses an unavailable provider explicitly instead of stubbing it', async () => {
    const registry = createMcpRegistry({ modules: modules() });
    registry.register(definition() as never);
    expect(() => registry.select(['immo', 'sentropic.artifacts'])).toThrow(/unknown provider/);
  });

  it('materializes selected builtins only, refusing loader failures atomically', async () => {
    const calls: string[] = [];
    const registry = createMcpRegistry({
      modules: modules(),
      builtins: [
        {
          providerId: 'builtin-pages',
          version: '0.0.0',
          capabilities: [],
          parameterSchema: { properties: {}, required: [] },
          load: async () => {
            calls.push('builtin-pages');
            return definition('builtin-pages');
          },
        },
        {
          providerId: 'builtin-broken',
          version: '0.0.0',
          capabilities: [],
          parameterSchema: { properties: {}, required: [] },
          load: async () => {
            calls.push('builtin-broken');
            throw new Error('builtin exploded');
          },
        },
      ],
    });
    registry.select([]);
    const empty = await registry.compile({ bindings: {}, compatibility: {} });
    expect(empty.ok).toBe(true);
    expect(calls).toEqual([]);

    registry.select(['builtin-pages']);
    const good = await registry.compile({
      bindings: {},
      compatibility: {
        'builtin-pages': { manifestDigest: computeManifestDigest({ ...MANIFEST, providerId: 'builtin-pages' }) },
      },
    });
    expect(good.ok).toBe(true);
    expect(calls).toEqual(['builtin-pages']);

    registry.select(['builtin-broken']);
    const bad = await registry.compile({ bindings: {}, compatibility: {} });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.diagnostics.length).toBeGreaterThan(0);
  });

  it('lists builtin and local descriptors without executing anything', async () => {
    const calls: string[] = [];
    const registry = createMcpRegistry({
      modules: modules(),
      builtins: [
        {
          providerId: 'builtin-pages',
          version: '0.0.0',
          capabilities: ['pages.open'],
          parameterSchema: { properties: {}, required: [] },
          load: async () => {
            calls.push('builtin-pages');
            return definition('builtin-pages');
          },
        },
      ],
    });
    registry.register(definition() as never);
    const catalog = registry.catalog();
    expect(catalog.map((entry) => entry.providerId).sort()).toEqual(['builtin-pages', 'immo']);
    expect(calls).toEqual([]);
  });
});
