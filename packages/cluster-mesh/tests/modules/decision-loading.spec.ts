import { describe, expect, it } from 'vitest';
import { createClusterMeshModules } from '../../src/index.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { isClusterMeshModuleUnavailableError } from '../../src/modules/errors.js';
import { fakeMesh, PackageTree } from '../fixtures/package-tree.js';
import * as meshDecisionProvider from '@sentropic/llm-mesh/decision';
import * as meshDecisionHostProvider from '@sentropic/llm-mesh/decision/host';
import * as meshJevTransportProvider from '@sentropic/llm-mesh/transport/jev';
import { loadLlmMeshDecision } from '../../src/loaders/llm-mesh/decision.js';
import { loadLlmMeshDecisionHost } from '../../src/loaders/llm-mesh/decision/host.js';
import { loadLlmMeshJevTransport } from '../../src/loaders/llm-mesh/transport/jev.js';

describe('decision module loading', () => {
  it('probes and loads llm-mesh/decision from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/decision']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/decision']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/decision')) as typeof meshDecisionProvider;
    expect(typeof loaded.createRemoteDecisionClient).toBe('function');
    expect(typeof loaded.validateDecisionResult).toBe('function');
    expect(loaded.createRemoteDecisionClient).toBe(meshDecisionProvider.createRemoteDecisionClient);
    expect(loaded.validateDecisionResult).toBe(meshDecisionProvider.validateDecisionResult);
    const loadedByLoader = await loadLlmMeshDecision(modules);
    expect(loadedByLoader.createRemoteDecisionClient).toBe(meshDecisionProvider.createRemoteDecisionClient);
    expect(loadedByLoader.validateDecisionResult).toBe(meshDecisionProvider.validateDecisionResult);
    expect(modules.snapshot()['llm-mesh/decision']).toMatchObject({ state: 'loaded' });
  });

  it('probes and loads llm-mesh/decision/host from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/decision/host']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/decision/host']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/decision/host')) as typeof meshDecisionHostProvider;
    expect(typeof loaded.createDecisionService).toBe('function');
    expect(typeof loaded.createJevAdapter).toBe('function');
    expect(typeof loaded.jevDescriptor).toBe('object');
    expect(loaded.createDecisionService).toBe(meshDecisionHostProvider.createDecisionService);
    expect(loaded.jevDescriptor).toBe(meshDecisionHostProvider.jevDescriptor);
    const loadedByLoader = await loadLlmMeshDecisionHost(modules);
    expect(loadedByLoader.createDecisionService).toBe(meshDecisionHostProvider.createDecisionService);
    expect(modules.snapshot()['llm-mesh/decision/host']).toMatchObject({ state: 'loaded' });
  });

  it('probes and loads llm-mesh/transport/jev from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/transport/jev']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/transport/jev']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/transport/jev')) as typeof meshJevTransportProvider;
    expect(typeof loaded.createJevTransport).toBe('function');
    expect(loaded.createJevTransport).toBe(meshJevTransportProvider.createJevTransport);
    const loadedByLoader = await loadLlmMeshJevTransport(modules);
    expect(loadedByLoader.createJevTransport).toBe(meshJevTransportProvider.createJevTransport);
    expect(modules.snapshot()['llm-mesh/transport/jev']).toMatchObject({ state: 'loaded' });
  });

  it('fails with unavailable when disabled', async () => {
    const modules = createClusterMeshModules({ disabled: ['llm-mesh/decision', 'llm-mesh/decision/host', 'llm-mesh/transport/jev'] });
    expect(modules.isEnabled('llm-mesh/decision')).toBe(false);
    expect(modules.isEnabled('llm-mesh/decision/host')).toBe(false);
    expect(modules.isEnabled('llm-mesh/transport/jev')).toBe(false);
    for (const [id, loader] of [
      ['llm-mesh/decision', loadLlmMeshDecision],
      ['llm-mesh/decision/host', loadLlmMeshDecisionHost],
      ['llm-mesh/transport/jev', loadLlmMeshJevTransport],
    ] as const) {
      const err1 = await modules.load(id).catch((e: unknown) => e);
      expect(isClusterMeshModuleUnavailableError(err1)).toBe(true);
      expect(err1).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'disabled', moduleId: id });

      const err2 = await loader(modules).catch((e: unknown) => e);
      expect(isClusterMeshModuleUnavailableError(err2)).toBe(true);
      expect(err2).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'disabled', moduleId: id });
    }
  });

  it('refuses with export_unavailable when llm-mesh lacks decision exports', async () => {
    const tree = new PackageTree();
    try {
      const anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
      tree.install('app', fakeMesh('mesh', '0.22.0'));
      const modules = createModuleRegistry({}, { anchorDir });
      for (const [id, loader] of [
        ['llm-mesh/decision', loadLlmMeshDecision],
        ['llm-mesh/decision/host', loadLlmMeshDecisionHost],
        ['llm-mesh/transport/jev', loadLlmMeshJevTransport],
      ] as const) {
        const err1 = await modules.load(id).catch((e: unknown) => e);
        expect(isClusterMeshModuleUnavailableError(err1)).toBe(true);
        expect(err1).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'export_unavailable', moduleId: id });

        const err2 = await loader(modules).catch((e: unknown) => e);
        expect(isClusterMeshModuleUnavailableError(err2)).toBe(true);
        expect(err2).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'export_unavailable', moduleId: id });
      }
    } finally {
      tree.cleanup();
    }
  });
});
