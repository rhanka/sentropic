import { describe, expect, it, vi } from 'vitest';
import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { computeManifestDigest } from '@sentropic/cluster-mesh/mcp/registry';
import { ARTIFACTS_TOOL_DEFINITIONS, createArtifactsRegistryDefinition, compileArtifactsProfile,
  RADAR_ARTIFACTS_PROFILE, type ArtifactsDefinitionOptions } from '@sentropic/artifacts/mcp';
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
    configurations: { 'sentropic.artifacts': {} }, bindings: {}, compatibility: {
      'sentropic.artifacts': { manifestDigest: 'bb75197ab5101938bebe8637f0abd5a03a5a1a848563b6a7e72249c84c1eddd1' },
    } };
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
    expect(input.artifacts.profile.profileDigest)
      .toBe('9d21623107192b42e683d4712c69093ed19f1498e406d199c4fe3153394cba11');
    const { manifest } = createArtifactsRegistryDefinition({ ...input.artifacts, invocationScope: 'mcp:tools:invoke' });
    expect(computeManifestDigest({ ...manifest, version: '0.2.5' }))
      .toBe('3158b20d0a89d508afff9468fddc4ac96ae0625e5cbe1f42244545cfd1674fb1');
    expect(computeManifestDigest({ ...manifest, version: '0.2.6' }))
      .toBe('1b646cd577d43bed4ec1a231d632c9180fc858bc4880db6e4641b07d2c0603e3');
    expect(computeManifestDigest({ ...manifest, version: '0.2.7' }))
      .toBe('b4f5d2adf7592a00793180f1dfd6bbb68c601954806f998dbe8683f5797699ca');
    expect(computeManifestDigest({ ...manifest, version: '0.2.8' }))
      .toBe('7c0379168b2d159c70d8c1fbc1462e7fcdf154fe356e5b57216ff4a87cc142b3');
    expect(computeManifestDigest({ ...manifest, version: '0.2.10' }))
      .toBe('0cbf1def8ccf9ac0958c84887102e2a0f12412005a58d53f2526a3bdbb59a659');
    expect(computeManifestDigest({ ...manifest, version: '0.2.13' }))
      .toBe('108f7c1975194ca4216cb36272626e9eab0c56165890182f69f4f3dc23f6adf9');
    expect(computeManifestDigest({ ...manifest, version: '0.2.14' }))
      .toBe('8e80ebf4648deb663d9924099345f6cf9413a03e8b5051a182db769693d3c618');
    expect(computeManifestDigest({ ...manifest, version: '0.2.15' }))
      .toBe('bb75197ab5101938bebe8637f0abd5a03a5a1a848563b6a7e72249c84c1eddd1');
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect([...result.registry.tools.keys()]).toEqual(names);
    expect([...result.registry.providers.keys()]).toEqual(['sentropic.artifacts']);
    for (const name of names) {
      const tool = result.registry.resolveTool(name)!;
      expect(tool.providerId).toBe('sentropic.artifacts');
      expect(tool.capabilityName).toBe(name);
      expect(tool.inputSchema).toEqual(ARTIFACTS_TOOL_DEFINITIONS[name].inputSchema);
      expect(tool.requiredScopes).toEqual(['mcp:tools:invoke']);
    }
    expect(result.registry.resolveTool('artifacts_promote')).toBeUndefined();
    expect(result.registry.resolveTool('artifacts-ensure')).toBeUndefined();
    expect(input.execute).not.toHaveBeenCalled();
    expect(input.createInvocation).not.toHaveBeenCalled();
  });

  it('should refuse the superseded artifacts 0.2.8 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      '96226d32f64ca7ac06749d5083084b6f572eac23d27256cae8d37e7f7579933d';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('should refuse the superseded artifacts 0.2.7 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      '1140dcb492f0d126b55ffc5dfb46accf43fc863145a42990a140e06c5bd02f20';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('should refuse the superseded artifacts 0.2.6 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      'c69c8ce188907fa3db602caa290e07ebcaffa9e63010aa47b73e1599b36149ed';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('should refuse the superseded artifacts 0.2.4 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      '020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('should refuse the superseded artifacts 0.2.1 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      'ccf8a4ddd9365537741eb0550efa49954d86a0c2d1ee808fb18ca81ef7090e9a';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('should refuse a missing artifacts compatibility receipt without exposing a registry', async () => {
    const result = await compileAppMcpRegistry({ ...fixture(), compatibility: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('missing_compatibility');
    expect(result).not.toHaveProperty('registry');
  });

  it('should refuse the superseded artifacts 0.2.3 compatibility receipt', async () => {
    const input = fixture();
    input.compatibility['sentropic.artifacts'].manifestDigest =
      '80ca4b067a010690dc71036a3237a70b91d99d7c025ded7173566d0ae55b1600';
    const result = await compileAppMcpRegistry(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('registry');
    expect(input.execute).not.toHaveBeenCalled();
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
      compatibility: { ...input.compatibility, 'app.local': { manifestDigest: computeManifestDigest(local.manifest) } } });
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

  // Reload last: artifacts rejects profiles crossing module instances after resetModules.
  it('should refuse an APP-P1 package schema drift with unchanged capability names and no receipt', async () => {
    const drift = { ...RADAR_ARTIFACTS_PROFILE, operations: RADAR_ARTIFACTS_PROFILE.operations.map((op) =>
      op.operation === 'list' ? { ...op, limits: { ...op.limits, listLimitMax: 99 } } : op) };
    vi.resetModules();
    vi.doMock('@sentropic/artifacts/mcp-core', async () => ({
      ...await vi.importActual('@sentropic/artifacts/mcp-core'), RADAR_ARTIFACTS_PROFILE: drift,
    }));
    try {
      const { compileArtifactsProfile: compile } = await import('@sentropic/artifacts/mcp-core');
      const compiled = compile(drift);
      const input = { ...fixture(), compatibility: {} };
      input.artifacts = { ...input.artifacts, profile: compiled,
        app: { ...input.artifacts.app, profileDigest: compiled.profileDigest, selectedCapabilities: compiled.selectedCapabilities } };
      expect(compiled.selectedCapabilities).toEqual(profile().selectedCapabilities);
      expect(compiled.schemas.artifacts_list).not.toEqual(profile().schemas.artifacts_list);
      const { compileAppMcpRegistry: compileRegistry } = await import('../../src/services/mcp/cluster-registry');
      await expect(compileRegistry(input)).rejects.toThrow(/frozen APP-P1/);
    } finally {
      vi.doUnmock('@sentropic/artifacts/mcp-core');
      vi.resetModules();
    }
  });
});
