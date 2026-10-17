/**
 * L-5e — artifacts mesh leaf surface (spec-v8 §9 5e, review B3): the
 * `sentropic.artifacts` builtin is delivered through the qualified mesh
 * leaf, selected/configured like any provider, and compiled through the
 * one platform kernel beside a local provider. Unselected builtins never
 * load; loader failures refuse compilation atomically.
 */
import { describe, expect, it } from 'vitest';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { ClusterMeshModules } from '../../src/modules/contracts.js';
import { createClusterMeshModules } from '../../src/modules/registry.js';
import { loadArtifactsMcp } from '../../src/loaders/mcp/artifacts.js';
import { createMcpRegistry } from '../../src/mcp/registry.js';
import { createArtifactsBuiltin } from '../../src/integrations/mcp/artifacts.js';

const SPEC_TOOLS = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
];

interface ModuleOptions { failArtifacts?: boolean; loads?: string[] }

const modulesWith = (options: ModuleOptions = {}): ClusterMeshModules =>
  ({
    load: async (id: string) => {
      options.loads?.push(id);
      if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
      if (id === 'mcp/artifacts') {
        if (options.failArtifacts === true) throw new Error('artifacts peer absent');
        return import('@sentropic/artifacts/mcp');
      }
      throw new Error(`unexpected module load in artifacts spec: ${id}`);
    },
  }) as unknown as ClusterMeshModules;

const fakeApp = {
  handle: async () => ({ status: 200, body: { ok: true } }),
};

const LIMIT_SCHEMA = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

const IMMO_MANIFEST = {
  appId: 'probe-app',
  providerId: 'immo',
  version: '0.0.0',
  displayName: 'Probe immo',
  resources: [],
  tools: [{
    kind: 'tool', name: 'immo_search', description: 'Synthetic.',
    requiredScopes: ['probe:use'], requiredClaims: [],
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    redactionClass: 'low', mutability: 'read-only', mutatesExternalSystem: false,
    idempotency: { required: false },
    gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
  }],
  prompts: [],
  authz: { requiredClaims: [], scopes: ['probe:use'], tenantResolution: 'connector-instance' },
  audit: { eventKinds: ['invoke'] },
  durability: {},
};

function localImmo() {
  return {
    manifest: IMMO_MANIFEST,
    adapter: { appId: 'probe-app', connectorId: 'probe' },
    parameterSchema: { properties: {}, required: [] },
    handlers: {
      'immo_search-handler': {
        handlerId: 'immo_search-handler', capabilityRef: 'immo_search', configSchema: LIMIT_SCHEMA,
      },
    },
    requiredPorts: [],
    provenance: { approvalRef: 'a', revision: 'r', manifestDigest: 'm', reviewedBy: ['probe-owner'] },
    toolValues: { immo_search: { handlerId: 'immo_search-handler', values: { limit: 20 } } },
  } as never;
}

function facadeWith(options: ModuleOptions = {}) {
  const modules = modulesWith(options);
  const facade = createMcpRegistry({
    modules,
    builtins: [createArtifactsBuiltin({ modules, definition: { app: fakeApp } })],
  });
  facade.register(localImmo());
  return facade;
}

describe('artifacts mesh leaf', () => {
  it('catalogues sentropic.artifacts with the 15 artifacts tools', () => {
    const facade = facadeWith();
    const entry = facade.catalog().find((item) => item.providerId === 'sentropic.artifacts');
    expect(entry).toMatchObject({
      providerId: 'sentropic.artifacts',
      version: '0.1.0',
      capabilities: SPEC_TOOLS,
      availability: 'not-selected',
    });
  });

  it('selects and configures sentropic.artifacts beside a local provider', async () => {
    const facade = facadeWith();
    facade.select(['immo', 'sentropic.artifacts']);
    facade.configure('sentropic.artifacts', { defaultStorageScopeId: 'scope-1' });
    const builtin = createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp } });
    const definition = await builtin.load();
    const compiled = await facade.compile({
      bindings: {},
      compatibility: {
        immo: { manifestDigest: computeManifestDigest(IMMO_MANIFEST) },
        'sentropic.artifacts': { manifestDigest: computeManifestDigest(definition.manifest) },
      },
    });
    if (!compiled.ok) throw new Error(`compile refused: ${JSON.stringify(compiled.diagnostics)}`);
    expect(compiled.registry.resolveTool('immo_search')?.providerId).toBe('immo');
    for (const name of SPEC_TOOLS) {
      expect(compiled.registry.resolveTool(name)?.providerId, name).toBe('sentropic.artifacts');
    }
    const entry = facade.catalog().find((item) => item.providerId === 'sentropic.artifacts');
    expect(entry?.availability).toBe('available');
  });

  it('refuses the previous provider ID as unknown for selection and configuration', () => {
    const facade = facadeWith();
    expect(() => facade.select(['sentropic.web-pages'])).toThrow(/unknown provider/);
    expect(() => facade.configure('sentropic.web-pages', {})).toThrow(/unknown provider/);
  });

  it('never loads the artifacts leaf while artifacts stays unselected', async () => {
    const loads: string[] = [];
    const facade = facadeWith({ loads });
    facade.select(['immo']);
    const compiled = await facade.compile({
      bindings: {},
      compatibility: { immo: { manifestDigest: computeManifestDigest(IMMO_MANIFEST) } },
    });
    expect(compiled.ok).toBe(true);
    expect(loads).not.toContain('mcp/artifacts');
    expect(compiled.ok && compiled.registry.resolveTool('artifacts_list')).toBeUndefined();
  });

  it('refuses compilation atomically when the artifacts peer is absent', async () => {
    const facade = facadeWith({ failArtifacts: true });
    facade.select(['sentropic.artifacts']);
    const compiled = await facade.compile({ bindings: {}, compatibility: {} });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.diagnostics[0]?.path).toContain('sentropic.artifacts');
      expect(compiled.diagnostics[0]?.message).toContain('builtin loader failed');
    }
    expect(facade.compiled()).toBeUndefined();
  });

  it('refuses selecting artifacts without the builtin and colliding tools', async () => {
    const bare = createMcpRegistry({ modules: modulesWith() });
    expect(() => bare.select(['sentropic.artifacts'])).toThrow(/unknown provider/);
    const facade = facadeWith();
    const colliding = localImmo() as unknown as { manifest: typeof IMMO_MANIFEST };
    colliding.manifest = {
      ...IMMO_MANIFEST,
      providerId: 'other',
      tools: [{ ...IMMO_MANIFEST.tools[0]!, name: 'artifacts_list' }],
    };
    facade.register({
      ...(localImmo() as object),
      manifest: colliding.manifest,
      handlers: {
        'artifacts_list-handler': {
          handlerId: 'artifacts_list-handler', capabilityRef: 'artifacts_list', configSchema: LIMIT_SCHEMA,
        },
      },
      toolValues: { artifacts_list: { handlerId: 'artifacts_list-handler', values: { limit: 20 } } },
    } as never);
    facade.select(['other', 'sentropic.artifacts']);
    const builtin = createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp } });
    const definition = await builtin.load();
    const compiled = await facade.compile({
      bindings: {},
      compatibility: {
        other: { manifestDigest: computeManifestDigest(colliding.manifest) },
        'sentropic.artifacts': { manifestDigest: computeManifestDigest(definition.manifest) },
      },
    });
    expect(compiled.ok).toBe(false);
  });

  it('resolves the leaf through the real module registry and catalog', async () => {
    const modules = createClusterMeshModules();
    const mcp = await loadArtifactsMcp(modules);
    expect(mcp.ARTIFACTS_PROVIDER_ID).toBe('sentropic.artifacts');
    expect([...mcp.ARTIFACTS_TOOL_NAMES]).toEqual(SPEC_TOOLS);
    expect(typeof mcp.createArtifactsRegistryDefinition).toBe('function');
    const facade = createMcpRegistry({
      modules,
      builtins: [createArtifactsBuiltin({ modules, definition: { app: fakeApp } })],
    });
    facade.select(['sentropic.artifacts']);
    const compiled = await facade.compile({
      bindings: {},
      compatibility: {
        'sentropic.artifacts': {
          manifestDigest: computeManifestDigest(mcp.createArtifactsManifest()),
        },
      },
    });
    if (!compiled.ok) throw new Error(`compile refused: ${JSON.stringify(compiled.diagnostics)}`);
    expect(compiled.registry.resolveTool('artifacts_restore')?.providerId)
      .toBe('sentropic.artifacts');
  });
});
