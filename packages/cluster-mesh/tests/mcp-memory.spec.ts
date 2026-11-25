import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEngramMemoryBuiltin } from '../src/integrations/mcp/memory.js';
import { loadEngramMemoryMcp } from '../src/loaders/mcp/memory.js';
import { ENGRAM_MEMORY_RANGE, PROVIDER_CATALOG } from '../src/modules/catalog.js';
import { createModuleRegistry } from '../src/modules/registry.js';
import { satisfiesRange } from '../src/modules/semver.js';
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

  it('should refuse a split engine instance before opening a canonical store', async () => {
    const mcp = await import('@sentropic/engram/mcp-memory');
    const substrate = await import('@sentropic/engram/memory-substrate');
    let opened = 0;
    const splitModules = { load: async (id: string) => {
      if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
      if (id === 'mcp/memory') return mcp;
      if (id === 'engram-memory/substrate') return { ...substrate,
        createMemoryPortV2: () => { throw new Error('separate engine'); },
        openModuleStorageCanonicalMemoryStoreV1: () => { opened++; throw new Error('must not open'); } };
      throw new Error(`unexpected module ${id}`);
    } } as unknown as ClusterMeshModules;
    const registry = createMcpRegistry({ modules: splitModules,
      builtins: [createEngramMemoryBuiltin({ modules: splitModules, definition })] });
    registry.select(['sentropic.engram.memory']);
    const result = await registry.compile({ bindings: {}, compatibility: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain('engine/provenance instance');
    expect(opened).toBe(0);
    expect(registry.compiled()).toBeUndefined();
  });

  it('should align the catalog engram peer range with package.json across 0.22.0..0.28.x', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(ENGRAM_MEMORY_RANGE).toBe('>=0.22.0 <0.29.0');
    expect(ENGRAM_MEMORY_RANGE).toBe(manifest.peerDependencies['@sentropic/engram']);
    expect(PROVIDER_CATALOG['mcp/memory'].range).toBe(ENGRAM_MEMORY_RANGE);
    expect(PROVIDER_CATALOG['engram-memory/substrate'].range).toBe(ENGRAM_MEMORY_RANGE);
    for (const v of ['0.22.0', '0.23.0', '0.27.0', '0.28.0', '0.28.9']) {
      expect(satisfiesRange(v, ENGRAM_MEMORY_RANGE), v).toBe(true);
    }
    for (const v of ['0.21.3', '0.29.0']) {
      expect(satisfiesRange(v, ENGRAM_MEMORY_RANGE), v).toBe(false);
    }
  });
});
