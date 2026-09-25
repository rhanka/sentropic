import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as root from '../../src/index.js';
import { inspectTopology, isClusterMeshTopologyError, type ClusterMeshInstanceEntry } from '../../src/modules/topology.js';
import { evaluations, fakeGateway, fakeMesh, PackageTree } from '../fixtures/package-tree.js';

const INSTANCES = Symbol.for('@sentropic/cluster-mesh/instances');
const registry = () => (globalThis as unknown as Record<symbol, ClusterMeshInstanceEntry[]>)[INSTANCES]!;

let tree: PackageTree;
let anchorDir: string;
let self: ClusterMeshInstanceEntry;

beforeEach(() => {
  tree = new PackageTree();
  evaluations().length = 0;
  const clusterDir = tree.install('app', { name: '@sentropic/cluster-mesh', version: '0.12.0' });
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
    expect(report.gateway).toMatchObject({ version: '0.18.0', llmMesh: { path: meshDir } });
    expect(report.instances).toEqual([{ path: join(tree.root, 'app/node_modules/@sentropic/cluster-mesh'), version: '0.12.0' }]);
    expect(evaluations()).toEqual([]);
  });

  it('should refuse two evaluated copies even when they share one realpath', () => {
    const error = thrown(() => inspect([self, { ...self, token: Symbol('preserve-symlinks copy') }]));
    expect(isClusterMeshTopologyError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'cluster_mesh_topology_invalid', reason: 'duplicate_instance' });
    expect(error.paths).toHaveLength(2);
    expect(error.paths![0]).toBe(error.paths![1]);
  });

  it('should refuse physically distinct copies and name both paths', () => {
    const other = tree.install('runtime', { name: '@sentropic/cluster-mesh', version: '0.9.0' });
    const copy = { token: Symbol('copy'), moduleUrl: pathToFileURL(join(other, 'dist/index.js')).href };
    const error = thrown(() => inspect([self, copy]));
    expect(error.message).toContain(`${other}@0.9.0`);
    expect(error.message).toContain('@0.12.0');
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
    tree.install('app', fakeGateway('gw', '0.17.1'));
    expect(() => inspect([self])).not.toThrow();
    expect(thrown(() => inspect([self], true))).toMatchObject({ reason: 'incompatible_version' });
    tree.cleanup();
    tree = new PackageTree();
    tree.install('app', { name: '@sentropic/cluster-mesh', version: '0.12.0' });
    anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
    expect(() => inspect([self], true)).not.toThrow();
    expect(thrown(() => inspect([self], true, ['gateway']))).toMatchObject({ reason: 'not_installed' });
  });

  it('should make a second evaluated copy fail its guarded import with the code', async () => {
    const before = registry().length;
    expect(before).toBe(1);
    expect(() => root.verifyClusterMeshTopology()).not.toThrow();
    await import('../../src/modules/topology-guard.js');
    await import('../../src/modules/topology.js?second-copy');
    try {
      expect(registry()).toHaveLength(2);
      const error = await import('../../src/modules/topology-guard.js?second-guard').catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'cluster_mesh_topology_invalid', reason: 'duplicate_instance' });
      expect(() => root.verifyClusterMeshTopology()).toThrow(/duplicate_instance/u);
    } finally {
      registry().splice(1);
    }
    expect(() => root.verifyClusterMeshTopology()).not.toThrow();
  });
});
