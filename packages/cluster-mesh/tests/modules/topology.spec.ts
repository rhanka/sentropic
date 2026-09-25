import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as root from '../../src/index.js';
import {
  inspectTopology, isClusterMeshTopologyError, normalizeModuleUrl, registerClusterMeshInstance, type ClusterMeshInstanceEntry,
} from '../../src/modules/topology.js';
import { evaluations, fakeGateway, fakeMesh, PackageTree } from '../fixtures/package-tree.js';

const INSTANCES = Symbol.for('@sentropic/cluster-mesh/instances');
const registry = () => (globalThis as unknown as Record<symbol, ClusterMeshInstanceEntry[]>)[INSTANCES]!;

let tree: PackageTree;
let anchorDir: string;
let self: ClusterMeshInstanceEntry;

beforeEach(() => {
  tree = new PackageTree();
  evaluations().length = 0;
  const clusterDir = tree.install('app', { name: '@sentropic/cluster-mesh', version: '0.13.0' });
  anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
  self = { token: Symbol('self'), moduleUrl: pathToFileURL(join(clusterDir, 'dist/modules/topology.js')).href };
});
afterEach(() => tree.cleanup());

const inspect = (instances: readonly ClusterMeshInstanceEntry[], strict = false, require?: ('llm-mesh' | 'gateway')[]) =>
  inspectTopology({ anchorDir, instances, strict, ...(require ? { require } : {}) });

function thrown(run: () => unknown): { code?: string; reason?: string; paths?: string[]; message: string } {
  try {
    run();
  } catch (error) {
    return error as never;
  }
  throw new Error('expected a topology refusal');
}

describe('cluster-mesh topology guard', () => {
  it('should pass a single coherent tree without evaluating providers', () => {
    const meshDir = tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw'));
    const report = inspect([self], true, ['llm-mesh', 'gateway']);
    expect(report.llmMesh?.path).toBe(meshDir);
    expect(report.gateway).toMatchObject({ version: '0.19.0', llmMesh: { path: meshDir } });
    expect(report.instances).toEqual([{ path: join(tree.root, 'app/node_modules/@sentropic/cluster-mesh'), version: '0.13.0' }]);
    expect(evaluations()).toEqual([]);
  });

  it('should refuse two copies evaluated through distinct link paths sharing one realpath', () => {
    // --preserve-symlinks / npm link: each link path is its own module URL and evaluation.
    const clusterDir = join(tree.root, 'app/node_modules/@sentropic/cluster-mesh');
    tree.link('runtime', '@sentropic/cluster-mesh', clusterDir);
    const linkUrl = pathToFileURL(join(tree.root, 'runtime/node_modules/@sentropic/cluster-mesh/dist/modules/topology.js')).href;
    const registered: ClusterMeshInstanceEntry[] = [];
    registerClusterMeshInstance(registered, self);
    registerClusterMeshInstance(registered, { token: Symbol('preserve-symlinks copy'), moduleUrl: linkUrl });
    expect(registered).toHaveLength(2);
    const error = thrown(() => inspect(registered));
    expect(isClusterMeshTopologyError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'cluster_mesh_topology_invalid', reason: 'duplicate_instance' });
    expect(error.paths).toHaveLength(2);
    expect(error.paths![0]).toBe(error.paths![1]);
  });

  it('should replace, not add, a re-evaluation of the same file URL (query and hash ignored)', () => {
    const registered: ClusterMeshInstanceEntry[] = [];
    registerClusterMeshInstance(registered, self);
    registerClusterMeshInstance(registered, { token: Symbol('hmr'), moduleUrl: `${self.moduleUrl}?t=1695000000000` });
    registerClusterMeshInstance(registered, { token: Symbol('hash'), moduleUrl: `${self.moduleUrl}#reload` });
    expect(registered).toHaveLength(1);
    expect(normalizeModuleUrl(registered[0]!.moduleUrl)).toBe(self.moduleUrl);
    expect(() => inspect(registered)).not.toThrow();
  });

  it('should refuse physically distinct copies and name both paths', () => {
    const other = tree.install('runtime', { name: '@sentropic/cluster-mesh', version: '0.9.0' });
    const copy = { token: Symbol('copy'), moduleUrl: pathToFileURL(join(other, 'dist/index.js')).href };
    const error = thrown(() => inspect([self, copy]));
    expect(error.message).toContain(`${other}@0.9.0`);
    expect(error.message).toContain('@0.13.0');
  });

  it('should refuse divergent llm-mesh realpaths from cluster-mesh and gateway', () => {
    const shared = tree.install('app', fakeMesh('mesh'));
    const nested = tree.install('app/node_modules/@sentropic/llm-gateway', fakeMesh('nested'));
    tree.install('app', fakeGateway('gw'));
    const error = thrown(() => inspect([self]));
    expect(error).toMatchObject({ reason: 'divergent_llm_mesh', paths: [shared, nested] });
    expect(evaluations()).toEqual([]);
  });

  it('should check versions and requirements only in the explicit preflight', () => {
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw', '0.18.0'));
    expect(() => inspect([self])).not.toThrow();
    expect(thrown(() => inspect([self], true))).toMatchObject({ reason: 'incompatible_version' });
    tree.cleanup();
    tree = new PackageTree();
    tree.install('app', { name: '@sentropic/cluster-mesh', version: '0.13.0' });
    anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
    expect(() => inspect([self], true)).not.toThrow();
    expect(thrown(() => inspect([self], true, ['gateway']))).toMatchObject({ reason: 'not_installed' });
  });

  it('should not self-report a re-evaluated copy (vi.resetModules, query variant)', async () => {
    expect(registry()).toHaveLength(1);
    await import('../../src/modules/topology-guard.js');
    vi.resetModules();
    const fresh = await import('../../src/modules/topology.js');
    await import('../../src/modules/topology.js?hmr=1');
    await expect(import('../../src/modules/topology-guard.js?hmr=2')).resolves.toBeDefined();
    expect(registry()).toHaveLength(1);
    expect(() => fresh.verifyClusterMeshTopology()).not.toThrow();
    expect(() => root.verifyClusterMeshTopology()).not.toThrow();
  });

  it('should make a physically distinct copy fail its guarded import with the code', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'cluster-mesh-copy-'));
    cpSync(fileURLToPath(new URL('../../src/modules', import.meta.url)), copy, { recursive: true });
    const copyUrl = pathToFileURL(copy).href;
    try {
      const error = await import(pathToFileURL(join(copy, 'topology-guard.ts')).href).catch((caught: unknown) => caught);
      expect(registry()).toHaveLength(2);
      expect(error).toMatchObject({ code: 'cluster_mesh_topology_invalid', reason: 'duplicate_instance' });
      expect(() => root.verifyClusterMeshTopology()).toThrow(/duplicate_instance/u);
    } finally {
      const entries = registry();
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]!.moduleUrl.startsWith(copyUrl)) entries.splice(index, 1);
      }
      rmSync(copy, { recursive: true, force: true });
    }
    expect(() => root.verifyClusterMeshTopology()).not.toThrow();
  });
});
