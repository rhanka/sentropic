import { describe, expect, it } from 'vitest';
import { createClusterMeshModules } from '../../src/index.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { isClusterMeshModuleUnavailableError } from '../../src/modules/errors.js';
import { fakeMesh, PackageTree } from '../fixtures/package-tree.js';
import * as meshJudgeProvider from '@sentropic/llm-mesh/judge';
import * as meshJudgeHostProvider from '@sentropic/llm-mesh/judge/host';
import * as meshJevTransportProvider from '@sentropic/llm-mesh/transport/jev';
import { loadLlmMeshJudge } from '../../src/loaders/llm-mesh/judge.js';
import { loadLlmMeshJudgeHost } from '../../src/loaders/llm-mesh/judge/host.js';
import { loadLlmMeshJevTransport } from '../../src/loaders/llm-mesh/transport/jev.js';

describe('judge module loading', () => {
  it('probes and loads llm-mesh/judge from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/judge']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/judge']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/judge')) as typeof meshJudgeProvider;
    expect(typeof loaded.createRemoteJudgeClient).toBe('function');
    expect(loaded.createRemoteJudgeClient).toBe(meshJudgeProvider.createRemoteJudgeClient);
    const loadedByLoader = await loadLlmMeshJudge(modules);
    expect(loadedByLoader.createRemoteJudgeClient).toBe(meshJudgeProvider.createRemoteJudgeClient);
    expect(modules.snapshot()['llm-mesh/judge']).toMatchObject({ state: 'loaded' });
  });

  it('probes and loads llm-mesh/judge/host from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/judge/host']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/judge/host')) as typeof meshJudgeHostProvider;
    expect(typeof loaded.createJudgeService).toBe('function');
    expect(typeof loaded.createJevAdapter).toBe('function');
    expect(typeof loaded.jevDescriptor).toBe('object');
    expect(loaded.createJudgeService).toBe(meshJudgeHostProvider.createJudgeService);
    expect(loaded.jevDescriptor).toBe(meshJudgeHostProvider.jevDescriptor);
    const loadedByLoader = await loadLlmMeshJudgeHost(modules);
    expect(loadedByLoader.createJudgeService).toBe(meshJudgeHostProvider.createJudgeService);
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({ state: 'loaded' });
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
    const modules = createClusterMeshModules({ disabled: ['llm-mesh/judge', 'llm-mesh/judge/host', 'llm-mesh/transport/jev'] });
    expect(modules.isEnabled('llm-mesh/judge')).toBe(false);
    expect(modules.isEnabled('llm-mesh/judge/host')).toBe(false);
    expect(modules.isEnabled('llm-mesh/transport/jev')).toBe(false);
    for (const [id, loader] of [
      ['llm-mesh/judge', loadLlmMeshJudge],
      ['llm-mesh/judge/host', loadLlmMeshJudgeHost],
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

  it('refuses with export_unavailable when llm-mesh lacks judge exports', async () => {
    const tree = new PackageTree();
    try {
      const anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
      tree.install('app', fakeMesh('mesh', '0.22.0'));
      const modules = createModuleRegistry({}, { anchorDir });
      for (const [id, loader] of [
        ['llm-mesh/judge', loadLlmMeshJudge],
        ['llm-mesh/judge/host', loadLlmMeshJudgeHost],
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
