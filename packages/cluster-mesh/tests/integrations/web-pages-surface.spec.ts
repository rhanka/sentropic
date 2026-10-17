/**
 * L-5e — web-pages mesh leaf surface (spec-v8 §9 5e, review B3): the
 * `sentropic.web-pages` builtin is delivered through the qualified mesh
 * leaf, selected/configured like any provider, and compiled through the
 * one platform kernel beside a local provider. Unselected builtins never
 * load; loader failures refuse compilation atomically.
 */
import { describe, expect, it } from 'vitest';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { ClusterMeshModules } from '../../src/modules/contracts.js';
import { createMcpRegistry } from '../../src/mcp/registry.js';
import { createWebPagesBuiltin } from '../../src/integrations/mcp/web-pages.js';

const SPEC_TOOLS = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
];

interface ModuleOptions { failWebPages?: boolean; loads?: string[] }

const modulesWith = (options: ModuleOptions = {}): ClusterMeshModules =>
  ({
    load: async (id: string) => {
      options.loads?.push(id);
      if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
      if (id === 'mcp/web-pages') {
        if (options.failWebPages === true) throw new Error('artifacts peer absent');
        return import('@sentropic/artifacts/mcp');
      }
      throw new Error(`unexpected module load in web-pages spec: ${id}`);
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
    builtins: [createWebPagesBuiltin({ modules, definition: { app: fakeApp } })],
  });
  facade.register(localImmo());
  return facade;
}

describe('web-pages mesh leaf', () => {
  it('catalogues sentropic.web-pages with the 15 artifacts tools', () => {
    const facade = facadeWith();
    const entry = facade.catalog().find((item) => item.providerId === 'sentropic.web-pages');
    expect(entry).toMatchObject({
      providerId: 'sentropic.web-pages',
      version: '0.1.0',
      capabilities: SPEC_TOOLS,
      availability: 'not-selected',
    });
  });

  it('compiles web-pages beside a local provider through the kernel', async () => {
    const facade = facadeWith();
    facade.select(['immo', 'sentropic.web-pages']);
    facade.configure('sentropic.web-pages', { defaultStorageScopeId: 'scope-1' });
    const builtin = createWebPagesBuiltin({ modules: modulesWith(), definition: { app: fakeApp } });
    const definition = await builtin.load();
    const compiled = await facade.compile({
      bindings: {},
      compatibility: {
        immo: { manifestDigest: computeManifestDigest(IMMO_MANIFEST) },
        'sentropic.web-pages': { manifestDigest: computeManifestDigest(definition.manifest) },
      },
    });
    if (!compiled.ok) throw new Error(`compile refused: ${JSON.stringify(compiled.diagnostics)}`);
    expect(compiled.registry.resolveTool('immo_search')?.providerId).toBe('immo');
    for (const name of SPEC_TOOLS) {
      expect(compiled.registry.resolveTool(name)?.providerId, name).toBe('sentropic.web-pages');
    }
    const entry = facade.catalog().find((item) => item.providerId === 'sentropic.web-pages');
    expect(entry?.availability).toBe('available');
  });

