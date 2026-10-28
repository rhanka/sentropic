import { describe, expect, it } from 'vitest';
import { createModuleRegistry } from '../src/modules/registry.js';
import { PackageTree, moduleSource } from './fixtures/package-tree.js';

describe('speech peer admission', () => {
  it.each(['0.19.2', '0.22.0', '0.26.9', '0.27.1', '0.27.9', '0.32.0'])(
    'should refuse speech on llm-mesh %s before evaluating the peer', async (version) => {
      const tree = new PackageTree();
      try {
        const anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
        tree.install('app', { name: '@sentropic/llm-mesh', version,
          exports: { './speech': { source: 'throw new Error("must not evaluate");' } } });
        await expect(createModuleRegistry({}, { anchorDir }).load('speech')).rejects.toMatchObject({
          code: 'cluster_mesh_module_unavailable', moduleId: 'speech', reason: 'incompatible_version',
          packageName: '@sentropic/llm-mesh', installedVersion: version, requiredRange: '>=0.28.0 <0.32.0',
        });
      } finally { tree.cleanup(); }
    });
  it.each(['0.28.0', '0.29.0', '0.30.0', '0.31.0'].flatMap((version) => [false, true].map((present) => ({ version, present }))))(
    'should check speech export evidence on llm-mesh $version (present=$present)', async ({ version, present }) => {
    const tree = new PackageTree();
    try {
      const anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
      tree.install('app', { name: '@sentropic/llm-mesh', version, exports: present ? {
        './speech': { source: moduleSource('speech', ['getModelSpeechCapabilities', 'negotiateSpeech']) },
      } : {} });
      const load = createModuleRegistry({}, { anchorDir }).load('speech');
      if (present) await expect(load).resolves.toHaveProperty('negotiateSpeech');
      else await expect(load).rejects.toMatchObject({ reason: 'export_unavailable' });
    } finally { tree.cleanup(); }
  });
});
