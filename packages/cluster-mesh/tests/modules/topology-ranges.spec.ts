import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectTopology, type ClusterMeshInstanceEntry, type ClusterMeshLeafFamily } from '../../src/modules/topology.js';
import { evaluations, fakeGateway, fakeMesh, PackageTree } from '../fixtures/package-tree.js';

// Automatic leaf guard: accepted provider ranges, checked on the copies the leaf actually resolves.
let tree: PackageTree;
afterEach(() => tree.cleanup());
beforeEach(() => {
  tree = new PackageTree();
  evaluations().length = 0;
});

/** cluster-mesh installed under `<at>`; returns the guard input for one family. */
function cluster(at: string) {
  const dir = tree.install(at, { name: '@sentropic/cluster-mesh', version: '0.13.0' });
  const self: ClusterMeshInstanceEntry = { token: Symbol('self'), moduleUrl: pathToFileURL(join(dir, 'dist/modules/topology.js')).href };
  const anchorDir = tree.dir(`${at}/node_modules/@sentropic/cluster-mesh/dist/modules`);
  return (family: ClusterMeshLeafFamily) => () => inspectTopology({ anchorDir, instances: [self], strict: false, family });
}

function refusal(run: () => unknown): { code?: string; reason?: string; paths?: string[]; message: string } {
  try {
    run();
  } catch (error) {
    return error as never;
  }
  throw new Error('expected a topology refusal');
}

describe('automatic leaf guard ranges', () => {
  it('should pass the correct tuple for both families without evaluating providers', () => {
    const guard = cluster('app');
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw'));
    expect(guard('llm-mesh')).not.toThrow();
    expect(guard('gateway')).not.toThrow();
    expect(evaluations()).toEqual([]);
  });

  it('should refuse an out-of-range provider with the installed version and the required range', () => {
    const guard = cluster('app');
    const meshDir = tree.install('app', fakeMesh('mesh', '0.21.2'));
    const error = refusal(guard('llm-mesh'));
    expect(error).toMatchObject({ code: 'cluster_mesh_topology_invalid', reason: 'incompatible_version', paths: [meshDir] });
    expect(error.message).toBe('Cluster Mesh topology is invalid (incompatible_version): installed @sentropic/llm-mesh@0.21.2'
      + ` at ${meshDir} does not satisfy the required range ">=0.22.0 <0.23.0"`);
    expect(refusal(guard('gateway'))).toMatchObject({ reason: 'incompatible_version', paths: [meshDir] });
  });

  it('should check the gateway range only for the gateway family and ignore absent providers', () => {
    const guard = cluster('app');
    expect(guard('gateway')).not.toThrow();
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw', '0.18.0'));
    expect(guard('llm-mesh')).not.toThrow();
    expect(refusal(guard('gateway')).message).toContain('installed @sentropic/llm-gateway@0.18.0');
  });

  it('should check the copies cluster-mesh resolves from its own location, not the root ones', () => {
    const guard = cluster('app/node_modules/runtime');
    tree.install('app', fakeMesh('root-mesh', '0.21.2'));
    tree.install('app', fakeGateway('root-gw', '0.18.0'));
    tree.install('app/node_modules/runtime', fakeMesh('mesh', '0.22.1'));
    tree.install('app/node_modules/runtime', fakeGateway('gw', '0.19.0'));
    expect(guard('llm-mesh')).not.toThrow();
    expect(guard('gateway')).not.toThrow();
  });

  it('should refuse an out-of-range nested copy even when the root copy is in range', () => {
    const guard = cluster('app/node_modules/runtime');
    tree.install('app', fakeMesh('root-mesh'));
    tree.install('app', fakeGateway('root-gw'));
    const nested = tree.install('app/node_modules/runtime', fakeGateway('gw', '0.18.0'));
    expect(guard('llm-mesh')).not.toThrow();
    expect(refusal(guard('gateway'))).toMatchObject({ reason: 'incompatible_version', paths: [nested] });
  });

  it("should check the gateway's llm-mesh from the gateway's own location", () => {
    const guard = cluster('app');
    tree.install('app', fakeGateway('gw'));
    const gatewayMesh = tree.install('app/node_modules/@sentropic/llm-gateway', fakeMesh('private', '0.21.2'));
    expect(guard('llm-mesh')).toThrow(/incompatible_version/u);
    expect(refusal(guard('gateway'))).toMatchObject({ reason: 'incompatible_version', paths: [gatewayMesh] });
    tree.install('app/node_modules/@sentropic/llm-gateway', fakeMesh('private', '0.22.3'));
    expect(guard('gateway')).not.toThrow();
  });

  it('should refuse prerelease versions and ignore build metadata like npm', () => {
    const guard = cluster('app');
    for (const version of ['0.22.1-rc.0', '0.23.0-beta.1', '0.22.1-rc.0+build.1', '0.21.2+build.1']) {
      tree.install('app', fakeMesh('mesh', version));
      expect(refusal(guard('llm-mesh')).message, version).toContain(`installed @sentropic/llm-mesh@${version}`);
    }
    for (const version of ['0.22.0+build.1', '0.22.9']) {
      tree.install('app', fakeMesh('mesh', version));
      expect(guard('llm-mesh'), version).not.toThrow();
    }
  });

  it('should check ranges on a symlinked workspace copy through its physical manifest', () => {
    const guard = cluster('app');
    const inRange = tree.install('workspace/in', fakeMesh('linked-in', '0.22.4'));
    tree.link('app', '@sentropic/llm-mesh', inRange);
    expect(guard('llm-mesh')).not.toThrow();
    const outOfRange = tree.install('workspace/out', fakeGateway('linked-out', '0.18.0'));
    tree.link('app', '@sentropic/llm-gateway', outOfRange);
    expect(refusal(guard('gateway'))).toMatchObject({ reason: 'incompatible_version', paths: [outOfRange] });
  });
});
