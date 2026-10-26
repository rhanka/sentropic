import { describe, expect, it, vi } from 'vitest';
import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { computeManifestDigest } from '@sentropic/cluster-mesh/mcp/registry';
import { createArtifactsRegistryDefinition, compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE,
  type ArtifactsDefinitionOptions } from '@sentropic/artifacts/mcp';
import { compileAppMcpRegistry } from '../../src/services/mcp/cluster-registry';

const names = ['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish'] as const;
const profile = () => compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
function fixture() {
  const compiled = profile();
  const execute = vi.fn(async () => ({ ok: true as const, result: { status: 200, body: {} } }));
  const createInvocation = vi.fn(() => { throw new Error('Compilation must not bind identity'); });
  const artifacts: ArtifactsDefinitionOptions = {
    profile: compiled,
    app: { profileDigest: compiled.profileDigest, selectedCapabilities: compiled.selectedCapabilities, execute },
    createInvocation,
  };
  return { artifacts, execute, createInvocation, selection: ['sentropic.artifacts'],
    configurations: { 'sentropic.artifacts': {} }, bindings: {}, compatibility: {} };
}

function localFixture() {
  const input = fixture();
  const local = createArtifactsRegistryDefinition({ ...input.artifacts, invocationScope: 'mcp:tools:invoke' });
  if (!('toolValues' in local)) throw new Error('Expected a loaded local definition');
  local.manifest = { ...local.manifest, providerId: 'app.local' };
  local.parameterSchema = { properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['limit'] };
  return { ...input, registrations: [local], selection: ['app.local'],
    configurations: { 'app.local': { limit: 2 } },
    compatibility: { 'app.local': { manifestDigest: computeManifestDigest(local.manifest) } } };
}

describe('app MCP registry compilation', () => {
  it('should expose the exact APP-P1 names and schemas without invoking a host port', async () => {
    const input = fixture();
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect([...result.registry.tools.keys()]).toEqual(names);
    expect([...result.registry.providers.keys()]).toEqual(['sentropic.artifacts']);
    for (const name of names) {
      const tool = result.registry.resolveTool(name)!;
      expect(tool.providerId).toBe('sentropic.artifacts');
      expect(tool.capabilityName).toBe(name);
      expect(tool.inputSchema).toEqual(input.artifacts.profile.schemas[name]);
      expect(tool.requiredScopes).toEqual(['mcp:tools:invoke']);
    }
    expect(result.registry.resolveTool('artifacts_promote')).toBeUndefined();
    expect(result.registry.resolveTool('artifacts-ensure')).toBeUndefined();
    expect(input.execute).not.toHaveBeenCalled();
    expect(input.createInvocation).not.toHaveBeenCalled();
  });

  it('should expose nothing and not load artifacts when selection is explicitly empty', async () => {
    const modules = createClusterMeshModules({ disabled: ['mcp/artifacts'] });
    const result = await compileAppMcpRegistry({ ...fixture(), modules, selection: [], configurations: {} });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.registry.tools.size).toBe(0);
    expect(modules.snapshot()['mcp/artifacts'].state).toBe('unprobed');
  });

  it('should refuse omitted, unknown and duplicate selections', async () => {
    await expect(compileAppMcpRegistry({ ...fixture(), selection: undefined! })).rejects.toThrow(/selection/i);
    await expect(compileAppMcpRegistry({ ...fixture(), selection: ['missing'] })).rejects.toThrow(/unknown provider/);
    await expect(compileAppMcpRegistry({ ...fixture(), selection: ['sentropic.artifacts', 'sentropic.artifacts'] }))
      .rejects.toThrow(/duplicate/);
  });

  it('should refuse unknown or unselected configuration and invalid artifacts parameters', async () => {
    await expect(compileAppMcpRegistry({ ...fixture(), configurations: { missing: {} } }))
      .rejects.toThrow(/unknown provider/);
    await expect(compileAppMcpRegistry({ ...fixture(), selection: [] })).rejects.toThrow(/unselected/);
    const result = await compileAppMcpRegistry({ ...fixture(), configurations: { 'sentropic.artifacts': { extra: true } } });
    expect(result.ok).toBe(false);
  });

  it.each(['mcp-platform/registry', 'mcp/artifacts'] as const)(
    'should refuse an unavailable %s peer without executing the app', async (id) => {
      const input = fixture();
      const modules = createClusterMeshModules({ disabled: [id] });
      const compile = compileAppMcpRegistry({ ...input, modules });
      if (id === 'mcp-platform/registry') await expect(compile).rejects.toMatchObject({ code: 'cluster_mesh_module_unavailable' });
      else expect((await compile).ok).toBe(false);
      expect(input.execute).not.toHaveBeenCalled();
      expect(input.createInvocation).not.toHaveBeenCalled();
    });

  it('should refuse collisions with a selected local provider atomically', async () => {
    const input = fixture();
    const local = createArtifactsRegistryDefinition(input.artifacts);
    local.manifest = { ...local.manifest, providerId: 'app.local' };
    const result = await compileAppMcpRegistry({ ...input, registrations: [local],
      selection: ['sentropic.artifacts', 'app.local'],
      compatibility: { 'app.local': { manifestDigest: computeManifestDigest(local.manifest) } } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_tool' })]));
      expect(result).not.toHaveProperty('registry');
    }
  });

  it('should refuse another profile or app/profile mismatch before compilation', async () => {
    const input = fixture();
    const reduced = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: ['artifacts_list'] });
    await expect(compileAppMcpRegistry({ ...input, artifacts: { ...input.artifacts, profile: reduced } }))
      .rejects.toThrow(/APP-P1/);
    await expect(compileAppMcpRegistry({ ...input,
      artifacts: { ...input.artifacts, app: { ...input.artifacts.app, profileDigest: 'tampered' } } }))
      .rejects.toThrow(/app\/profile mismatch/);
    await expect(compileAppMcpRegistry({ ...input,
      artifacts: { ...input.artifacts, invocationScope: 'weaker' } }))
      .rejects.toThrow(/invocation scope/i);
  });

  it('should refuse duplicate registrations of the artifacts provider', async () => {
    const input = fixture();
    await expect(compileAppMcpRegistry({ ...input,
      registrations: [createArtifactsRegistryDefinition(input.artifacts)] })).rejects.toThrow(/duplicate/);
  });

  it('should refuse a missing local port and compile only when it is supplied', async () => {
    const input = fixture();
    const local = createArtifactsRegistryDefinition(input.artifacts);
    local.manifest = { ...local.manifest, providerId: 'app.local' };
    local.requiredPorts = ['app.current-authority'];
    const options = { ...input, registrations: [local], selection: ['app.local'],
      configurations: { 'app.local': {} },
      compatibility: { 'app.local': { manifestDigest: computeManifestDigest(local.manifest) } } };
    const refused = await compileAppMcpRegistry(options);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.diagnostics[0].code).toBe('missing_binding');
    const accepted = await compileAppMcpRegistry({ ...options, bindings: { 'app.current-authority': {} } });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect([...accepted.registry.providers.keys()]).toEqual(['app.local']);
      expect(accepted.registry.resolveTool('artifacts_list')?.providerId).toBe('app.local');
    }
  });

  it.each([{}, { limit: 0 }, { limit: '2' }, { limit: 2, extra: true }])(
    'should refuse invalid local parameter values %j', async (values) => {
      const result = await compileAppMcpRegistry({ ...localFixture(), configurations: { 'app.local': values } });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('registry');
    });

  it('should preserve a valid generation when another configuration compiles or refuses', async () => {
    const input = localFixture();
    const first = await compileAppMcpRegistry(input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
    const bytes = JSON.stringify([...first.registry.tools]);
    input.configurations['app.local'].limit = 3;
    const second = await compileAppMcpRegistry(input);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.registry.providers.get('app.local')!.values).toEqual({ limit: 3 });
    input.configurations['app.local'].limit = 11;
    expect((await compileAppMcpRegistry(input)).ok).toBe(false);
    expect(first.registry.providers.get('app.local')!.values).toEqual({ limit: 2 });
    expect(JSON.stringify([...first.registry.tools])).toBe(bytes);
  });

  it('should refuse missing receipts and schema changes after local approval', async () => {
    const input = localFixture();
    const missing = await compileAppMcpRegistry({ ...input, compatibility: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0].code).toBe('missing_compatibility');
    const tool = input.registrations[0].manifest.tools[0];
    tool.inputSchema = { type: 'object', additionalProperties: true };
    const changed = await compileAppMcpRegistry(input);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.diagnostics[0].code).toBe('compatibility_mismatch');
  });

  it('should refuse weakened local policy and a stale explicit APP-P1 receipt', async () => {
    const input = localFixture();
    input.registrations[0].toolValues.artifacts_ensure.policy = { requiredScopes: [] };
    const weakened = await compileAppMcpRegistry(input);
    expect(weakened.ok).toBe(false);
    if (!weakened.ok) expect(weakened.diagnostics[0].code).toBe('policy_weakening');
    const stale = await compileAppMcpRegistry({ ...fixture(),
      compatibility: { 'sentropic.artifacts': { manifestDigest: 'stale' } } });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics[0].code).toBe('compatibility_mismatch');
  });
});
