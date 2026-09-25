import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClusterMeshModules, createDegenerateClusterMesh } from '../../src/index.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { evaluations, fakeMesh, PackageTree } from '../fixtures/package-tree.js';

function bindings() {
  return {
    self: { kind: 'server' as const, nodeId: 'local', issuer: 'issuer', endpoint: 'https://local.test', state: 'active' as const },
    workstations: { async listAttached() { return []; } },
    memberships: { async resolveApproved() { return null; } },
    projections: { availability: 'available' as 'available' | 'gated', create: vi.fn(), verify: vi.fn(), resolve: vi.fn() },
    devices: {
      availability: 'available' as 'available' | 'gated',
      issueDeviceCode: vi.fn(), pollDeviceCode: vi.fn(), approveDeviceCode: vi.fn(),
    },
    nhiRunner: { run: vi.fn() },
  };
}

let tree: PackageTree | undefined;
afterEach(() => tree?.cleanup());

describe('module capability reporting', () => {
  it('should keep module availability absent when no registry is injected', () => {
    const mesh = createDegenerateClusterMesh(bindings());
    expect('modules' in mesh.capabilities).toBe(false);
  });

  it('should expose a live registry snapshot separate from binding availability', async () => {
    tree = new PackageTree();
    evaluations().length = 0;
    tree.install('app', fakeMesh('mesh'));
    const modules = createModuleRegistry({}, { anchorDir: tree.dir('app/node_modules/@sentropic/cluster-mesh/dist') });
    const input = bindings();
    const mesh = createDegenerateClusterMesh({ ...input, modules });
    expect(mesh.capabilities.modules?.['llm-mesh']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(mesh.capabilities.modules?.['llm-mesh']).toMatchObject({ availability: 'available', state: 'installed' });
    expect(mesh.capabilities.modules?.gateway).toMatchObject({ state: 'unavailable', reason: 'not_installed' });
    await modules.load('llm-mesh');
    expect(mesh.capabilities.modules?.['llm-mesh']).toMatchObject({ state: 'loaded' });
    input.devices.availability = 'gated';
    expect(mesh.capabilities.localDevices).toBe('gated');
    expect(mesh.capabilities.localProjection).toBe('available');
    expect(mesh.capabilities.modules?.['llm-mesh']).toMatchObject({ state: 'loaded' });
  });

  it('should create an unprobed public registry without resolving providers', () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot().gateway).toEqual({ availability: 'gated', state: 'unprobed' });
    expect(modules.isEnabled('gateway')).toBe(true);
    expect(createClusterMeshModules({ disabled: ['gateway'] }).isEnabled('gateway')).toBe(false);
  });
});
