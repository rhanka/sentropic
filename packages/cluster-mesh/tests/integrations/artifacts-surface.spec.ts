/**
 * L-5e — artifacts mesh leaf surface (spec-v8 §9 5e, review B3): the
 * `sentropic.artifacts` builtin is delivered through the qualified mesh
 * leaf, selected/configured like any provider, and compiled through the
 * one platform kernel beside a local provider. Unselected builtins never
 * load; loader failures refuse compilation atomically.
 */
import { describe, expect, it, vi } from 'vitest';
import * as artifacts from '@sentropic/artifacts/mcp';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { authorizeDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import type { ClusterMeshModules } from '../../src/modules/contracts.js';
import { createClusterMeshModules } from '../../src/modules/registry.js';
import { loadArtifactsMcp } from '../../src/loaders/mcp/artifacts.js';
import { createMcpRegistry } from '../../src/mcp/registry.js';
import { createArtifactsBuiltin } from '../../src/integrations/mcp/artifacts.js';
import * as storage from '../../src/storage/index.js';
import * as common from '../../src/storage/common-contract.js';

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
  it('should require the caller key in every idempotent tool schema', () => {
    for (const tool of artifacts.createArtifactsManifest().tools) {
      if (tool.idempotency.required) {
        expect(tool.inputSchema, tool.name).toHaveProperty('required', expect.arrayContaining(['idempotencyKey']));
      }
    }
  });

  it.each(['required', 'scope'])('should refuse inconsistent idempotency %s metadata', (field) => {
    const manifest = artifacts.createArtifactsManifest();
    const tool = manifest.tools.find((item) => item.name === 'artifacts_ensure')!;
    if (field === 'required') tool.inputSchema = { ...tool.inputSchema as object, required: [] };
    else tool.idempotency = { required: true, scope: 'tenant' };
    const factory = vi.spyOn(artifacts, 'createArtifactsManifest').mockReturnValue(manifest);
    try {
      expect(() => createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp } }))
        .toThrow(/idempotency/);
    } finally { factory.mockRestore(); }
  });

  it.each([
    { label: 'argument only', argument: 'caller-key', envelope: undefined, allowed: true },
    { label: 'equal envelope', argument: 'caller-key', envelope: 'caller-key', allowed: true },
    { label: 'conflicting envelope', argument: 'caller-key', envelope: 'other-key', allowed: false },
    { label: 'envelope only', argument: undefined, envelope: 'caller-key', allowed: false },
  ])('should enforce caller-key consistency for $label through compiled dispatch', async (test) => {
    const effects: unknown[] = [];
    const app = { handle: async (request: unknown) => {
      effects.push(request); return { status: 200, body: { ok: true } };
    } };
    const modules = createClusterMeshModules();
    const builtin = createArtifactsBuiltin({ modules, definition: { app } });
    const definition = await builtin.load();
    if ('kind' in definition) throw new Error('expected loaded definition');
    const facade = createMcpRegistry({ modules, builtins: [builtin] });
    facade.select(['sentropic.artifacts']);
    const compiled = await facade.compile({ bindings: {}, compatibility: {
      'sentropic.artifacts': { manifestDigest: computeManifestDigest(definition.manifest) },
    } });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.registry.resolveTool('artifacts_publish')?.entry.idempotency)
      .toEqual({ required: true, scope: 'principal' });
    const decision = authorizeDispatch({ registry: compiled.registry, toolName: 'artifacts_publish',
      principal: { sub: 'alice', clientId: 'host', scopes: [], claims: [] } });
    if (!decision.allowed) throw new Error(decision.code);
    const result = await definition.adapter.invokeTool({ capabilityRef: decision.capabilityName,
      input: { artifactId: 'artifact', files: [{ path: 'index.html', mimeType: 'text/html', text: 'hello' }],
        ...(test.argument === undefined ? {} : { idempotencyKey: test.argument }) },
      ...(test.envelope === undefined ? {} : { idempotencyKey: test.envelope }),
      ctx: { auditId: 'audit', principal: { sub: 'alice' } } as never });
    expect(result).toMatchObject(test.allowed ? { ok: true } : {
      ok: false, error: { code: 'invalid_request', retriable: false },
    });
    expect(effects).toHaveLength(test.allowed ? 1 : 0);
    if (test.allowed) expect(effects[0]).toMatchObject({ body: { idempotencyKey: test.argument } });
  });

  it('should materialize the definition only through the selected qualified loader', async () => {
    const factory = vi.spyOn(artifacts, 'createArtifactsRegistryDefinition');
    try {
      const modules = modulesWith({ failArtifacts: true });
      const builtin = createArtifactsBuiltin({ modules, definition: { app: fakeApp } });
      const facade = createMcpRegistry({ modules, builtins: [builtin] });
      facade.catalog();
      expect(factory).not.toHaveBeenCalled();
      facade.select(['sentropic.artifacts']);
      expect((await facade.compile({ bindings: {}, compatibility: {} })).ok).toBe(false);
      expect(factory).not.toHaveBeenCalled();
    } finally { factory.mockRestore(); }
  });

  it('should keep the common contract out of the storage runtime barrel', () => {
    expect(storage).not.toHaveProperty('validateCommonCapability');
  });

  it('should keep common read rights separate from publication and maintenance', () => {
    const capability = { principal: 'alice', rights: ['read'] as const,
      scope: { tenantId: 'tenant', workspaceId: 'workspace' }, policyRevision: 'policy-1' };
    expect(common.validateCommonCapability(capability).ok).toBe(true);
    expect(common.validateCommonCapability({ ...capability, rights: [] }).ok).toBe(false);
    expect(common.hasCommonRight(capability, 'read')).toBe(true);
    for (const right of ['prepare', 'publish', 'maintain'] as const) {
      expect(common.hasCommonRight(capability, right)).toBe(false);
    }
    const object = { id: 'object', locator: 'blob', byteLength: 1, sha256: 'a'.repeat(64) };
    expect(common.validateCommonObjectCommitment(object).ok).toBe(true);
    expect(common.validateCommonObjectCommitment({ ...object, sha256: `sha256:${object.sha256}` }).ok)
      .toBe(false);
  });

  it('should catalogue exactly the capabilities of the selected definition', async () => {
    const definition = artifacts.createArtifactsRegistryDefinition({ app: fakeApp });
    const selected = ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get'];
    definition.manifest = { ...definition.manifest,
      tools: definition.manifest.tools.filter((tool) => selected.includes(tool.name)) };
    if ('kind' in definition) throw new Error('expected loaded fixture');
    definition.handlers = Object.fromEntries(Object.entries(definition.handlers)
      .filter(([, handler]) => selected.includes(handler.capabilityRef)));
    definition.toolValues = Object.fromEntries(Object.entries(definition.toolValues)
      .filter(([name]) => selected.includes(name)));
    definition.adapter = { ...definition.adapter, manifest: definition.manifest,
      listCapabilities: async () => definition.manifest.tools };
    expect(Object.keys(definition.toolValues).sort()).toEqual([...selected].sort());
    expect(Object.values(definition.handlers).map((handler) => handler.capabilityRef).sort())
      .toEqual([...selected].sort());
    const facade = createMcpRegistry({ modules: createClusterMeshModules() });
    facade.register(definition);
    expect(facade.catalog()[0]?.capabilities).toEqual(selected);
    facade.select(['sentropic.artifacts']);
    const compiled = await facade.compile({ bindings: {}, compatibility: {
      'sentropic.artifacts': { manifestDigest: computeManifestDigest(definition.manifest) },
    } });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect([...compiled.registry.tools.keys()].sort()).toEqual([...selected].sort());
    expect((await definition.adapter.listCapabilities({ principalRef: 'alice', tenantRef: 'tenant',
      connectorInstanceId: 'artifacts' })).map((tool) => tool.name)).toEqual(selected);
  });

  it('should expose no capabilities when the selected definition is empty', () => {
    const definition = artifacts.createArtifactsRegistryDefinition({ app: fakeApp });
    definition.manifest = { ...definition.manifest, tools: [] };
    const factory = vi.spyOn(artifacts, 'createArtifactsManifest').mockReturnValue(definition.manifest);
    try {
      expect(createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp } })
        .capabilities).toEqual([]);
    } finally { factory.mockRestore(); }
  });

  it('should refuse a definition that changes after catalog construction', async () => {
    const definition = artifacts.createArtifactsRegistryDefinition({ app: fakeApp });
    const changed = { ...definition, manifest: { ...definition.manifest, tools: [] } };
    const factory = vi.spyOn(artifacts, 'createArtifactsRegistryDefinition').mockReturnValue(changed);
    try {
      const builtin = createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp } });
      await expect(builtin.load()).rejects.toThrow(/definition.*changed/);
    } finally { factory.mockRestore(); }
  });

  it('should refuse an artifacts common-rule admission claim', () => {
    expect(() => createArtifactsBuiltin({ modules: modulesWith(), definition: { app: fakeApp },
      commonRuleAdmission: true } as never)).toThrow(/common.rule/);
  });

  it('catalogues sentropic.artifacts with the 15 artifacts tools', () => {
    const facade = facadeWith();
    const entry = facade.catalog().find((item) => item.providerId === 'sentropic.artifacts');
    expect(entry).toMatchObject({
      providerId: 'sentropic.artifacts',
      version: '0.2.0',
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

  it('loads the compatible artifacts candidate through the real module registry', async () => {
    const modules = createClusterMeshModules();
    const artifacts = await loadArtifactsMcp(modules);
    expect(typeof artifacts.createArtifactsRegistryDefinition).toBe('function');
    expect(artifacts.ARTIFACTS_TOOL_NAMES).toEqual(SPEC_TOOLS);
  });
});
