/**
 * Lot 7 — mcp-platform loaders: acquire the platform kernel through the
 * module registry (never an eager import). Missing or incompatible
 * platforms refuse with the stable `cluster_mesh_module_unavailable` code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleRegistry } from '../../src/modules/registry.js';
import {
  loadMcpPlatformBridge,
  loadMcpPlatformEntry,
  loadMcpPlatformHono,
  loadMcpPlatformRegistry,
} from '../../src/loaders/mcp/index.js';
import {
  evaluations,
  moduleSource,
  PackageTree,
  type FakePackage,
} from '../fixtures/package-tree.js';

let tree: PackageTree;
let anchorDir: string;

beforeEach(() => {
  tree = new PackageTree();
  anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
  evaluations().length = 0;
});
afterEach(() => tree.cleanup());

const registry = () => createModuleRegistry({ disabled: [] as never }, { anchorDir });

function fakeMcpPlatform(version = '0.3.0'): FakePackage {
  return {
    name: '@sentropic/mcp-platform',
    version,
    exports: {
      './registry': { source: moduleSource('mcp-platform/registry', ['createProviderRegistry']) },
      './registry/entry': {
        source: moduleSource('mcp-platform/entry', ['buildRegistryEntry', 'resolveRegistryEntry']),
      },
      './transport/bridge': {
        source: moduleSource('mcp-platform/bridge', ['registerBridgeTools', 'identityFromExtra']),
      },
      './hono': { source: moduleSource('mcp-platform/hono', ['createMcpPlatformHono']) },
    },
  };
}

describe('mcp-platform loaders', () => {
  it('resolves nothing at construction and loads the registry on demand', async () => {
    tree.install('app', fakeMcpPlatform());
    const modules = registry();
    expect(modules.snapshot()['mcp-platform/registry']?.state).toBe('unprobed');
    expect(evaluations()).toEqual([]);
    const namespace = (await loadMcpPlatformRegistry(modules)) as {
      createProviderRegistry(): string;
    };
    expect(namespace.createProviderRegistry()).toBe('mcp-platform/registry:createProviderRegistry');
    expect(evaluations()).toEqual(['mcp-platform/registry']);
  });

  it('loads the entry subpath for canonical requests and arg mapping', async () => {
    tree.install('app', fakeMcpPlatform());
    const modules = registry();
    const namespace = (await loadMcpPlatformEntry(modules)) as {
      resolveRegistryEntry(): string;
    };
    expect(namespace.resolveRegistryEntry()).toBe('mcp-platform/entry:resolveRegistryEntry');
  });

  it('loads the bridge and hono leaves through the same catalog', async () => {
    tree.install('app', fakeMcpPlatform());
    const modules = registry();
    const bridge = (await loadMcpPlatformBridge(modules)) as {
      registerBridgeTools(): string;
    };
    expect(bridge.registerBridgeTools()).toBe('mcp-platform/bridge:registerBridgeTools');
    const hono = (await loadMcpPlatformHono(modules)) as {
      createMcpPlatformHono(): string;
    };
    expect(hono.createMcpPlatformHono()).toBe('mcp-platform/hono:createMcpPlatformHono');
  });

  it('refuses a missing platform with the stable code', async () => {
    const modules = registry();
    const failure = loadMcpPlatformRegistry(modules);
    await expect(failure).rejects.toThrow(
      'Cluster Mesh module "mcp-platform/registry" is unavailable (not_installed). Install @sentropic/mcp-platform@">=0.3.0 <0.4.0" and restart.',
    );
    const error = await failure.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'not_installed' });
    expect(evaluations()).toEqual([]);
  });

  it('refuses an incompatible platform version', async () => {
    tree.install('app', fakeMcpPlatform('0.2.0'));
    const modules = registry();
    await expect(loadMcpPlatformRegistry(modules)).rejects.toMatchObject({
      code: 'cluster_mesh_module_unavailable',
      reason: 'incompatible_version',
    });
  });
});
