import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClusterMeshModuleUnavailableError,
  isClusterMeshModuleUnavailableError,
} from '../../src/modules/errors.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { satisfiesRange } from '../../src/modules/semver.js';
import { evaluations, fakeGateway, fakeMesh, moduleSource, PackageTree } from '../fixtures/package-tree.js';

let tree: PackageTree;
let anchorDir: string;

beforeEach(() => {
  tree = new PackageTree();
  anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
  evaluations().length = 0;
});
afterEach(() => tree.cleanup());

const registry = (disabled: readonly string[] = []) =>
  createModuleRegistry({ disabled: disabled as never }, { anchorDir });

describe('module registry', () => {
  it('should resolve and evaluate nothing at construction', () => {
    tree.install('app', fakeMesh('mesh'));
    const modules = registry();
    expect(Object.values(modules.snapshot()).every((record) => record.state === 'unprobed')).toBe(true);
    expect(evaluations()).toEqual([]);
  });

  it('should share one pending load per export and cache the namespace', async () => {
    tree.install('app', fakeMesh('mesh'));
    const modules = registry();
    const first = modules.load('llm-mesh');
    const second = modules.load('llm-mesh');
    expect(second).toBe(first);
    const namespace = await first as { createLlmMesh(): string };
    expect(namespace.createLlmMesh()).toBe('mesh:createLlmMesh');
    await expect(modules.load('llm-mesh')).resolves.toBe(namespace);
    expect(evaluations()).toEqual(['mesh']);
    expect(modules.snapshot()['llm-mesh']).toEqual({
      availability: 'available', state: 'loaded', packageName: '@sentropic/llm-mesh', installedVersion: '0.22.0',
    });
  });

  it('should refuse a missing provider with the stable code and cache the failure', async () => {
    const modules = registry();
    const failure = modules.load('llm-mesh/facade');
    await expect(failure).rejects.toThrow(
      'Cluster Mesh module "llm-mesh/facade" is unavailable (not_installed). Install @sentropic/llm-mesh@">=0.22.0 <0.23.0" and restart.',
    );
    const error = await failure.catch((caught: unknown) => caught);
    expect(isClusterMeshModuleUnavailableError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'not_installed', moduleId: 'llm-mesh/facade' });
    tree.install('app', fakeMesh('late'));
    expect(modules.load('llm-mesh/facade')).toBe(failure);
    await expect(modules.load('llm-mesh/facade')).rejects.toMatchObject({ reason: 'not_installed' });
    expect(evaluations()).toEqual([]);
  });

  it('should recognize refusals structurally across duplicate constructors', () => {
    const foreign = { code: 'cluster_mesh_module_unavailable', moduleId: 'gateway', reason: 'load_failed' };
    expect(isClusterMeshModuleUnavailableError(foreign)).toBe(true);
    expect(foreign instanceof ClusterMeshModuleUnavailableError).toBe(false);
    expect(isClusterMeshModuleUnavailableError({ code: 'cluster_mesh_module_unavailable', reason: 'other' })).toBe(false);
    expect(isClusterMeshModuleUnavailableError(new Error('x'))).toBe(false);
  });

  it.each([
    ['0.23.0', '0.23.0'],
    ['0.21.2', '0.21.2'],
    ['0.22.1-rc.1', '0.22.1-rc.1'],
  ])('should refuse llm-mesh %s as incompatible_version', async (version, installedVersion) => {
    tree.install('app', fakeMesh('mesh', version));
    await expect(registry().load('llm-mesh')).rejects.toMatchObject({
      reason: 'incompatible_version', packageName: '@sentropic/llm-mesh', installedVersion,
    });
    expect(evaluations()).toEqual([]);
  });

  it('should refuse unreadable version evidence as incompatible_version', async () => {
    tree.install('app', { name: '@sentropic/llm-mesh', rawManifest: '{ not json' });
    await expect(registry().load('llm-mesh')).rejects.toMatchObject({ reason: 'incompatible_version' });
  });

  it('should distinguish a missing export map entry from a missing runtime member', async () => {
    tree.install('app', {
      name: '@sentropic/llm-mesh', version: '0.22.0',
      exports: { '.': { source: moduleSource('bare', ['createLlmMesh']) } },
    });
    const modules = registry();
    await expect(modules.load('llm-mesh/facade')).rejects.toMatchObject({ reason: 'export_unavailable' });
    expect(evaluations()).toEqual([]);
    await expect(modules.load('llm-mesh')).rejects.toMatchObject({ reason: 'export_unavailable' });
    expect(evaluations()).toEqual(['bare']);
  });

  it('should report evaluation failures as load_failed without leaking paths', async () => {
    tree.install('app', {
      name: '@sentropic/llm-mesh', version: '0.22.0',
      exports: { '.': { source: `throw new Error('boom at ${tree.root}');` } },
    });
    const error = await registry().load('llm-mesh').catch((caught: unknown) => caught) as ClusterMeshModuleUnavailableError;
    expect(error.reason).toBe('load_failed');
    expect(error.message).not.toContain(tree.root);
    expect(JSON.stringify(error)).not.toContain(tree.root);
    expect(Object.keys(error)).not.toContain('cause');
    expect(String((error.cause as Error).message)).toContain('boom');
  });

  it('should refuse disabled and source-unavailable modules without resolving them', async () => {
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw'));
    const modules = registry(['gateway']);
    expect(modules.isEnabled('gateway')).toBe(false);
    expect(modules.isEnabled('mcp/track')).toBe(false);
    await expect(modules.load('gateway')).rejects.toMatchObject({ reason: 'disabled' });
    await expect(modules.load('mcp/track')).rejects.toMatchObject({ reason: 'source_unavailable' });
    expect(evaluations()).toEqual([]);
  });

  it('should refuse the old gateway 0.18 and a gateway-private llm-mesh copy', async () => {
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', fakeGateway('gw', '0.18.0'));
    await expect(registry().load('gateway')).rejects.toMatchObject({
      reason: 'incompatible_version', packageName: '@sentropic/llm-gateway', installedVersion: '0.18.0',
    });
    tree.cleanup();
    tree = new PackageTree();
    anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
    tree.install('app', fakeMesh('mesh'));
    tree.install('app/node_modules/@sentropic/llm-gateway', fakeMesh('nested'));
    tree.install('app', fakeGateway('gw'));
    await expect(registry().load('gateway')).rejects.toMatchObject({
      reason: 'incompatible_version', packageName: '@sentropic/llm-mesh', installedVersion: '0.22.0',
    });
    expect(evaluations()).toEqual([]);
  });

  it('should accept a gateway sharing the physical llm-mesh through a symlink', async () => {
    const meshDir = tree.install('store', fakeMesh('mesh'));
    tree.link('app', '@sentropic/llm-mesh', meshDir);
    tree.link('app/node_modules/@sentropic/llm-gateway', '@sentropic/llm-mesh', meshDir);
    tree.install('app', fakeGateway('gw'));
    const namespace = await registry().load('gateway') as { createGatewayRouter(): string };
    expect(namespace.createGatewayRouter()).toBe('gw:createGatewayRouter');
  });

  it('should probe metadata without evaluating and demote after a later failure', async () => {
    tree.install('app', fakeMesh('mesh'));
    tree.install('app', {
      name: '@sentropic/llm-gateway', version: '0.19.0',
      exports: { '.': { source: 'throw new Error("gateway broke");' } },
    });
    const modules = registry(['llm-mesh/node']);
    const map = await modules.probe();
    expect(evaluations()).toEqual([]);
    expect(map['llm-mesh']).toEqual({
      availability: 'available', state: 'installed', packageName: '@sentropic/llm-mesh', installedVersion: '0.22.0',
    });
    expect(map.gateway).toMatchObject({ availability: 'available', state: 'installed' });
    expect(map['gateway/auth']).toMatchObject({ availability: 'gated', state: 'unavailable', reason: 'export_unavailable' });
    expect(map['llm-mesh/node']).toEqual({ availability: 'gated', state: 'unavailable', reason: 'disabled' });
    expect(map['mcp/track']).toEqual({ availability: 'gated', state: 'unavailable', reason: 'source_unavailable' });
    await expect(modules.load('gateway')).rejects.toMatchObject({ reason: 'load_failed' });
    expect(modules.snapshot().gateway).toMatchObject({ state: 'unavailable', reason: 'load_failed' });
    await modules.load('llm-mesh');
    expect((await modules.probe())['llm-mesh']).toMatchObject({ state: 'loaded' });
    expect((await modules.probe()).gateway).toMatchObject({ state: 'unavailable', reason: 'load_failed' });
  });

  it('should list the catalog with delivered and source-unavailable entries', () => {
    const catalog = registry().catalog();
    expect(catalog.find((entry) => entry.id === 'gateway/auth')).toMatchObject({
      status: 'delivered', entry: '@sentropic/llm-gateway/auth', requiredRange: '>=0.19.0 <0.20.0',
      peers: [
        { packageName: '@sentropic/mcp-auth', entry: '@sentropic/mcp-auth/hono', requiredRange: '>=0.2.1 <0.3.0' },
        { packageName: 'jose', entry: 'jose', requiredRange: '^5.10.0' },
      ],
    });
    expect(catalog.find((entry) => entry.id === 'mcp/track')).toMatchObject({ status: 'source_unavailable', namespace: '/mcp' });
  });
});

describe('release range check', () => {
  it.each([
    ['0.22.0', '>=0.22.0 <0.23.0', true],
    ['0.22.9', '>=0.22.0 <0.23.0', true],
    ['0.23.0', '>=0.22.0 <0.23.0', false],
    ['0.21.2', '>=0.22.0 <0.23.0', false],
    ['5.10.3', '^5.10.0', true],
    ['6.0.0', '^5.10.0', false],
    ['0.15.4', '^0.15.0', true],
    ['0.16.0', '^0.15.0', false],
    ['0.19.0-beta.1', '>=0.19.0 <0.20.0', false],
    ['0.19.0+build.7', '>=0.19.0 <0.20.0', true],
    ['0.20.0+build.7', '>=0.19.0 <0.20.0', false],
    ['0.19.0-beta.1+build.7', '>=0.19.0 <0.20.0', false],
    ['0.19.0+', '>=0.19.0 <0.20.0', false],
    [undefined, '^5.10.0', false],
  ])('should evaluate %s against %s as %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });
});
