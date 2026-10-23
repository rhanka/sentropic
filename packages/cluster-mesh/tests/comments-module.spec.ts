import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleRegistry } from '../src/modules/registry.js';
import { PackageTree, evaluations, moduleSource } from './fixtures/package-tree.js';
let tree: PackageTree; let anchorDir: string;
beforeEach(() => { tree = new PackageTree(); anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules'); evaluations().length = 0; });
afterEach(() => tree.cleanup());
const install = (version = '0.3.0') => {
  tree.install('app', { name: '@sentropic/cluster-mesh', version: '0.21.0', exports: { './comments': { source: moduleSource('comments-module', ['createCommentsModule', 'createCommentsPostgresStorage']) } } });
  tree.install('app', { name: '@sentropic/comments', version, exports: { '.': { source: moduleSource('comments-peer', ['createAnnotationRevision', 'validateCapacityDescriptor', 'hashRecord']) } } });
};
describe('delivered local comments module discovery', () => {
  it('probes metadata without evaluating and loads the selected local leaf with its compatible peer', async () => {
    install(); const modules = createModuleRegistry({}, { anchorDir });
    expect(modules.isEnabled('comments')).toBe(true);
    expect((await modules.probe()).comments).toMatchObject({ availability: 'available', state: 'installed', packageName: '@sentropic/cluster-mesh' });
    expect(evaluations()).toEqual([]); await modules.load('comments');
    expect(evaluations()).toEqual(['comments-module', 'comments-peer']);
    expect(modules.catalog().find((entry) => entry.id === 'comments')).toMatchObject({ status: 'delivered', entry: '@sentropic/cluster-mesh/comments', namespace: '/comments' });
  });
  it('refuses an enabled incompatible peer before any module evaluates', async () => {
    install('0.2.0'); const modules = createModuleRegistry({}, { anchorDir });
    await expect(modules.load('comments')).rejects.toMatchObject({ reason: 'incompatible_version', packageName: '@sentropic/comments' });
    expect(evaluations()).toEqual([]);
  });
  it('keeps disabled comments unevaluated even with an incompatible peer', async () => {
    install('0.2.0'); const modules = createModuleRegistry({ disabled: ['comments'] }, { anchorDir });
    await expect(modules.load('comments')).rejects.toMatchObject({ reason: 'disabled' });
    expect(evaluations()).toEqual([]);
  });
});
