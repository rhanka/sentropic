import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngramMemoryBuiltin } from '../src/integrations/mcp/memory.js';
import { loadEngramMemoryMcp } from '../src/loaders/mcp/memory.js';
import { createModuleRegistry } from '../src/modules/registry.js';
import { createMcpRegistry } from '../src/mcp/registry.js';
import type { ClusterMeshModules } from '../src/modules/contracts.js';
import { evaluations, moduleSource, PackageTree } from './fixtures/package-tree.js';

let tree: PackageTree;
let anchorDir: string;
beforeEach(() => {
  tree = new PackageTree();
  anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
  evaluations().length = 0;
});
afterEach(() => tree.cleanup());
const modules = () => createModuleRegistry({}, { anchorDir });
const definition = {} as Parameters<typeof createEngramMemoryBuiltin>[0]['definition'];

describe('engram memory builtin', () => {
  it('should list static metadata without resolving the optional peer or opening storage', async () => {
    const calls: string[] = [];
    const registryModules = {
      load: async (id: string) => {
        calls.push(id);
        if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
        throw new Error('an unselected memory peer must not load');
      },
    } as unknown as ClusterMeshModules;
    const builtin = createEngramMemoryBuiltin({ modules: registryModules, definition });
    const registry = createMcpRegistry({ modules: registryModules, builtins: [builtin] });
    expect(registry.catalog()[0]).toMatchObject({
      providerId: 'sentropic.engram.memory', version: '1.0.0', availability: 'not-selected',
      capabilities: ['engram_memory_search', 'engram_memory_get', 'engram_memory_capture',
        'engram_memory_request_admission', 'engram_memory_withdraw', 'engram_memory_forget'],
    });
    expect(calls).toEqual([]);
    registry.select([]);
    expect((await registry.compile({ bindings: {}, compatibility: {} })).ok).toBe(true);
    expect(calls).toEqual(['mcp-platform/registry']);
  });

  it.each(['absent', 'incompatible', 'partial'] as const)(
    'should refuse selected compilation atomically when the engram peer is %s', async (state) => {
      if (state !== 'absent') tree.install('app', {
        name: '@sentropic/engram', version: state === 'incompatible' ? '0.21.3' : '0.22.0',
        exports: { './mcp-memory': { source: moduleSource('engram', []) } },
      });
      const peerModules = modules();
      const registryModules = {
        load: (id: Parameters<ClusterMeshModules['load']>[0]) => id === 'mcp-platform/registry'
          ? import('@sentropic/mcp-platform/registry') : peerModules.load(id),
      } as ClusterMeshModules;
      const registry = createMcpRegistry({ modules: registryModules,
        builtins: [createEngramMemoryBuiltin({ modules: registryModules, definition })] });
      registry.select(['sentropic.engram.memory']);
      const result = await registry.compile({ bindings: {}, compatibility: {} });
      expect(result.ok).toBe(false);
      expect(registry.compiled()).toBeUndefined();
      if (!result.ok) expect(result.diagnostics[0]?.path).toContain('.loader');
      if (state !== 'partial') expect(evaluations()).toEqual([]);
    });

  it('should refuse the qualified loader before evaluating an incompatible peer', async () => {
    tree.install('app', { name: '@sentropic/engram', version: '0.21.3',
      exports: { './mcp-memory': { source: moduleSource('engram', []) } } });
    await expect(loadEngramMemoryMcp(modules())).rejects.toMatchObject({
      code: 'cluster_mesh_module_unavailable', reason: 'incompatible_version',
    });
    expect(evaluations()).toEqual([]);
  });
});
