import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleRegistry } from '../src/modules/registry.js';
import { PackageTree, evaluations, moduleSource } from './fixtures/package-tree.js';

let tree: PackageTree; let anchorDir: string;
beforeEach(() => { tree = new PackageTree(); anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules'); evaluations().length = 0; });
afterEach(() => tree.cleanup());

const install = () => {
  tree.install('app', {
    name: '@sentropic/cluster-mesh', version: '0.21.0',
    exports: {
      './notifications': {
        source: moduleSource('notifications-module', ['OPS_JOB_FAILURE_CONTRACT_V1', 'validateOpsJobFailureV1',
          'applyOpsJobFailureEvent', 'createDeclaredOpsRecipientsPort']),
      },
    },
  });
};

describe('delivered local notifications module discovery', () => {
  it('probes metadata without evaluating and loads the local leaf', async () => {
    install(); const modules = createModuleRegistry({}, { anchorDir });
    expect(modules.isEnabled('notifications')).toBe(true);
    expect((await modules.probe()).notifications).toMatchObject(
      { availability: 'available', state: 'installed', packageName: '@sentropic/cluster-mesh' });
    expect(evaluations()).toEqual([]); await modules.load('notifications');
    expect(evaluations()).toEqual(['notifications-module']);
    expect(modules.catalog().find((entry) => entry.id === 'notifications')).toMatchObject(
      { status: 'delivered', entry: '@sentropic/cluster-mesh/notifications' });
  });

  it('refuses an incompatible self version before any module evaluates', async () => {
    tree.install('app', {
      name: '@sentropic/cluster-mesh', version: '0.20.0',
      exports: {
        './notifications': { source: moduleSource('notifications-module', ['OPS_JOB_FAILURE_CONTRACT_V1']) },
      },
    });
    const modules = createModuleRegistry({}, { anchorDir });
    await expect(modules.load('notifications')).rejects.toMatchObject(
      { reason: 'incompatible_version', packageName: '@sentropic/cluster-mesh' });
    expect(evaluations()).toEqual([]);
  });
});
